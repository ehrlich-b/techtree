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
const NPC_MAINTENANCE_BUFFER_TICKS = 200;
const NPC_BID_BUDGET_FRAC = 0.5;

// Fire-sale discount on ask prices when the actor is in stress. Distressed
// (cash on credit) actors halve their ask to attract buyers; insolvent
// actors slash further. Bypasses the belief-floor clamp — a dying seller
// will take almost anything for inventory.
const FIRE_SALE_DISCOUNT_DISTRESSED = 0.5;
const FIRE_SALE_DISCOUNT_INSOLVENT = 0.2;

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
// Growth gate: if the actor's belief for their growthBuilding's output has
// drifted to (or near) the floor of [MIN_BELIEF, MAX_BELIEF], they're
// overproducing — block fallback growth. Set slightly above MIN_BELIEF
// (0.5) so the gate fires once belief has hit the floor and hasn't yet
// drifted back up.
const GROWTH_FLOOR_BELIEF = 0.55;

const CORN_ANCHOR = 50;
const BOTTLE_ANCHOR = 300;
const BRICK_ANCHOR = 120;
const GLASS_ANCHOR = 400;
const COTTON_ANCHOR = 40;
const CLOTH_ANCHOR = 1500;
const SULFUR_ANCHOR = 70;
// Households consume corn at 0.1/worker/tick × $50 anchor = $5/tick = wage.
// Bottle at 0.005/worker/tick × $300 = $1.5/tick — minor secondary demand
// for the sand→glass→bottle chain. Brick at 0.01/worker/tick × $120 = $1.2/
// tick — housing wear, gives kiln operators a durable demand sink so they
// don't cycle death-respawn from anemic build-only demand. Glass at 0.001/
// worker/tick × $400 — windows, absorbs glass-co surplus. Cotton at 0.003/
// worker/tick × $40 — bedding/raw fiber, gives cotton-co a demand sink
// beyond just textile-co's single spinning-mill (otherwise 5× oversupply
// → cotton-co dies). Cloth at 0.001/worker/tick × $1500 — clothing,
// absorbs textile-co's woven output. Sulfur at 0.003/worker/tick × $70 —
// matches/preservatives, gives sulfur-co dual demand alongside chemical-
// co's acid distillation (single-consumer dependency caused chronic
// sulfur-co death-cycle). All bidPrices stay below NPC max bid (fair ×
// 0.95 × 2.0) so NPCs win when they need the item for construction/
// maintenance.
const STAPLES = [
    { item: 'corn',   rate: 0.1,   bidPrice: CORN_ANCHOR },
    { item: 'bottle', rate: 0.005, bidPrice: BOTTLE_ANCHOR },
    { item: 'brick',  rate: 0.01,  bidPrice: BRICK_ANCHOR },
    { item: 'glass',  rate: 0.001, bidPrice: GLASS_ANCHOR },
    { item: 'cotton', rate: 0.003, bidPrice: COTTON_ANCHOR },
    { item: 'cloth',  rate: 0.001, bidPrice: CLOTH_ANCHOR },
    { item: 'sulfur', rate: 0.003, bidPrice: SULFUR_ANCHOR },
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
    // Corn qtyCap caps gov's per-tick money creation rate. Without it, gov
    // bid quantity scales with totalWorkers (via STAPLES.rate), so as the
    // economy grows the money supply inflates linearly. At 8 corn/tick ×
    // ~$30 vwap = ~$240/tick of fresh money — enough to keep farm-co
    // profitable without unbounded inflation. Households still buy the
    // rest of farm-co's output (transfer, not creation).
    { item: 'corn', bidPrice: CORN_ANCHOR, askPrice: CORN_ANCHOR, qtyCap: 8 },
    { item: 'coal', bidPrice: 50, qtyCap: 5 },
    { item: 'pig-iron', bidPrice: 1300, qtyCap: 2 },
    { item: 'steel', bidPrice: 3000, qtyCap: 1 },
    { item: 'machine-tool', bidPrice: 30000, qtyCap: 1 },
];

// fairPrice depends only on `data` (immutable during a game), so we memoize
// it on `data._fairPriceCache`. Saves ~6400 inner-loop iterations per tick.
function fairPrice(data) {
    if (data._fairPriceCache) return data._fairPriceCache;
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
    data._fairPriceCache = prices;
    return prices;
}

function inputDemand(actor, recipes, buildings) {
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
        const def = buildings && buildings[b.type];
        if (def && def.maintenance && typeof def.maintenance === 'object') {
            for (const [item, rate] of Object.entries(def.maintenance)) {
                need[item] = (need[item] || 0) + rate * NPC_MAINTENANCE_BUFFER_TICKS;
            }
        }
    }
    return need;
}

// Prefer the highest-tier recipe (highest research_cost) the actor has
// unlocked. Without this, blast-furnaces always assign smelt-pig-iron even
// after bessemer is researched, so the tech tree is researched but never
// adopted. Raw extractions (no tech) get cost 0 and are picked when no
// tech-gated recipe is available.
function recipeForBuilding(actor, data, type) {
    const recipes = data.recipes || {};
    const tech = data.tech || {};
    let best = null;
    let bestCost = -1;
    for (const [id, r] of Object.entries(recipes)) {
        if (r.building !== type) continue;
        if (r.tech && !actor.researched.has(r.tech)) continue;
        const cost = r.tech ? ((tech[r.tech] || {}).research_cost || 0) : 0;
        if (cost > bestCost) {
            best = { id, ...r };
            bestCost = cost;
        }
    }
    return best;
}

// Bottleneck-aware growth target: pick whichever building produces the item
// with the most-negative net flow across the actor's running slots (skill-
// scaled). Falls back to actor.growthBuilding when no internal shortfall.
// Vertical integration is restricted: actors can grow into building types
// they already own (internal scaling — add another clay-pit when kilns
// starve), or into RAW EXTRACTION buildings (no recipe inputs — coal-mine,
// iron-mine, quarry, clay-pit, farm). They CAN'T grow into processing
// buildings of types they don't own (kiln, coke-oven, blast-furnace), since
// that would consolidate chain producers — e.g., ore-co growing a coke-oven
// kills coke-co's market. Raw extractors are foundational and don't displace
// chain partners.
function growthTarget(actor, data) {
    if (!actor.growthBuilding) return null;
    const recipes = data.recipes || {};
    const buildings = data.buildings || {};
    // Reuse the worker index that tick.js builds at top of tick (saves
    // allocating a fresh Map per call). Fall back to building one if absent.
    let byId = actor._workerIndex;
    if (!byId || actor._workerIndexCount !== actor.workers.length) {
        byId = {};
        for (const w of actor.workers) byId[w.id] = w;
        actor._workerIndex = byId;
        actor._workerIndexCount = actor.workers.length;
    }
    const flow = {};

    for (const b of actor.buildings || []) {
        for (const slot of b.slots) {
            if (!slot) continue;
            const r = recipes[slot.recipe];
            if (!r) continue;
            const workerIds = slot.workerIds || [];
            const slotWorkers = [];
            for (const id of workerIds) {
                const w = byId[id];
                if (w) slotWorkers.push(w);
            }
            if (slotWorkers.length < (r.workers || 0)) continue;
            const mult = outputMultiplier(slotWorkers, r.tech);
            const rate = mult / (r.seconds || 1);
            for (const [item, amt] of Object.entries(r.outputs || {})) flow[item] = (flow[item] || 0) + amt * rate;
            for (const [item, amt] of Object.entries(r.inputs || {})) flow[item] = (flow[item] || 0) - amt * rate;
        }
    }

    const haveTypes = new Set((actor.buildings || []).map(b => b.type));
    let worst = { item: null, val: 0 };
    for (const [item, f] of Object.entries(flow)) {
        if (f < worst.val) worst = { item, val: f };
    }
    if (worst.item) {
        for (const r of Object.values(recipes)) {
            if (!((r.outputs || {})[worst.item])) continue;
            if (r.tech && !actor.researched.has(r.tech)) continue;
            const isRaw = !r.inputs || Object.keys(r.inputs).length === 0;
            if (!isRaw && !haveTypes.has(r.building)) continue;
            if (buildings[r.building]) return r.building;
        }
    }
    // Falling back to default growthBuilding — gate on oversupply. If the
    // actor's belief for the fallback recipe's output has pinned at floor,
    // they're overproducing relative to demand; don't grow further.
    // Resilience: when demand returns, belief drifts up and growth resumes.
    // Cluster damage from this gate (e.g., kilns starve when farm-co stops
    // building farms → brick demand drops) is absorbed by respawn.
    const fallbackRecipe = recipeForBuilding(actor, data, actor.growthBuilding);
    if (fallbackRecipe) {
        const beliefs = actor.priceBelief || {};
        for (const item of Object.keys(fallbackRecipe.outputs || {})) {
            const b = beliefs[item];
            if (b !== undefined && b <= GROWTH_FLOOR_BELIEF) return null;
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
    const inputNeed = inputDemand(actor, recipes, data.buildings || {});
    const growthNeed = growthReserve(actor, data, prices);
    const reserve = { ...inputNeed };
    for (const [item, amt] of Object.entries(growthNeed)) {
        reserve[item] = (reserve[item] || 0) + amt;
    }

    const stress = actor.stress || 0;
    let stressDiscount = 1.0;
    if (stress >= 4) stressDiscount = FIRE_SALE_DISCOUNT_INSOLVENT;
    else if (stress >= 3) stressDiscount = FIRE_SALE_DISCOUNT_DISTRESSED;
    for (const [item, qty] of Object.entries(actor.inventory || {})) {
        if (qty <= 0) continue;
        // Stressed actors release reserved inventory too — survival beats
        // future growth. Distressed: sell down to half reserve. Insolvent:
        // sell everything.
        let effectiveReserve = reserve[item] || 0;
        if (stress >= 4) effectiveReserve = 0;
        else if (stress >= 3) effectiveReserve = effectiveReserve / 2;
        const surplus = qty - effectiveReserve;
        if (surplus <= 0) continue;
        const price = (prices[item] || 0) * (1 + NPC_SPREAD) * beliefOf(item) * stressDiscount;
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
        // Order matters: explicit qtyCap wins over worker-scaled staple
        // demand. Worker-scaled corn made money creation grow with the
        // economy, which inflated indefinitely. qtyCap caps the rate.
        let demandCap;
        if (b.qtyCap !== undefined) demandCap = b.qtyCap;
        else if (staple) demandCap = Math.ceil(totalWorkers * staple.rate * GOV_BID_BUFFER);
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
