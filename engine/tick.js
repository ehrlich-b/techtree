/**
 * tick.js — one simulation tick.
 *
 * Order:
 *   1. Production: each running slot debits inputs at progress=0, advances
 *      by output_multiplier / recipe.seconds, credits outputs at progress
 *      >= 1.0. Workers on running slots gain skill in the recipe's tech.
 *      Research-in-progress advances by 1 point/tick; on completion the tech
 *      moves into actor.researched.
 *   2. Households consumption: drain worker count × rate of each STAPLES
 *      item (corn only in v0) from the households actor's inventory
 *      (silent shortfall).
 *   3. Orders + clearing: each actor posts orders (NPC liquidity + growth
 *      construction-material bids, player priceBook + pendingBids,
 *      household staple bids, government bid+ask for each item in
 *      GOV_BALLAST — corn only in v0); per-item double auction matches
 *      at midpoint. Trades transfer inventory always and cash for
 *      non-government participants — gov is the money issuer and exempt
 *      from the cash side. pendingBids drained.
 *   4. Price drift: each NPC's per-item priceBelief is nudged from this
 *      tick's fill outcome. Fully filled ask / unfilled bid → drift toward
 *      higher prices; unfilled ask / fully filled bid → drift toward
 *      lower prices. Households + gov skipped (synthetic anchors).
 *   5. NPC growth: NPCs with `growthBuilding` and cash above the runway
 *      threshold (materials at fair price + a wage cushion) construct
 *      one new building per tick when they hold all required materials,
 *      hiring + auto-assigning workers to the new slot.
 *   6. Wages: transferred from each employer to the households actor
 *      (closes the cash loop). Households and government are exempt
 *      from paying wages. Maintenance YAML fields are inert for v0.
 *   7. Bankruptcy counter (households and government exempt).
 *   8. Liquidation: actors with bankruptTicks > BANKRUPTCY_TICKS recover
 *      inventory and building construction at fair × 0.5, then drop from
 *      state.actors. Households and government are exempt. Respawn is v1+.
 */

const { wage, gainSkill, outputMultiplier, newWorker, BASE_WAGE } = require('./worker.js');
const {
    fairPrice, npcOrders, playerOrders, householdOrders, governmentOrders, clear,
    HOUSEHOLDS_ID, GOVERNMENT_ID, STAPLES, NPC_GROWTH_RUNWAY_TICKS,
} = require('./market.js');

const HISTORY_LIMIT = 100;
const BANKRUPTCY_TICKS = 30;
const LIQUIDATION_RECOVERY = 0.5;

// Per-actor-per-item price belief drifts from fill outcomes each tick:
// fully filled ask → +PRICE_DRIFT (could've asked more); unfilled ask →
// −PRICE_DRIFT (too high). Bids inverted: fully filled bid → −PRICE_DRIFT
// (could've paid less); unfilled bid → +PRICE_DRIFT (too low). Clamped to
// [MIN_BELIEF, MAX_BELIEF] so beliefs can't run away. Households + gov
// skipped — they're synthetic anchors.
const PRICE_DRIFT = 0.005;
const MIN_BELIEF = 0.5;
const MAX_BELIEF = 2.0;

function workersForSlot(actor, slot) {
    const byId = new Map(actor.workers.map(w => [w.id, w]));
    return slot.workerIds.map(id => byId.get(id)).filter(Boolean);
}

function hasInputs(inventory, inputs) {
    for (const [item, amt] of Object.entries(inputs || {})) {
        if ((inventory[item] || 0) < amt) return false;
    }
    return true;
}

function debit(inventory, inputs) {
    for (const [item, amt] of Object.entries(inputs || {})) {
        inventory[item] = (inventory[item] || 0) - amt;
    }
}

function credit(inventory, outputs) {
    for (const [item, amt] of Object.entries(outputs || {})) {
        inventory[item] = (inventory[item] || 0) + amt;
    }
}

function runProduction(actor, data) {
    const recipes = data.recipes || {};
    for (const bldg of actor.buildings) {
        for (let s = 0; s < bldg.slots.length; s++) {
            const slot = bldg.slots[s];
            if (!slot) continue;
            const recipe = recipes[slot.recipe];
            if (!recipe || !recipe.seconds || recipe.seconds <= 0) continue;
            const workers = workersForSlot(actor, slot);
            if (workers.length < (recipe.workers || 0)) continue;

            if (slot.progress === 0) {
                if (!hasInputs(actor.inventory, recipe.inputs)) continue;
                debit(actor.inventory, recipe.inputs);
            }

            const mult = outputMultiplier(workers, recipe.tech);
            slot.progress += mult / recipe.seconds;

            for (const w of workers) {
                if (recipe.tech) gainSkill(w, recipe.tech);
            }

            if (slot.progress >= 1.0) {
                credit(actor.inventory, recipe.outputs);
                slot.progress = 0;
            }
        }
    }
}

function advanceResearch(actor, data) {
    const rip = actor.researchInProgress;
    if (!rip) return;
    const def = (data.tech || {})[rip.tech];
    if (!def) {
        actor.researchInProgress = null;
        return;
    }
    rip.progress = (rip.progress || 0) + 1;
    if (rip.progress >= (def.research_cost || 0)) {
        actor.researched.add(rip.tech);
        actor.researchInProgress = null;
    }
}

function gatherOrders(actor, data, prices, state) {
    if (actor.strategy === 'households') return householdOrders(actor, data, prices, state);
    if (actor.strategy === 'government') return governmentOrders(actor);
    if (actor.strategy) return npcOrders(actor, data, prices);
    return playerOrders(actor);
}

function consumeStaples(state) {
    const h = state.actors[HOUSEHOLDS_ID];
    if (!h) return;
    let totalWorkers = 0;
    for (const a of Object.values(state.actors)) totalWorkers += (a.workers || []).length;
    for (const s of STAPLES) {
        const need = totalWorkers * s.rate;
        const have = h.inventory[s.item] || 0;
        h.inventory[s.item] = Math.max(0, have - need);
    }
}

function settle(state, trade) {
    const buyer = state.actors[trade.buyer];
    const seller = state.actors[trade.seller];
    if (!buyer || !seller) return;
    const total = trade.price * trade.qty;
    if (buyer.strategy !== 'government') buyer.cash -= total;
    if (seller.strategy !== 'government') seller.cash += total;
    buyer.inventory[trade.item] = (buyer.inventory[trade.item] || 0) + trade.qty;
    seller.inventory[trade.item] = (seller.inventory[trade.item] || 0) - trade.qty;
}

function recordTrade(state, trade) {
    if (!state.marketHistory) state.marketHistory = {};
    const hist = state.marketHistory[trade.item] || (state.marketHistory[trade.item] = []);
    hist.push({ tick: state.tick, price: trade.price, qty: trade.qty });
    if (hist.length > HISTORY_LIMIT) hist.shift();
}

function idleWorkerIds(actor) {
    const assigned = new Set();
    for (const b of actor.buildings) {
        for (const slot of b.slots) {
            if (slot) for (const id of slot.workerIds) assigned.add(id);
        }
    }
    return actor.workers.filter(w => !assigned.has(w.id)).map(w => w.id);
}

function recipeForGrowthBuilding(actor, data) {
    const recipes = data.recipes || {};
    for (const [id, r] of Object.entries(recipes)) {
        if (r.building !== actor.growthBuilding) continue;
        if (r.tech && !actor.researched.has(r.tech)) continue;
        return { id, ...r };
    }
    return null;
}

function npcGrow(state, data, prices) {
    const buildings = data.buildings || {};
    for (const actor of Object.values(state.actors)) {
        if (!actor.strategy || actor.strategy === 'households' || actor.strategy === 'government') continue;
        if (!actor.growthBuilding) continue;
        const def = buildings[actor.growthBuilding];
        if (!def) continue;
        const construction = def.construction || {};
        const recipe = recipeForGrowthBuilding(actor, data);
        const workersNeeded = recipe ? (recipe.workers || 0) : 0;

        let materialsCost = 0;
        for (const [item, amt] of Object.entries(construction)) {
            materialsCost += (prices[item] || 0) * amt;
        }
        const wageRunway = workersNeeded * BASE_WAGE * NPC_GROWTH_RUNWAY_TICKS;
        if (actor.cash < materialsCost + wageRunway) continue;

        let hasAll = true;
        for (const [item, amt] of Object.entries(construction)) {
            if ((actor.inventory[item] || 0) < amt) { hasAll = false; break; }
        }
        if (!hasAll) continue;

        for (const [item, amt] of Object.entries(construction)) {
            actor.inventory[item] -= amt;
        }
        const numSlots = def.slots || 1;
        const idx = actor.buildingCounter++;
        const newBldg = {
            id: `${actor.id}-${actor.growthBuilding}-${idx}`,
            type: actor.growthBuilding,
            slots: Array(numSlots).fill(null),
        };
        actor.buildings.push(newBldg);

        if (recipe && workersNeeded > 0) {
            let idle = idleWorkerIds(actor);
            const toHire = Math.max(0, workersNeeded - idle.length);
            for (let i = 0; i < toHire; i++) {
                actor.workers.push(newWorker(`${actor.id}-w${actor.workerCounter++}`));
            }
            idle = idleWorkerIds(actor);
            newBldg.slots[0] = {
                recipe: recipe.id,
                progress: 0,
                workerIds: idle.slice(0, workersNeeded),
            };
        }
    }
}

function applyPriceDrift(state, orders, trades) {
    const posted = {};
    for (const o of orders) {
        if (!o || !(o.qty > 0)) continue;
        const key = `${o.actor}|${o.item}|${o.side}`;
        posted[key] = (posted[key] || 0) + o.qty;
    }
    const filled = {};
    for (const t of trades) {
        const buyKey = `${t.buyer}|${t.item}|bid`;
        const sellKey = `${t.seller}|${t.item}|ask`;
        filled[buyKey] = (filled[buyKey] || 0) + t.qty;
        filled[sellKey] = (filled[sellKey] || 0) + t.qty;
    }
    for (const [key, qty] of Object.entries(posted)) {
        const [actorId, item, side] = key.split('|');
        const actor = state.actors[actorId];
        if (!actor) continue;
        if (actor.strategy === 'households' || actor.strategy === 'government') continue;
        if (!actor.priceBelief) actor.priceBelief = {};
        const ratio = (filled[key] || 0) / qty;
        const delta = side === 'ask'
            ? (ratio - 0.5) * 2 * PRICE_DRIFT
            : (0.5 - ratio) * 2 * PRICE_DRIFT;
        const cur = actor.priceBelief[item] || 1.0;
        actor.priceBelief[item] = Math.max(MIN_BELIEF, Math.min(MAX_BELIEF, cur + delta));
    }
}

function liquidate(state, data, actor, prices) {
    const buildings = data.buildings || {};
    let recovery = 0;
    for (const [item, qty] of Object.entries(actor.inventory || {})) {
        if (qty > 0 && prices[item] > 0) recovery += qty * prices[item] * LIQUIDATION_RECOVERY;
    }
    for (const b of actor.buildings || []) {
        const def = buildings[b.type];
        if (!def || !def.construction) continue;
        for (const [item, amt] of Object.entries(def.construction)) {
            if (prices[item] > 0) recovery += amt * prices[item] * LIQUIDATION_RECOVERY;
        }
    }
    actor.cash += recovery;
    delete state.actors[actor.id];
}

function tick(state, data) {
    state.tick++;
    state.lastTickAt = Date.now();

    for (const actor of Object.values(state.actors)) {
        runProduction(actor, data);
        advanceResearch(actor, data);
    }

    consumeStaples(state);

    const prices = fairPrice(data);
    const orders = [];
    for (const actor of Object.values(state.actors)) {
        const o = gatherOrders(actor, data, prices, state);
        orders.push(...o.bids, ...o.asks);
    }

    const trades = clear(orders);
    for (const t of trades) {
        settle(state, t);
        recordTrade(state, t);
    }

    applyPriceDrift(state, orders, trades);

    for (const actor of Object.values(state.actors)) actor.pendingBids = [];

    npcGrow(state, data, prices);

    const households = state.actors[HOUSEHOLDS_ID];
    const dead = [];
    for (const actor of Object.values(state.actors)) {
        if (actor.strategy === 'households' || actor.strategy === 'government') continue;
        let totalWages = 0;
        for (const w of actor.workers) totalWages += wage(w);
        actor.cash -= totalWages;
        if (households) households.cash += totalWages;

        if (actor.cash < 0) actor.bankruptTicks++;
        else actor.bankruptTicks = 0;

        if (actor.bankruptTicks > BANKRUPTCY_TICKS) dead.push(actor);
    }
    for (const a of dead) liquidate(state, data, a, prices);
}

module.exports = { tick, runProduction, BANKRUPTCY_TICKS };
