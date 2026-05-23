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
 *      from paying wages.
 *   6a. Maintenance: each building debits its maintenance items per tick
 *      (silent shortfall — building still operates if items missing; demand
 *      pressure comes from NPC bids targeting a maintenance buffer).
 *   7. Bankruptcy counter (households and government exempt).
 *   8. Liquidation: actors with bankruptTicks > BANKRUPTCY_TICKS recover
 *      inventory and building construction at fair × 0.5, then drop from
 *      state.actors. Households and government are exempt. Respawn is v1+.
 */

const { wage, gainSkill, outputMultiplier, newWorker, BASE_WAGE } = require('./worker.js');
const {
    fairPrice, npcOrders, playerOrders, householdOrders, governmentOrders, clear,
    growthTarget, recipeForBuilding,
    HOUSEHOLDS_ID, GOVERNMENT_ID, STAPLES, NPC_GROWTH_RUNWAY_TICKS,
} = require('./market.js');
const { createActor } = require('./state.js');

const HISTORY_LIMIT = 100;
// Organic stress timeline: insolvent actors don't die immediately — they
// deteriorate over BANKRUPTCY_TICKS while observable as `stress` state.
// EVICTION_TICKS midway is a forced fire-sale of inventory + non-core
// assets. Final liquidation at BANKRUPTCY_TICKS.
const BANKRUPTCY_TICKS = 500;
const EVICTION_TICKS = 250;
const LIQUIDATION_RECOVERY = 0.5;
// Credit facility: each actor can run negative cash up to a credit limit
// before insolvency. Limit = wage runway (CREDIT_RUNWAY_TICKS of payroll).
const CREDIT_RUNWAY_TICKS = 60;
// Respawn: dead NPCs reseed after RESPAWN_DELAY ticks from their data.actors
// spec (starting cash + buildings + workers + tech). Funded from households
// first (sink for the wage cycle), else minted. Player is never respawned.
// This is the safety net that breaks cascade collapse: when machine-co dies,
// the chain has K ticks to reorganize without producer demand, then a fresh
// machine-co rejoins. The same niche may die again; that's allowed and
// expected when it's structurally unprofitable.
const RESPAWN_DELAY = 200;

// Stress levels per actor, recomputed each tick from cash-vs-wage-runway:
//   0 healthy:    cash >= GROWTH_RUNWAY ticks of wages — grows aggressively
//   1 squeezed:   cash 50-GROWTH_RUNWAY ticks — growth freeze
//   2 stressed:   cash 0-50 ticks — hiring freeze
//   3 distressed: cash 0 to -credit_limit — layoffs, ask discount
//   4 insolvent:  cash < -credit_limit — bankruptcy clock running
const STRESS_SQUEEZED_TICKS = 200;
const STRESS_STRESSED_TICKS = 50;

// Per-actor-per-item price belief drifts from fill outcomes each tick:
// fully filled ask → +PRICE_DRIFT (could've asked more); unfilled ask →
// −PRICE_DRIFT (too high). Bids inverted: fully filled bid → −PRICE_DRIFT
// (could've paid less); unfilled bid → +PRICE_DRIFT (too low). Clamped to
// [MIN_BELIEF, MAX_BELIEF] so beliefs can't run away. Households + gov
// skipped — they're synthetic anchors.
const PRICE_DRIFT = 0.005;
const MIN_BELIEF = 0.5;
const MAX_BELIEF = 2.0;

// Worker lookup is hot: called per slot per tick. Cache the id-map on the
// actor, invalidated whenever actor.workers grows/shrinks. Same cache is
// also used by growthTarget in market.js.
function ensureWorkerIndex(actor) {
    if (actor._workerIndex && actor._workerIndexCount === actor.workers.length) {
        return actor._workerIndex;
    }
    const byId = {};
    for (const w of actor.workers) byId[w.id] = w;
    actor._workerIndex = byId;
    actor._workerIndexCount = actor.workers.length;
    return byId;
}

function workersForSlot(actor, slot) {
    const byId = ensureWorkerIndex(actor);
    const out = [];
    for (const id of slot.workerIds) {
        const w = byId[id];
        if (w) out.push(w);
    }
    return out;
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
    const insolvent = (actor.stress || 0) >= 4;
    for (const bldg of actor.buildings) {
        for (let s = 0; s < bldg.slots.length; s++) {
            const slot = bldg.slots[s];
            if (!slot) continue;
            const recipe = recipes[slot.recipe];
            if (!recipe || !recipe.seconds || recipe.seconds <= 0) continue;
            const workers = workersForSlot(actor, slot);
            if (workers.length < (recipe.workers || 0)) continue;

            if (slot.progress === 0) {
                // Insolvent: idle plants. Don't start new cycles — preserves
                // input inventory for fire-sale and stops wage burn from
                // converting raw materials into stockpiled output nobody wants.
                if (insolvent) continue;
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

// NPCs auto-pick research targets so the tech tree gets walked. Three-tier
// preference (in priority order):
//   1. Target: a tech that unlocks a recipe in a building the actor owns
//      AND whose prereqs are met (ready to research right now).
//   2. Path: a tech that's a prereq (direct or transitive) for some target,
//      AND whose own prereqs are met (clears the path to target).
//   3. Walk: any available tech (cheapest), to keep the tree progressing.
// Without (2), an actor researches irrelevant tech first because they're
// cheaper — e.g., ore-co spent ~1900 ticks on ceramic-kiln + coal-tar +
// bessemer before reaching steel, but kept dying mid-walk and losing
// progress. With path priority, ore-co goes straight to coal-tar (prereq
// for bessemer) then bessemer, halving time-to-steel.
function npcResearch(actor, data) {
    if (!actor.strategy || actor.strategy === 'households' || actor.strategy === 'government') return;
    if (actor.researchInProgress) return;
    const tech = data.tech || {};
    const recipes = data.recipes || {};
    const ownedBuildings = new Set((actor.buildings || []).map(b => b.type));

    // Identify TARGET techs: unlocks a recipe in an owned building.
    const targets = new Set();
    for (const [techId] of Object.entries(tech)) {
        if (actor.researched.has(techId)) continue;
        for (const r of Object.values(recipes)) {
            if (r.tech === techId && ownedBuildings.has(r.building)) {
                targets.add(techId);
                break;
            }
        }
    }
    // Collect PATH techs: all prereqs (transitive) of any target.
    const onPath = new Set();
    function addPrereqs(t) {
        if (onPath.has(t)) return;
        onPath.add(t);
        const def = tech[t];
        if (def) for (const p of def.prereqs || []) addPrereqs(p);
    }
    for (const t of targets) addPrereqs(t);

    // Build available list (prereqs met, not researched, unlocks recipe).
    const available = [];
    for (const [techId, def] of Object.entries(tech)) {
        if (actor.researched.has(techId)) continue;
        const prereqs = def.prereqs || [];
        if (!prereqs.every(p => actor.researched.has(p))) continue;
        let unlocksRecipe = false;
        for (const r of Object.values(recipes)) {
            if (r.tech === techId) { unlocksRecipe = true; break; }
        }
        if (!unlocksRecipe) continue;
        available.push({ techId, cost: def.research_cost || 0 });
    }

    const pickCheapest = (filter) => {
        let best = null;
        for (const a of available) {
            if (!filter(a)) continue;
            if (!best || a.cost < best.cost) best = a;
        }
        return best;
    };
    const pick = pickCheapest(a => targets.has(a.techId))
        || pickCheapest(a => onPath.has(a.techId))
        || pickCheapest(() => true);
    if (pick) actor.researchInProgress = { tech: pick.techId, progress: 0 };
}

function gatherOrders(actor, data, prices, state) {
    if (actor.strategy === 'households') return householdOrders(actor, data, prices, state);
    if (actor.strategy === 'government') return governmentOrders(actor, state);
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

// Tech adoption: fill empty slots in existing buildings with the best
// researched recipe — but ONLY if it's a recipe the actor isn't already
// running. Empty slots are for adopting newly-researched tech, not for
// duplicating existing production. New workers come pre-trained in the
// recipe's tech (skill 0.5, output_mult 1.25) — justified as transfer of
// the actor's accumulated know-how from research. Without pre-training,
// the skill-0 ramp-up bleeds ~$30/tick × 1000 ticks before profitable,
// which exceeds typical NPC cash buffers. Cash gate is also raised: 1000
// ticks of wage runway, since adoption commits to ramp-up cost.
const ADOPTION_SKILL = 0.5;
const ADOPTION_RUNWAY_TICKS = 1000;
function npcFillEmptySlots(state, data) {
    for (const actor of Object.values(state.actors)) {
        if (!actor.strategy || actor.strategy === 'households' || actor.strategy === 'government') continue;
        if ((actor.stress || 0) >= 2) continue; // hiring freeze when stressed
        const running = new Set();
        for (const b of actor.buildings) {
            for (const slot of b.slots) {
                if (slot) running.add(slot.recipe);
            }
        }
        let filled = false;
        for (const bldg of actor.buildings) {
            if (filled) break;
            for (let s = 0; s < bldg.slots.length; s++) {
                if (bldg.slots[s] !== null) continue;
                const recipe = recipeForBuilding(actor, data, bldg.type);
                if (!recipe) continue;
                if (running.has(recipe.id)) continue;
                const need = recipe.workers || 0;
                if (need <= 0) continue;
                const wageRunway = need * BASE_WAGE * ADOPTION_RUNWAY_TICKS;
                if ((actor.cash || 0) < wageRunway) continue;
                let idle = idleWorkerIds(actor);
                const toHire = Math.max(0, need - idle.length);
                for (let i = 0; i < toHire; i++) {
                    actor.workers.push(newWorker(`${actor.id}-w${actor.workerCounter++}`));
                }
                idle = idleWorkerIds(actor);
                const workerIds = idle.slice(0, need);
                bldg.slots[s] = {
                    recipe: recipe.id,
                    progress: 0,
                    workerIds,
                };
                if (recipe.tech) {
                    const byId = new Map(actor.workers.map(w => [w.id, w]));
                    for (const id of workerIds) {
                        const w = byId.get(id);
                        if (w) {
                            const cur = w.skill[recipe.tech] || 0;
                            if (cur < ADOPTION_SKILL) w.skill[recipe.tech] = ADOPTION_SKILL;
                        }
                    }
                }
                filled = true;
                break;
            }
        }
    }
}

function npcGrow(state, data, prices) {
    const buildings = data.buildings || {};
    for (const actor of Object.values(state.actors)) {
        if (!actor.strategy || actor.strategy === 'households' || actor.strategy === 'government') continue;
        if ((actor.stress || 0) >= 1) continue; // growth freeze when squeezed
        const target = growthTarget(actor, data);
        if (!target) continue;
        const def = buildings[target];
        if (!def) continue;
        const construction = def.construction || {};
        const recipe = recipeForBuilding(actor, data, target);
        const workersNeeded = recipe ? (recipe.workers || 0) : 0;

        // Cash check counts only MISSING materials (what actor would buy).
        // Items already produced internally don't drain cash.
        let materialsCost = 0;
        for (const [item, amt] of Object.entries(construction)) {
            const have = actor.inventory[item] || 0;
            const missing = Math.max(0, amt - have);
            materialsCost += (prices[item] || 0) * missing;
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
            id: `${actor.id}-${target}-${idx}`,
            type: target,
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

// Buildings consume maintenance items per tick (kilns burn coal, blast-
// furnaces and machine-shops wear machine-tools). Silent shortfall — no
// idle penalty; the operating cost shows up via NPC bids that target a
// rolling buffer of maintenance items (see maintenanceDemand in market.js).
function consumeMaintenance(actor, data) {
    const buildings = data.buildings || {};
    for (const b of actor.buildings) {
        const def = buildings[b.type];
        if (!def || !def.maintenance || typeof def.maintenance !== 'object') continue;
        for (const [item, rate] of Object.entries(def.maintenance)) {
            const have = actor.inventory[item] || 0;
            actor.inventory[item] = Math.max(0, have - rate);
        }
    }
}

// Cash-vs-wage-runway → stress level (0 healthy ... 4 insolvent). Drives
// graduated behaviors: growth freeze, hiring freeze, layoffs, fire-sale.
// Stored on actor so order generation and tick logic can read consistent
// per-tick state.
// Distressed actor lays off one idle (unassigned) worker per tick. Cuts
// wage burn without disrupting production. Real firms shed payroll as
// cash dries up — this is the operational equivalent.
function layoffOneIdle(actor) {
    const assigned = new Set();
    for (const b of actor.buildings) {
        for (const slot of b.slots) {
            if (slot) for (const id of slot.workerIds) assigned.add(id);
        }
    }
    for (let i = 0; i < actor.workers.length; i++) {
        if (!assigned.has(actor.workers[i].id)) {
            actor.workers.splice(i, 1);
            actor._workerIndex = null;
            return true;
        }
    }
    return false;
}

function computeStress(actor) {
    if (actor.strategy === 'households' || actor.strategy === 'government') return 0;
    let totalWages = 0;
    for (const w of actor.workers) totalWages += wage(w);
    if (totalWages <= 0) {
        return actor.cash < 0 ? 4 : 0;
    }
    const runway = actor.cash / totalWages;
    const creditLimit = totalWages * CREDIT_RUNWAY_TICKS;
    if (runway >= STRESS_SQUEEZED_TICKS) return 0;
    if (runway >= STRESS_STRESSED_TICKS) return 1;
    if (runway >= 0) return 2;
    if (actor.cash >= -creditLimit) return 3;
    return 4;
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
    // Route dying actor's residual cash + recovery proceeds to households so
    // money supply stays bounded by gov issuance. Without this, every dead
    // actor's cash (often non-trivial) vanishes from the system.
    const households = state.actors[HOUSEHOLDS_ID];
    if (households) households.cash += (actor.cash || 0) + recovery;
    delete state.actors[actor.id];
    // Queue for respawn unless this is the player. The player is the human's
    // company — its death ends the game, not the world.
    if (actor.id !== 'player' && (data.actors || {})[actor.id]) {
        if (!state.respawnQueue) state.respawnQueue = [];
        state.respawnQueue.push({ actorId: actor.id, deathTick: state.tick });
    }
}

function respawnDead(state, data) {
    if (!state.respawnQueue || state.respawnQueue.length === 0) return;
    const remaining = [];
    for (const entry of state.respawnQueue) {
        if (state.tick - entry.deathTick < RESPAWN_DELAY) {
            remaining.push(entry);
            continue;
        }
        if (state.actors[entry.actorId]) continue; // already alive (shouldn't happen)
        const actor = createActor(data, entry.actorId);
        if (!actor) continue;
        // Funding source: take seed cash from households (the cycle's cash
        // sink) when possible, else mint. Gov is exempt — gov cash is fiat
        // anchor and we don't want respawns to drain it.
        const seed = actor.cash || 0;
        const households = state.actors[HOUSEHOLDS_ID];
        if (households && households.cash >= seed) households.cash -= seed;
        state.actors[entry.actorId] = actor;
    }
    state.respawnQueue = remaining;
}

// Staggered actor entry: actors with data.actors[id].start_tick > 0 are
// skipped in initState and spawn here when state.tick reaches start_tick.
// Creates visible tech-era progression — engineering-co appears @5000
// alongside steam-engineering unlock, simulating the spread of new tech
// into the economy via a fresh specialist. Funded from households like
// respawn (same accounting symmetry).
function spawnPendingActors(state, data) {
    for (const [id, def] of Object.entries(data.actors || {})) {
        const startTick = def.start_tick || 0;
        if (startTick <= 0) continue;
        if (state.tick !== startTick) continue;
        if (state.actors[id]) continue;
        const actor = createActor(data, id);
        if (!actor) continue;
        const seed = actor.cash || 0;
        const households = state.actors[HOUSEHOLDS_ID];
        if (households && households.cash >= seed) households.cash -= seed;
        state.actors[id] = actor;
    }
}

function tick(state, data) {
    state.tick++;
    state.lastTickAt = Date.now();

    for (const actor of Object.values(state.actors)) {
        runProduction(actor, data);
        advanceResearch(actor, data);
        npcResearch(actor, data);
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

    npcFillEmptySlots(state, data);
    npcGrow(state, data, prices);

    const households = state.actors[HOUSEHOLDS_ID];
    const dead = [];
    for (const actor of Object.values(state.actors)) {
        if (actor.strategy === 'households' || actor.strategy === 'government') continue;
        let totalWages = 0;
        for (const w of actor.workers) totalWages += wage(w);
        actor.cash -= totalWages;
        if (households) households.cash += totalWages;

        consumeMaintenance(actor, data);

        actor.stress = computeStress(actor);

        // Distressed/insolvent: shed one idle worker per tick to cut payroll.
        // Running production is preserved (assigned workers untouched); only
        // bench workers go. Matches real firms' first-line cost-cutting.
        if (actor.stress >= 3) layoffOneIdle(actor);

        // Stress 4 (insolvent): bankruptcy clock runs. Below clock,
        // distressed actors deteriorate visibly (handled in order
        // generation) but stay alive. Clears clock if recovery happens.
        if (actor.stress >= 4) actor.bankruptTicks++;
        else actor.bankruptTicks = 0;

        // Eviction notice: forced inventory fire-sale midway through the
        // bankruptcy window. Sells half of held inventory at liquidation
        // recovery rate. Buys the actor some cash to delay death.
        if (actor.bankruptTicks === EVICTION_TICKS && !actor.evictionServed) {
            actor.evictionServed = true;
            evictionFireSale(state, actor, prices);
        }

        if (actor.bankruptTicks > BANKRUPTCY_TICKS) dead.push(actor);
    }
    for (const a of dead) liquidate(state, data, a, prices);
    respawnDead(state, data);
    spawnPendingActors(state, data);
}

// One-shot fire sale triggered by eviction notice: sell half of every
// inventory item at liquidation recovery rate. Cash injection delays
// death; if the underlying business recovers, the actor can survive.
function evictionFireSale(state, actor, prices) {
    let proceeds = 0;
    for (const [item, qty] of Object.entries(actor.inventory || {})) {
        if (qty <= 0) continue;
        const sell = qty / 2;
        const price = (prices[item] || 0) * LIQUIDATION_RECOVERY;
        proceeds += sell * price;
        actor.inventory[item] = qty - sell;
    }
    actor.cash += proceeds;
}

module.exports = { tick, runProduction, BANKRUPTCY_TICKS };
