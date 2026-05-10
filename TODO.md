# TODO

## v0 — minimum playable loop

### Done

- [x] `engine/load.js` — YAML loader (nested 2-space maps, inline arrays,
  single-line scalars).
- [x] `engine/schema.js` — refs, tech DAG cycles, productive-items rule,
  actor `starting_workers` / `starting_assignments`.
- [x] `engine/worker.js` — skill update, wage, output multiplier.
- [x] `engine/state.js` — init, save/load, catch-up (24h cap), slot
  allocation, starting assignments, `pendingBids`.
- [x] `engine/tick.js` — production, skill gain, staples consumption
  (drains corn from households by worker-count × rate; brick is not a
  staple), orders → clearing → settlement (gov is money-issuer in settle:
  inventory transfers normally but its cash side is suppressed — money
  spawns when gov buys, is absorbed when gov sells), wages routed to
  households (households + government exempt from paying), bankruptcy
  counter, market history, research progress (flat 1 pt/tick when
  `researchInProgress` is set; scientist concept deferred), liquidation
  at `bankruptTicks > 30` (sell inventory and building construction at
  `fair × 0.5`, drop the actor; households + government exempt).
  Maintenance YAML fields are inert for v0 — no longer debited.
- [x] `engine/market.js` — fixed-point fair price (`workers × BASE_WAGE
  × seconds` for the wage term — `seconds` is ticks, not minutes), NPC
  liquidity orders (surplus asks, input-buffer bids), player orders
  (priceBook auto-asks + one-shot pendingBids), household staple bids
  (anchor-priced; v0 only has corn at $50, rate 0.1/worker/tick → $5/tick
  matches `BASE_WAGE`), government ballast (corn-only: deep bid at
  2× anchor + ask at anchor pins the household corn midpoint to anchor
  regardless of producer ask). Industry (brick, etc.) is not subsidized:
  producers earn from real build demand or die. Per-item double-auction
  `clear` — bids sorted desc / asks asc, each bid sweeps all asks
  (lowest first) so self-trade-skipped asks remain available to other
  bids.
- [x] `cli/play.js` — status, workers, prices, market, tech, tick, hire,
  fire, build, demolish, assign, unassign, set-price, set-bid, research,
  save, reset, quit.
- [x] Seed data: 10 items, 10 recipes, 5 tech, 9 buildings, 5 actors
  (player, rival-co, farm-co, households, government).
- [x] Corn substrate + farm building + `farm-corn` recipe (raw extraction).
- [x] Synthetic `households` actor: absorbs all employer wages each tick,
  consumes one unit of each `STAPLES` item per worker per tick at its
  rate, bids for staples to top up a buffer. Closes the cash loop —
  wages recirculate via the staple markets instead of leaking.
  Bankruptcy and liquidation skipped.
- [x] Synthetic `government` actor: anchors corn (the wage staple) by
  posting a deep bid at 2× anchor + ask at anchor; midpoint with the
  household corn bid clears at anchor. Acts as the money issuer via
  `settle` — its cash side is suppressed, so it can run indefinitely on
  a fixed budget. Pays no wages, immune from bankruptcy. Corn inventory
  accumulates as gov absorbs surplus farm output. Industry items are not
  ballasted — producers stand or fall on real demand.
- [x] `make validate`, `make play`.
- [x] NPC growth strategy. Each actor with a `growth_building` and cash
  above the runway threshold (materials at fair price + a wage cushion)
  bids for missing construction materials at fair × (1 + spread) so the
  growth bid actually crosses producer asks. When all materials are in
  hand, `npcGrow` debits inventory, adds the new building, hires the
  required workers, and auto-assigns them to the new slot. Drives
  organic brick demand from rival/farm expansion. 10k-tick smoke shows
  farm-co growing 1 → 16 farms over ~2500 ticks before brick supply
  consolidates.
- [x] Price discovery via per-actor `priceBelief`. Each actor (except
  households + government) carries a per-item belief multiplier; npcOrders
  uses `fair × (1 ± spread) × belief` for asks/bids/growth-bids. Each tick,
  `applyPriceDrift` nudges belief from the actor's fill outcome:
  fully filled ask / unfilled bid → drift up by PRICE_DRIFT (0.005);
  unfilled ask / fully filled bid → drift down. Clamped to [0.5, 2.0].
  10k-tick smoke: brick clears at $185 (vs static $93 baseline), farm-co
  grows 1 → 38 farms (vs 16), player + rival survive ~2× longer. Beliefs
  saturate at the 2.0 cap by tick 500 because farm-co has no demand
  satiation (see "Demand satiation" item below).

- [x] Gov bid quantity cap. `governmentOrders` caps the corn bid at
  `GOV_BID_BUFFER × totalWorkers × stapleRate` (currently 3× household
  per-tick demand). Beyond the cap, producer surplus has no buyer at
  the floor; farm-co's belief drifts to the 0.5 floor, ask drops to
  fair × 1.05 × 0.5 = $3.78, household trades clear at midpoint $27
  instead of the $50 anchor. 10k smoke: farm-co cash growth ~30%
  slower ($7.1M vs $9.9M @ 5000), but brick belief still saturates at
  cap because farm-co's residual cash growth is still fast enough to
  outrun brick supply. Producer death timing unchanged — bottleneck is
  brick-side, not money-side.

- [x] Bottleneck-aware NPC growth. Added `growthTarget(actor, data)`:
  computes per-item net flow (skill-scaled multiplier × workers /
  seconds × output - input) across the actor's running slots; picks a
  building producing the most-negative-flow item; falls back to
  `growth_building` when no internal shortfall. `growthRunwayCost`
  also fixed to count only MISSING materials (in-inventory ones don't
  drain cash). 5k smoke @5000: player w:38 b:38, rival w:43 b:44
  (both alive vs DEAD before), farm-co w:1028 b:257 (vs 38). Clay
  trades emerge organically as actors with surplus sell to those
  short. Brick still clears at $185 cap because farm-co cash growth
  ($20M) still outpaces brick supply expansion.

- [x] Gov bid lowered to 1×anchor. Both gov bid and ask now at $50;
  gov is a flat market-maker without spread. Midpoint with farm-co's
  belief-driven ask matches the household midpoint — no implicit
  $52/$27 price subsidy. 5k smoke @5000: farm-co cash $8M (was
  $19.8M, 60% drop); same building/worker counts (growth was
  supply-bound, not cash-bound); corn clears uniformly at $29.
  Farm-co belief drifted UP to 1.10 (from 0.5 floor) — the tighter
  market made fill < 100%, so belief found a level instead of
  saturating.

- [x] Tighten gov bid cap K=3 → K=2. Cuts gov absorption to 2× household
  per-tick demand. Smoke @5000: farm-co cash $4.7M (was $8M @ K=3, $19.8M
  pre-fixes — total 76% inflation reduction). Side effect: farm-co
  accumulates large unsold corn surplus (107k @ 5000) since production
  outruns total demand. Producers stable at low cash. Same growth
  trajectory (still supply-bound on brick).

### Next: organic loop tuning

- [x] Richer economy — chain producers viable. Reduced wage scaling
  from `BASE_WAGE × (1+2×skill)` to `BASE_WAGE × (1+0.5×skill)`: wages
  range $5–$7.5 (1.5×) while output still scales 4× (0.5→2.0). The wider
  output/wage ratio gives chain producers (coke-co, ore-co) operating
  margin without belief saturation. Added coke-co (1 oven, 1 worker,
  coal-tar) and ore-co (1 mine + 1 quarry + 1 blast-furnace, 7 workers,
  ironworking) with pig-iron gov ballast at $1300 qtyCap=2. 5k smoke:
  player + rival ALIVE (96/94 buildings); coke-co + ore-co ALIVE; 6 items
  trade (brick, corn, clay, coal, coke, pig-iron) up from 3.
  Side benefit: brick economy stronger too — buildings 38 → 96 with
  same starting cash, since wage burden cut 50% at full skill.

- [ ] Steel-co attempt failed. Tried adding steel-co (1 blast-furnace,
  3 workers, smelt-steel) with steel ballast at $2700 qtyCap=1 and
  pig-iron bid lowered to $1100 to let steel-co compete for input.
  Result: steel-co died @2500, ore-co died @5000. Root issue: fair
  price for steel ($2706) is computed assuming inputs at *fair* prices,
  but real market clears coke at ~$700 (above fair $533) and pig-iron
  at $1098 (below fair $1313 — gov bid pinned it). Steel-co's actual
  cost: 2×$1098 + 1×$700 + wages = $3402; sell at $2699 = -$703/steel.
  Also lowering pig-iron bid to $1100 dropped ore-co below break-even.
  Tried (a) full-skill assumption in fair price formula — when wage_mult
  proportional to output_mult, ratio cancels and result identical to old
  formula. Tried (b) raw material sinks (iron-ore $40, limestone $50)
  — caused ore-co over-growth (4→5 buildings) and bankruptcy.
  Conclusion: for v0, steel chain doesn't fit. Without belief
  saturation cushion, steel-co's 3-worker recipe with 2 high-priced
  inputs has no margin. Possible v1 paths:
  (1) Gov as broker (bid + ask at different prices for pig-iron),
  letting steel-co buy from gov at predictable price above ore-co's
  clearing.
  (2) Restructure recipes to reduce labor share (more output per
  recipe firing).
  (3) Belief drift floor at fair (not 0.5) so producers always ask >
  fair, making chain math work.

- [ ] Brick belief still pins at 2.0 cap. Producer growth has caught up
  on volume (player + rival together = 82 buildings vs farm-co's 255)
  but brick price stays at the belief ceiling because farm-co's growth
  bid 100%-fills each tick. Without raising MAX_BELIEF, brick is
  effectively a fixed-price commodity in equilibrium. Worth letting
  this be for v0 — the cap is a sanity bound, not a dynamic price.
- [ ] Farm-co corn surplus accumulates with K=2 (107k corn @ 5000).
  Tried (a) belief-floor scale-back: skip growth when output belief sits
  at MIN_BELIEF. Result: player+rival DEAD by @1000. Farm-co's runaway
  growth is load-bearing — its construction-material demand (30 brick per
  farm × N farms) is the brick market that funds player+rival. Killing
  the runaway kills the closed loop. Surplus is structural: each new
  farm adds +5.47 corn/tick of NET surplus (supply > demand growth) but
  its workers expand gov's K-capped bid quantity, so each farm stays
  profitable. Belief-at-floor correctly detects oversupply, but acting
  on it breaks the broader system. Either (b) corn export sink (sterile
  buyer outside the economy that doesn't feed back into demand growth),
  or (c) accept the pile for v0.
- [ ] Skill ramp-up trap. At skill 0, output multiplier is 0.5; wage
  multiplier is 1.0. Productivity-per-wage = 0.5, below break-even at
  fair price for fire-bricks. Workers reach productive skill (~mult
  1.0) only after ~400 ticks. Producers survive on starting cash —
  rival-co bottoms at $2,465 ~tick 1500 with current 0.5× wage scaling.
  Tried (a) pre-train starting workers to skill=0.3 in their assigned
  tech (output_mult 0.95, wage_mult 1.15). Result: rival/farm survival
  margins improved slightly ($2.5K → $2.8K min for rival), but coke-co
  + ore-co DIED @5000 — higher early productivity → faster growth →
  oversupply on coke ($723 → $280 floor) → revenue collapsed.
  Conclusion: the trap is real but the system has converged around it
  via starting-cash buffers + brick belief saturation cushion. Curing
  it disturbs the chain-producer balance. Accept for v0; revisit when
  belief floor or recipe restructuring is in place (see steel-co paths).
- [x] Clay-pit:kiln imbalance — resolved by `growthTarget`. 5k smoke:
  rival-co organically grew 31 clay-pits + 59 kilns + 1 coal-mine
  (started with 1 + 1 + 1) without any tuning to its `growth_building`
  field. The bottleneck-aware target picks whichever input is most
  starved per-tick, so kilns don't starve as workers skill up.
- [x] Money supply leak at liquidation — fixed. Dying actor's residual
  cash + fair × 0.5 recovery on inventory + construction is now routed
  to households instead of vanishing. Smoke @5000 with one liquidation
  (passive headless player) shows households cash bumped by ~$17K (the
  player's residual) — money supply stays bounded by gov issuance.
- [ ] Farm over-production. Farm produces 1.67 corn/tick but households
  only consume 0.4–0.8 corn/tick at 4–8 workers. Gov absorbs the
  surplus indefinitely (cash-free since it's the issuer), but corn
  inventory in gov grows without bound.

## Spatial layer brainstorm (v1, parking lot)

Replaces the implicit single-location world with a sparse graph of cities.
Keep it abstract — scalar distances, no 2D grid, no pathfinding.

### Topology

- **City** — graph node with `size` (drives lot supply + market liquidity)
  and a pool of lots. Each city has its own market.
- **Lot** — rolled `{distance_to_center, capacity}`. Capacity is the total
  building footprint that fits.
- **Building** — gains a `footprint` field; lives on a specific lot; sum
  of footprints on a lot ≤ `lot.capacity`.
- **Edge `(city_a, city_b)`** — scalar distance in `world.yml`, sparse
  adjacency.

### Cost stack (per shipment)

- **Seller local toll**: `qty × item.size × seller_lot.dist_to_center ×
  toll_rate`.
- **Inter-city transport**: `qty × item.size × city_distance ×
  transport_rate / vehicle_capacity`.
- **Buyer local toll**: same shape as seller, paid by buyer.
- Vehicle tiers tech-gated (cart → wagon → rail → ...). Bigger capacity
  = cheaper per-unit on the inter-city term.

### Lot lifecycle

- Cities passively mint lots as `size` grows; auctioned.
- Player can pay to force a roll — N draws, keep one. Cost scales with
  city size.
- Lot price = `f(distance, capacity, city.size)`.
- Demolishing a building frees lot footprint; lot stays owned.

### Markets and inventory

- Inventory is per-actor-per-city.
- Per-city order books. `fair_price` computed per-city — geographic
  arbitrage falls out for free.
- Cross-city orders allowed; bid must beat local asks plus full transport
  stack to clear.
- New `transfer <item> <qty> <from-city> <to-city>` command for intra-
  actor logistics; pays the full stack.

### Open questions

- Starting lots: pre-baked in `world.yml` per actor, or auto-rolled at
  game start?
- Item size: reuse `item.tier`, or add explicit `transport_size`?
- City as market participant — buys inputs to grow, sells lots, collects
  tolls? Or invisible?
- Are lots tradable between actors? Default no (demolish-and-reauction).
- Per-recipe transport gates (e.g. blast furnace requires rail-tier for
  iron-ore)?
- Schema-breaking shift (`inventory[city][item]`, building→lot refs,
  per-city `marketHistory`); worth doing as a clean v1 break, not a v0
  retrofit.

## v1+ — later

- [ ] Loans + equity finance.
- [ ] Strategic NPCs (cornering, undercut, tech race) — current NPCs only
  follow their starting assignments; no dynamic behavior.
- [ ] First-mover monopoly window for newly-researched tech.
- [ ] Information era recipes (semiconductors, computing).
- [ ] Contemporary era (batteries, EVs, biotech).
- [ ] Space/future era (orbital, fusion).
- [ ] Web UI on top of the engine.
- [ ] Finite/depleting deposits with mining claims.

## Conventions

- Update this file when scope changes — don't let it drift.
- `make validate` before committing data changes.
- Item/recipe/tech/building ids: `lowercase-with-hyphens`.
