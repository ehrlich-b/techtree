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
 * governmentOrders: the 'government' actor ballasts items declaring a
 * `gov_ballast: { bid_price, ask_price?, qty_cap }` block in items.yml.
 * Corn has both bid and ask at anchor (market-maker); other entries are
 * bid-only "buyer of last resort" — they only clear when producer ask
 * has drifted below gov bid (i.e., real demand failed). Cash side is
 * suppressed in settle: gov is the money issuer; trades create money for
 * sellers and absorb it from buyers.
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

// Household demand config lives on each item (data/items.yml,
// `household: { rate, bid_price, elasticity? }`). `staples(data)` reads
// that block and yields per-tick consumption + bid anchor for every item
// flagged as household-consumed. Adding a new staple is now a one-line
// schema edit on the item; no engine changes needed.
//
// Elasticity: when set on an item, demand scales with the population
// ratio so luxury items grow faster than necessities as the economy
// thrives. Per-tier defaults are all 0 — items opt in via
// `household.elasticity`. Early experiments at tier-based defaults
// 0.2–0.4 destabilized the chain (modest worker growth produced
// significant demand spikes that producers couldn't keep up with).
// Leaving the mechanism available without defaulting to it.
const DEFAULT_TIER_ELASTICITY = { 1: 0.0, 2: 0.0, 3: 0.0, 4: 0.0, 5: 0.0 };

function staples(data) {
    if (data._staplesCache) return data._staplesCache;
    const list = [];
    for (const [id, item] of Object.entries(data.items || {})) {
        const h = item && item.household;
        if (!h || !(h.rate > 0)) continue;
        const tier = item.tier || 1;
        const elasticity = h.elasticity !== undefined
            ? h.elasticity
            : (DEFAULT_TIER_ELASTICITY[tier] || 0);
        list.push({
            item: id,
            rate: h.rate,
            bidPrice: h.bid_price || 0,
            elasticity,
        });
    }
    // Sort by spending impact (rate × bidPrice) descending. Order matters
    // because households iterate the list and deplete a shared budget;
    // putting the biggest-spend items first ensures necessities get funded
    // before luxuries when the budget tightens.
    list.sort((a, b) => (b.rate * b.bidPrice) - (a.rate * a.bidPrice));
    data._staplesCache = list;
    return list;
}
// Gov ballasts items declaring a `gov_ballast` block in items.yml. Corn
// has both bid_price and ask_price (market-maker, midpoint preserves the
// $50 anchor for households). Industrial entries are sterile sinks: bid
// only. Each entry has `qty_cap` (per-tick absolute) to bound money
// creation; without a cap, gov could absorb unbounded supply at high
// fair prices and inflate wildly. The industrial ballast is what lets
// chain producers (coal, coke, etc.) survive when their downstream
// consumers haven't ramped — analogous to gov buying steel for public
// works in real economies.
function govBallast(data) {
    if (data._govBallastCache) return data._govBallastCache;
    const list = [];
    for (const [id, item] of Object.entries(data.items || {})) {
        const g = item && item.gov_ballast;
        if (!g || !(g.bid_price > 0) || !(g.qty_cap > 0)) continue;
        const entry = { item: id, bidPrice: g.bid_price, qtyCap: g.qty_cap };
        if (g.ask_price !== undefined) entry.askPrice = g.ask_price;
        list.push(entry);
    }
    data._govBallastCache = list;
    return list;
}

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
    const researched = actor.researched || new Set();
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
        if (!def) continue;
        if (def.maintenance && typeof def.maintenance === 'object') {
            for (const [item, rate] of Object.entries(def.maintenance)) {
                need[item] = (need[item] || 0) + rate * NPC_MAINTENANCE_BUFFER_TICKS;
            }
        }
        if (def.tech_maintenance && typeof def.tech_maintenance === 'object') {
            for (const [techId, items] of Object.entries(def.tech_maintenance)) {
                if (!researched.has(techId)) continue;
                for (const [item, rate] of Object.entries(items || {})) {
                    need[item] = (need[item] || 0) + rate * NPC_MAINTENANCE_BUFFER_TICKS;
                }
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

// Belief-weighted margin per recipe: estimate how profitable each recipe
// the actor could run would be, using fair_price × actor.priceBelief as
// the actor's price expectation for each item. Returns highest-margin
// recipe whose margin exceeds MIN_GROWTH_MARGIN_PER_TICK. Cross-niche
// entry is allowed into raw extraction only (no input chain risk) with
// a pivot penalty.
const MIN_GROWTH_MARGIN_PER_TICK = 1.0;
// Pivot penalty: cross-niche entry (building type the actor doesn't own
// yet) gets its margin discounted by this factor. Captures unmodeled
// costs: cold-start worker skill, construction overhead, demand
// uncertainty in a new niche. With penalty 0.4, a pivot recipe must
// look 2.5× more profitable than the actor's owned recipes to win.
const PIVOT_PENALTY = 0.4;

// Per-tick belief-weighted margin for one recipe. For raw extraction
// (no inputs), output is scaled by 1/sqrt(postBuildCount) to match
// runProduction's diminishing-returns factor — otherwise margin
// over-estimates and actors keep building money-losing raw extractors.
// postBuildCount is the number of same-type buildings AFTER adding one
// more (so the caller can ask "would building one more be profitable?").
//
// marketHistory (optional): when provided, per-output revenue is scaled
// down by a saturation factor if the recipe's per-tick output exceeds
// what the market has been clearing recently. Caps the false-positive
// margin signal on items where gov caps absorb less than theoretical
// supply (pig-iron, steel, machine-tool). Disabled if marketHistory is
// absent or item has <MIN_VOLUME_SAMPLES recent entries.
const MIN_VOLUME_SAMPLES = 10;
function outputSaturation(item, perTickOutput, marketHistory, currentTick) {
    if (!marketHistory) return 1.0;
    const hist = marketHistory[item];
    if (!hist || hist.length < MIN_VOLUME_SAMPLES) return 1.0;
    let totalQty = 0;
    for (const e of hist) totalQty += e.qty;
    const span = Math.max(1, currentTick - hist[0].tick);
    const marketRate = totalQty / span;
    if (marketRate >= perTickOutput) return 1.0;
    return marketRate / perTickOutput;
}

function recipeMarginPerTick(r, actor, prices, postBuildCount, marketHistory, currentTick) {
    const beliefs = actor.priceBelief || {};
    const isRaw = !r.inputs || Object.keys(r.inputs).length === 0;
    const drFactor = isRaw ? 1.0 / Math.sqrt(postBuildCount || 1) : 1.0;
    const seconds = r.seconds || 1;
    let rev = 0;
    for (const [item, qty] of Object.entries(r.outputs || {})) {
        const fairP = prices[item] || 0;
        const belief = beliefs[item] !== undefined ? beliefs[item] : 1.0;
        const perTickOutput = qty * drFactor / seconds;
        const sat = outputSaturation(item, perTickOutput, marketHistory, currentTick || 0);
        rev += qty * drFactor * fairP * belief * sat;
    }
    let inputCost = 0;
    for (const [item, qty] of Object.entries(r.inputs || {})) {
        const fairP = prices[item] || 0;
        const belief = beliefs[item] !== undefined ? beliefs[item] : 1.0;
        inputCost += qty * fairP * belief;
    }
    const wageCost = (r.workers || 0) * BASE_WAGE * (r.seconds || 0);
    const cycleMargin = rev - inputCost - wageCost;
    return cycleMargin / (r.seconds || 1);
}

function marginRecipe(actor, data, prices, marketHistory, currentTick) {
    const recipes = data.recipes || {};
    const buildings = data.buildings || {};
    const haveTypes = new Set((actor.buildings || []).map(b => b.type));
    const countByType = {};
    for (const b of actor.buildings || []) countByType[b.type] = (countByType[b.type] || 0) + 1;
    let best = { building: null, margin: 0 };
    for (const r of Object.values(recipes)) {
        if (r.tech && !actor.researched.has(r.tech)) continue;
        if (!buildings[r.building]) continue;
        const owned = haveTypes.has(r.building);
        const isRaw = !r.inputs || Object.keys(r.inputs).length === 0;
        // Cross-niche entry: only into raw extraction (no input chain
        // dependency). Owned-niche expansion always allowed. Processing
        // recipes in unowned buildings are skipped — the actor would
        // need to source inputs they don't already produce.
        if (!owned && !isRaw) continue;
        const postBuildCount = (countByType[r.building] || 0) + 1;
        const baseMargin = recipeMarginPerTick(r, actor, prices, postBuildCount, marketHistory, currentTick);
        const pivotPenalty = owned ? 1.0 : PIVOT_PENALTY;
        const score = baseMargin * pivotPenalty;
        if (score > best.margin) {
            best = { building: r.building, margin: score };
        }
    }
    return best;
}

// Growth target priority:
// 1. Margin-driven: highest belief-weighted per-tick margin recipe.
//    Picks up new opportunities (researched techs, items clearing high)
//    and prunes oversupplied recipes (belief drifts down → margin
//    negative → ignored).
// 2. Bottleneck: most-negative net flow item drives expansion of a
//    recipe producing it. Useful for internal supply chain (e.g., need
//    more clay for kilns).
// 3. Fallback to actor.growthBuilding (hand-coded seed direction).
// Vertical integration is restricted in all paths: actors can grow into
// owned building types or raw extraction. Can't grow into processing
// buildings they don't own — that would consolidate chain producers.
function growthTarget(actor, data, prices, marketHistory, currentTick) {
    if (!actor.growthBuilding) return null;
    // 1. Margin-driven: pick the highest-margin recipe the actor could
    //    run. Belief drift makes this self-correcting — oversupplied
    //    items belief-floor → margin negative → drop. New techs unlock
    //    recipes at default belief 1.0 → positive margin (cost × markup
    //    spread) → adoption.
    if (prices) {
        const m = marginRecipe(actor, data, prices, marketHistory, currentTick);
        if (m.building && m.margin >= MIN_GROWTH_MARGIN_PER_TICK) return m.building;
    }
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
    // Falling back to default growthBuilding — gate on oversupply.
    // Primary gate: post-build margin. If building one more would lose
    // money per tick (after DR for raw extraction), don't grow. Catches
    // raw extractors before they bankrupt themselves (belief 0.8-0.95
    // range where margin is negative but belief-floor hasn't fired).
    // Secondary gate: belief floor (existing) as a strict safety bound.
    // Resilience: when demand returns, belief drifts up and growth resumes.
    const fallbackRecipe = recipeForBuilding(actor, data, actor.growthBuilding);
    if (fallbackRecipe && prices) {
        const countByType = {};
        for (const b of actor.buildings || []) countByType[b.type] = (countByType[b.type] || 0) + 1;
        const postBuildCount = (countByType[actor.growthBuilding] || 0) + 1;
        const margin = recipeMarginPerTick(fallbackRecipe, actor, prices, postBuildCount, marketHistory, currentTick);
        if (margin < MIN_GROWTH_MARGIN_PER_TICK) return null;
        const beliefs = actor.priceBelief || {};
        for (const item of Object.keys(fallbackRecipe.outputs || {})) {
            const b = beliefs[item];
            if (b !== undefined && b <= GROWTH_FLOOR_BELIEF) return null;
        }
    }
    return actor.growthBuilding;
}

function growthRunwayCost(actor, data, prices) {
    const target = growthTarget(actor, data, prices);
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
    const target = growthTarget(actor, data, prices);
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

// Income-elastic demand: luxury items scale faster than necessities as the
// economy grows. The scaling input is total worker count (population
// proxy) — using household cash directly created runaway multipliers
// since gov subsidies inflate household cash faster than economy size.
// BASELINE_WORKERS is the initial worker count at game start; at that
// size every multiplier is 1.0.
const BASELINE_WORKERS = 30;

function householdOrders(actor, data, prices, state) {
    let totalWorkers = 0;
    for (const a of Object.values(state.actors)) totalWorkers += (a.workers || []).length;
    const bids = [];
    let budget = Math.max(0, (actor.cash || 0) * HOUSEHOLD_BID_BUDGET_FRAC);
    const ratio = Math.max(1, totalWorkers / BASELINE_WORKERS);
    for (const s of staples(data)) {
        const elast = Math.pow(ratio, s.elasticity || 0);
        const target = totalWorkers * s.rate * elast * HOUSEHOLD_BUFFER_TICKS;
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

function governmentOrders(actor, state, data) {
    const orders = { bids: [], asks: [] };
    const cash = Math.max(0, actor.cash || 0);
    let totalWorkers = 0;
    for (const a of Object.values((state && state.actors) || {})) {
        totalWorkers += (a.workers || []).length;
    }
    const stapleList = data ? staples(data) : [];
    const ballast = data ? govBallast(data) : [];
    for (const b of ballast) {
        const staple = stapleList.find(s => s.item === b.item);
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
    growthTarget, recipeForBuilding, recipeMarginPerTick, staples,
    MARKUP, NPC_SPREAD, HOUSEHOLDS_ID, GOVERNMENT_ID,
    NPC_GROWTH_RUNWAY_TICKS,
};
