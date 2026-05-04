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

### Next: tuning

- [ ] Industry has no idle-state demand. With brick removed from
  `STAPLES` and gov no longer subsidizing it, the player and rival-co
  both go bankrupt within ~2500 ticks of an idle smoke run — nobody
  bids for bricks. Intended: in real play, build demand (player
  `set-bid brick`, or future NPC growth) keeps producers alive. Until
  NPC growth is implemented, the idle test will always show industry
  collapse. Decide whether to (a) accept this as expected behavior,
  (b) add a dumb construction-sector synthetic actor that buys bricks
  at fair price for a steady but small rate, or (c) prioritize NPC
  growth so brick demand emerges from rival farm/industry expansion.
- [ ] Wage drift. Workers on tech-gated recipes gain skill, so wages
  rise above `BASE_WAGE` over time, but staple bid prices are pinned
  to `BASE_WAGE`. Now that brick is unsubsidized, this bites harder:
  even when an NPC sells bricks at the fair-price ask, wage drift
  outpaces revenue within ~1000 ticks. Pick a strategy: derive bids
  from a rolling average wage, cap wage at `BASE_WAGE`, or accept as
  a research-pacing knob.
- [ ] Money supply leak at liquidation. Recovered cash (`fair × 0.5`
  on inventory + construction) is added to the dead actor's cash, then
  the actor is dropped — that cash leaves the system entirely. Real
  now that brick producers reliably die idle: every smoke run leaks
  ~$5–10k of player + rival recovery on liquidation.
- [ ] Farm over-production. Farm produces 1.67 corn/tick (200 / 60 ×
  raw-extraction multiplier 0.5) but households only consume 0.4–0.8
  corn/tick at 4–8 workers. Gov absorbs the surplus indefinitely
  (cash-free since it's the issuer), but corn inventory in gov grows
  without bound. Either reduce `farm-corn` recipe output to match
  demand, or rate-limit gov bids to actual consumption.
- [ ] NPC growth. Player can `hire` and `build` to grow GDP, but NPCs
  have static `starting_workers` / `starting_buildings` and never
  expand even when accumulating cash (farm-co at +$70/tick fills its
  coffers and does nothing). Add a simple expansion strategy: when
  cash > hire-cost-buffer and a slot is unfilled, hire; when cash >
  build-cost and demand for an output is unmet, build. Doubles as the
  fix for the industry-demand problem above.

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
