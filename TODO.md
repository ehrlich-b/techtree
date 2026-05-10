# TODO

## v0 — minimum playable loop

### Done

- Engine: `load.js`, `schema.js`, `worker.js`, `state.js`, `tick.js`, `market.js`.
- CLI: `cli/play.js` with status, workers, prices, market, tech, tick, hire,
  fire, build, demolish, assign, unassign, set-price, set-bid, research,
  save, reset, quit.
- Seed data: 10 items, 10 recipes, 5 tech, 9 buildings, 8 actors.
- Synthetic households (wage absorber + corn consumer) and government (money
  issuer + ballast).
- NPC growth: bottleneck-aware; raw-extraction-only vertical integration
  preserves chain partners.
- Per-actor `priceBelief` drift on fill outcomes, clamped to [0.5, 2.0].
- Money-supply leak at liquidation plugged (recovery routes to households).
- NPC research (auto-pick cheapest unresearched tech) + adoption via
  slot-fill (pre-trained skill 0.5 in newly-unlocked tech).
- Smoke @5000: 7 items trade, 5/5 tech researched, all NPCs alive.

### Accepted-as-v0 limitations (deferred to v1)

- Brick belief saturates at 2.0× cap; treated as sanity bound, not a
  dynamic price.
- Farm-co corn surplus accumulates structurally — gov absorbs without
  bound, money supply on corn unbounded.
- Skill ramp-up trap mitigated only at slot-fill (pre-trained 0.5).
  Workers hired by `npcGrow` still ramp from skill 0.

## v1 — fix the scaffolding

### Adversarial findings (5000-tick smoke probes)

The v0 economy is held up by hand-tuned gov ballast. Evidence:

- **Remove all gov ballast → all 5 NPCs die.** Most items never trade.
- **Remove just machine-tool ballast → ore-co + coke-co also die** (cascade
  from leaf demand removal). The chain hangs entirely from gov.
- **Most prices saturate at the belief cap or floor**, not finding
  equilibrium: brick 2.10× fair, iron-ore/coke/pig-iron/steel beliefs at
  2.0 for major actors; limestone 0.50 (floor).
- **Fully deterministic** — same starting state, identical outcome
  bit-for-bit. No path dependence, no exploration of alternative equilibria.
- **Hard-coded scaffolding**: gov ballast prices ($50/50/1300/3000/30000),
  per-actor `growth_building`, K=2 gov bid multiplier, ADOPTION_RUNWAY=1000,
  STARTING_SKILL=0.5, vertical-integration-only-for-raw-extraction rule,
  recipe ratios + construction costs sized to make survival work.

It's a simulation OF an economy, not an emergent one. The v1 work below
replaces hand-tuned scaffolding with mechanisms that produce real emergence:
prices find non-cap levels, supply chains survive single-actor loss, NPCs
choose niches by observation, runs diverge across seeds.

### Replace gov ballast with real demand

Every chain item (coke, pig-iron, steel, machine-tool) currently needs a
gov bid to survive. Build real demand sinks, then drop ballast item by
item from the leaf inward, verifying the chain holds.

- [ ] **Building maintenance** (the YAML `maintenance` field is currently
  inert — wire it up). Each building consumes upkeep items per tick:
  furnaces consume coal, machine-shops consume machine-tools as wear,
  blast-furnaces wear pig-iron / steel. Maintenance items become a real
  ongoing demand source.
- [ ] **Diversified household staples**. Households buy more than corn —
  add brick (housing growth), coal (heat) per worker. Tier the consumption
  so higher-tier items create demand once available.
- [ ] **Capital depreciation**. Buildings wear out, requiring repair
  materials over their lifetime. Drives ongoing brick/steel demand
  independent of new growth.
- [ ] **Drop ballast iteratively**: machine-tool first (highest tier),
  then steel, pig-iron, coal — verifying chain survival at each step.
  Keep corn ballast (wage staple anchor) for v1.

### Cost-based price discovery (replace belief)

`priceBelief` is a [0.5, 2.0] multiplier on a globally-computed
`fair_price`. Most beliefs saturate at the cap or floor, so the
multiplier doesn't find dynamic levels — it hits walls. Replace with
per-actor cost basis:

- [ ] **Per-actor cost tracker**: each actor records rolling input + wage
  cost per output unit produced. Asks = cost × markup; bids = derived
  willingness-to-pay from downstream margin.
- [ ] **Inventory-pressure ask drift**: ask drops when inventory grows,
  rises when inventory drains. Replaces "drift on fill outcome" with
  "drift on stock level" — more direct signal than fill rates.
- [ ] **Drop the global `fair_price` and the [0.5, 2.0] belief clamp.**
  Each actor knows their own costs; the market clears via local cost
  basis without a global anchor.

### Resilience: no cascading collapse

When one actor dies, the chain collapses. Fix:

- [ ] **Multiple suppliers per item**: spawn a second coke-co, a
  steel-co separate from ore-co (so single-actor death doesn't kill
  downstream demand or upstream supply).
- [ ] **Respawn**: dead actor's niche reseeds after a delay if the
  observed clearing price holds above cost. Gov sponsors a new entrant
  when an item's price stays elevated for N ticks (proxy for "profitable
  niche unfilled").
- [ ] **Inventory buffers**: actors hold N cycles of input/output buffer
  to bridge transient supply gaps without immediate failure.

### Goal-seeking NPCs (drop `growth_building`)

`growth_building` is hand-coded per actor in `world.yml` — it steers
each NPC's behavior to a specific output. NPCs don't choose niches.

- [ ] **Margin-driven growth target**: NPC picks the recipe with the
  highest observed (clearing_price - input_cost - wage_cost) margin
  among recipes the actor has unlocked. Build the building that hosts
  that recipe.
- [ ] **Adoption without slot-fill heuristic**: when a recipe's margin
  beats the actor's current best, switch a slot or build a new slot.
  The v0 "fill empty slot with new tech" rule is a special case.
- [ ] **Drop `growth_building` from `world.yml`.** Actors discover their
  niche from observed prices.

### Path dependence / variance

Fully deterministic runs mean no exploration of alternative equilibria
— same seed always produces ore-co dominating steel.

- [ ] **Seeded RNG** in worker hire order, recipe-tie breaking, NPC
  decision ordering. Reproducible per-seed; varies across seeds.
- [ ] **Run 10 seeds @5000 ticks** as a smoke matrix. An emergent
  economy should produce different surviving-actor sets and different
  price levels per seed; if all 10 converge identically, the system
  is still scaffold-bound.

## v1+ — later (parking lot)

- Loans, equity finance, insurance.
- Strategic NPCs (cornering, undercut, tech race).
- First-mover monopoly window for newly-researched tech.
- Information era (semiconductors, computing).
- Contemporary era (batteries, EVs, biotech).
- Space/future era (orbital, fusion).
- Web UI on top of the engine.
- Finite/depleting deposits with mining claims.
- Spatial layer (sparse city graph, distance-based transport — see notes
  below).

## Spatial layer brainstorm (v1+, parking lot)

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
- Per-city order books. Per-city cost basis (post-belief refactor) —
  geographic arbitrage falls out for free.
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

## Conventions

- Update this file when scope changes — don't let it drift.
- `make validate` before committing data changes.
- Item/recipe/tech/building ids: `lowercase-with-hyphens`.
