/**
 * market.js — fair_price + clearing + order generation.
 *
 * fair_price: fixed-point iteration over the recipe graph; cycles converge
 * within FAIRPRICE_ITERATIONS.
 *
 * clear: per-item double auction. Sort bids desc / asks asc, match top of
 * book at midpoint until prices no longer cross. Self-trades skipped.
 *
 * npcOrders: NPCs ask surplus inventory at fair × (1 + spread) × belief; bid
 * for short input items (per running slot, NPC_INPUT_BUFFER_CYCLES of buffer)
 * at fair × (1 - spread) × belief, capped by NPC_BID_BUDGET_FRAC of cash.
 * `belief` is a per-actor-per-item multiplier that drifts each tick from
 * fill outcomes (see applyPriceDrift in tick.js): unfilled asks/bids drift
 * the actor's belief away from fair to chase a clear; fully filled drifts
 * back. Heterogeneous beliefs let producers raise prices when demand
 * outruns supply without static tuning.
 *
 * householdOrders: the synthetic 'households' actor absorbs wages and
 * eats one unit of each STAPLES item per worker per tick at its rate. It
 * bids each tick at the staple's anchor price; gov's matching ask (also
 * at anchor) means the midpoint clears at anchor.
 *
 * governmentOrders: the 'government' actor ballasts only corn (the wage
 * staple). Bid + ask both at anchor (gov is a flat market-maker at $50)
 * with bid quantity capped at GOV_BID_BUFFER × current household corn
 * demand. This caps both the price and quantity dimensions of the gov
 * subsidy. Cash side is suppressed in settle: gov is the money issuer;
 * trades create money for sellers and absorb it from buyers.
 *
 * playerOrders: actor.priceBook → auto-asks of full inventory at the set
 * price; actor.pendingBids → one-shot bids drained by the tick caller.
 */

const { BASE_WAGE, outputMultiplier } = require('./worker.js');

const MARKUP = 1.2;
const NPC_SPREAD = 0.05;
const FAIRPRICE_ITERATIONS = 8;
const NPC_INPUT_BUFFER_CYCLES = 5;
const NPC_BID_BUDGET_FRAC = 0.5;

const HOUSEHOLDS_ID = 'households';
const GOVERNMENT_ID = 'government';
const HOUSEHOLD_BUFFER_TICKS = 10;
const HOUSEHOLD_BID_BUDGET_FRAC = 0.5;
// Gov absorbs surplus staple supply up to GOV_BID_BUFFER × household per-tick
// demand. Beyond that, producer surplus has no buyer at the floor; their
// belief drifts down → ask drops → real-market clearing below floor. Caps
// the money-creation rate so farm-co cash growth doesn't compound infinitely.
// At K=2, farm-co revenue/worker ≈ wages (slow growth equilibrium). Higher
// K drives compounding inflation; lower K starves farm-co.
const GOV_BID_BUFFER = 2;

// NPCs grow by building more of their `growthBuilding` once cash clears a
// runway threshold (covers materials at fair price + a wage cushion). Until
// they grow, they bid for missing construction materials and reserve any
// they already hold.
const NPC_GROWTH_RUNWAY_TICKS = 200;
const NPC_GROWTH_BUDGET_FRAC = 0.7;

const CORN_ANCHOR = 50;
// Households consume corn at 0.1/worker/tick × $50 anchor = $5/tick = wage.
// Brick is not a staple — it's a construction good. Producers earn from real
// build demand (player or NPC), not from a synthetic household appetite.
const STAPLES = [
    { item: 'corn',  rate: 0.1, bidPrice: CORN_ANCHOR },
];
// Gov ballasts the wage staple (corn) and a few industrial goods. Corn
// has both bid and ask at anchor (market-maker, midpoint preserves the
// $50 anchor for households). Industrial entries are sterile sinks:
// bid only, at a price slightly above producer ask-floor (fair × 0.525)
// so cleared midpoint clears producer surplus without overshoot. Each
// industrial entry has `qtyCap` (per-tick absolute) to bound money
// creation; without a cap, gov could absorb unbounded supply at high
// fair prices and inflate wildly. The industrial ballast is what lets
// chain producers (coal, coke, etc.) survive when their downstream
// consumers haven't ramped — analogous to gov buying steel for public
// works in real economies.
const GOV_BALLAST = [
    { item: 'corn', bidPrice: CORN_ANCHOR, askPrice: CORN_ANCHOR },
    { item: 'coal', bidPrice: 50, qtyCap: 5 },
    { item: 'pig-iron', bidPrice: 1300, qtyCap: 2 },
];

function fairPrice(data) {
    const items = data.items || {};
    const recipes = data.recipes || {};
    const prices = {};
    for (const id of Object.keys(items)) prices[id] = (items[id].tier || 1) * 10;

    for (let iter = 0; iter < FAIRPRICE_ITERATIONS; iter++) {
        const next = { ...prices };
        for (const item of Object.keys(items)) {
            let best = Infinity;
            for (const r of Object.values(recipes)) {
                const out = (r.outputs || {})[item];
                if (!out) continue;
                let inputCost = 0;
                for (const [inId, amt] of Object.entries(r.inputs || {})) {
                    inputCost += (prices[inId] || 0) * amt;
                }
                const wageCost = (r.workers || 0) * BASE_WAGE * (r.seconds || 0);
                const cost = (inputCost + wageCost) * MARKUP / out;
                if (cost < best) best = cost;
            }
            if (best !== Infinity) next[item] = best;
        }
        Object.assign(prices, next);
    }
    return prices;
}

function inputDemand(actor, recipes) {
    const need = {};
    for (const b of actor.buildings) {
        for (const slot of b.slots) {
            if (!slot) continue;
            const r = recipes[slot.recipe];
            if (!r) continue;
            for (const [item, amt] of Object.entries(r.inputs || {})) {
                need[item] = (need[item] || 0) + amt * NPC_INPUT_BUFFER_CYCLES;
            }
        }
    }
    return need;
}

function recipeForBuilding(actor, data, type) {
    const recipes = data.recipes || {};
    for (const [id, r] of Object.entries(recipes)) {
        if (r.building !== type) continue;
        if (r.tech && !actor.researched.has(r.tech)) continue;
        return { id, ...r };
    }
    return null;
}

// Bottleneck-aware growth target: pick whichever building produces the item
// with the most-negative net flow across the actor's running slots (skill-
// scaled). Falls back to actor.growthBuilding when no internal shortfall.
// Without this, an actor with growthBuilding=kiln keeps stacking kilns past
// the point where their fixed clay-pit can feed them — kilns starve as
// workers skill up.
function growthTarget(actor, data) {
    if (!actor.growthBuilding) return null;
    const recipes = data.recipes || {};
    const buildings = data.buildings || {};
    const byId = new Map((actor.workers || []).map(w => [w.id, w]));
    const flow = {};

    for (const b of actor.buildings || []) {
        for (const slot of b.slots) {
            if (!slot) continue;
            const r = recipes[slot.recipe];
            if (!r) continue;
            const workers = (slot.workerIds || []).map(id => byId.get(id)).filter(Boolean);
            if (workers.length < (r.workers || 0)) continue;
            const mult = outputMultiplier(workers, r.tech);
            const rate = mult / (r.seconds || 1);
            for (const [item, amt] of Object.entries(r.outputs || {})) flow[item] = (flow[item] || 0) + amt * rate;
            for (const [item, amt] of Object.entries(r.inputs || {})) flow[item] = (flow[item] || 0) - amt * rate;
        }
    }

    let worst = { item: null, val: 0 };
    for (const [item, f] of Object.entries(flow)) {
        if (f < worst.val) worst = { item, val: f };
    }
    if (worst.item) {
        for (const r of Object.values(recipes)) {
            if (!((r.outputs || {})[worst.item])) continue;
            if (r.tech && !actor.researched.has(r.tech)) continue;
            if (buildings[r.building]) return r.building;
        }
    }
    return actor.growthBuilding;
}

function growthRunwayCost(actor, data, prices) {
    const target = growthTarget(actor, data);
    if (!target) return 0;
    const def = (data.buildings || {})[target];
    if (!def || !def.construction) return 0;
    // Only count materials the actor would have to BUY. Items already in
    // inventory (because they produce them internally) don't cost cash.
    let materialsCost = 0;
    for (const [item, amt] of Object.entries(def.construction)) {
        const have = actor.inventory[item] || 0;
        const missing = Math.max(0, amt - have);
        materialsCost += (prices[item] || 0) * missing;
    }
    const recipe = recipeForBuilding(actor, data, target);
    const wageRunway = recipe ? (recipe.workers || 0) * BASE_WAGE * NPC_GROWTH_RUNWAY_TICKS : 0;
    return materialsCost + wageRunway;
}

function growthReserve(actor, data, prices) {
    const reserve = {};
    const target = growthTarget(actor, data);
    if (!target) return reserve;
    if ((actor.cash || 0) < growthRunwayCost(actor, data, prices)) return reserve;
    const def = (data.buildings || {})[target];
    if (!def || !def.construction) return reserve;
    for (const [item, amt] of Object.entries(def.construction)) {
        reserve[item] = (reserve[item] || 0) + amt;
    }
    return reserve;
}

function npcOrders(actor, data, prices) {
    const recipes = data.recipes || {};
    const beliefs = actor.priceBelief || {};
    const beliefOf = (item) => beliefs[item] || 1.0;
    const bids = [];
    const asks = [];
    const inputNeed = inputDemand(actor, recipes);
    const growthNeed = growthReserve(actor, data, prices);
    const reserve = { ...inputNeed };
    for (const [item, amt] of Object.entries(growthNeed)) {
        reserve[item] = (reserve[item] || 0) + amt;
    }

    for (const [item, qty] of Object.entries(actor.inventory || {})) {
        if (qty <= 0) continue;
        const surplus = qty - (reserve[item] || 0);
        if (surplus <= 0) continue;
        const price = (prices[item] || 0) * (1 + NPC_SPREAD) * beliefOf(item);
        if (price <= 0) continue;
        asks.push({ actor: actor.id, item, side: 'ask', price, qty: surplus });
    }

    let budget = Math.max(0, (actor.cash || 0) * NPC_BID_BUDGET_FRAC);
    for (const [item, n] of Object.entries(inputNeed)) {
        const have = actor.inventory[item] || 0;
        const short = n - have;
        if (short <= 0) continue;
        const price = (prices[item] || 0) * (1 - NPC_SPREAD) * beliefOf(item);
        if (price <= 0) continue;
        const affordable = Math.floor(budget / price);
        const qty = Math.min(short, affordable);
        if (qty <= 0) continue;
        bids.push({ actor: actor.id, item, side: 'bid', price, qty });
        budget -= price * qty;
    }

    let growthBudget = Math.max(0, (actor.cash || 0) * NPC_GROWTH_BUDGET_FRAC) - budget;
    if (growthBudget < 0) growthBudget = 0;
    for (const [item, n] of Object.entries(growthNeed)) {
        const have = actor.inventory[item] || 0;
        const short = n - have;
        if (short <= 0) continue;
        // Growth bids cross the spread — NPC needs the material to expand
        // and is willing to pay the market ask (fair × 1+spread). Without
        // this, growth bids and surplus asks both sit at ±spread and
        // never clear.
        const price = (prices[item] || 0) * (1 + NPC_SPREAD) * beliefOf(item);
        if (price <= 0) continue;
        const affordable = Math.floor(growthBudget / price);
        const qty = Math.min(short, affordable);
        if (qty <= 0) continue;
        bids.push({ actor: actor.id, item, side: 'bid', price, qty });
        growthBudget -= price * qty;
    }

    return { bids, asks };
}

function householdOrders(actor, data, prices, state) {
    let totalWorkers = 0;
    for (const a of Object.values(state.actors)) totalWorkers += (a.workers || []).length;
    const bids = [];
    let budget = Math.max(0, (actor.cash || 0) * HOUSEHOLD_BID_BUDGET_FRAC);
    for (const s of STAPLES) {
        const target = totalWorkers * s.rate * HOUSEHOLD_BUFFER_TICKS;
        const have = actor.inventory[s.item] || 0;
        const short = Math.max(0, target - have);
        if (short <= 0) continue;
        const affordable = Math.floor(budget / s.bidPrice);
        const qty = Math.min(Math.ceil(short), affordable);
        if (qty <= 0) continue;
        bids.push({ actor: actor.id, item: s.item, side: 'bid', price: s.bidPrice, qty });
        budget -= s.bidPrice * qty;
    }
    return { bids, asks: [] };
}

function governmentOrders(actor, state) {
    const orders = { bids: [], asks: [] };
    const cash = Math.max(0, actor.cash || 0);
    let totalWorkers = 0;
    for (const a of Object.values((state && state.actors) || {})) {
        totalWorkers += (a.workers || []).length;
    }
    for (const b of GOV_BALLAST) {
        const staple = STAPLES.find(s => s.item === b.item);
        const cashCap = Math.floor(cash / b.bidPrice);
        let demandCap;
        if (staple) demandCap = Math.ceil(totalWorkers * staple.rate * GOV_BID_BUFFER);
        else if (b.qtyCap !== undefined) demandCap = b.qtyCap;
        else demandCap = cashCap;
        const bidQty = Math.min(cashCap, demandCap);
        const askQty = actor.inventory[b.item] || 0;
        if (bidQty > 0) orders.bids.push({ actor: actor.id, item: b.item, side: 'bid', price: b.bidPrice, qty: bidQty });
        if (askQty > 0 && b.askPrice !== undefined) orders.asks.push({ actor: actor.id, item: b.item, side: 'ask', price: b.askPrice, qty: askQty });
    }
    return orders;
}

function playerOrders(actor) {
    const bids = [];
    const asks = [];

    for (const [item, price] of Object.entries(actor.priceBook || {})) {
        if (!(price > 0)) continue;
        const qty = actor.inventory[item] || 0;
        if (qty <= 0) continue;
        asks.push({ actor: actor.id, item, side: 'ask', price, qty });
    }

    for (const b of actor.pendingBids || []) {
        if (!b || !(b.price > 0) || !(b.qty > 0)) continue;
        bids.push({ actor: actor.id, item: b.item, side: 'bid', price: b.price, qty: b.qty });
    }

    return { bids, asks };
}

function clear(orders) {
    const byItem = {};
    for (const o of orders) {
        if (!o || !(o.qty > 0)) continue;
        if (!byItem[o.item]) byItem[o.item] = { bids: [], asks: [] };
        const copy = { ...o };
        if (o.side === 'bid') byItem[o.item].bids.push(copy);
        else byItem[o.item].asks.push(copy);
    }

    const trades = [];
    for (const [item, book] of Object.entries(byItem)) {
        book.bids.sort((a, b) => b.price - a.price);
        book.asks.sort((a, b) => a.price - b.price);

        // For each bid (highest first) sweep all asks (lowest first), filling
        // the bid across as many asks as needed. Restarting j per bid is
        // necessary so an ask skipped by self-trade stays reachable to other
        // bids — a single shared pointer would lose it permanently.
        for (const bid of book.bids) {
            if (bid.qty <= 0) continue;
            for (const ask of book.asks) {
                if (bid.qty <= 0) break;
                if (ask.qty <= 0) continue;
                if (bid.price < ask.price) break;
                if (bid.actor === ask.actor) continue;
                const qty = Math.min(bid.qty, ask.qty);
                const price = (bid.price + ask.price) / 2;
                trades.push({ item, buyer: bid.actor, seller: ask.actor, qty, price });
                bid.qty -= qty;
                ask.qty -= qty;
            }
        }
    }
    return trades;
}

module.exports = {
    fairPrice, clear, npcOrders, playerOrders, householdOrders, governmentOrders,
    growthTarget, recipeForBuilding,
    MARKUP, NPC_SPREAD, HOUSEHOLDS_ID, GOVERNMENT_ID, STAPLES, CORN_ANCHOR,
    NPC_GROWTH_RUNWAY_TICKS,
};
