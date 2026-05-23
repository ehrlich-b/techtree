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

### Diminishing returns on raw extraction (2026-05-23) — DONE

Per-actor raw-extraction yield is now `1/sqrt(N)` where N is the count
of same-type buildings owned. Total output scales as `sqrt(N)` —
sublinear, so each additional raw building is less profitable than the
last. Caps natural supply growth without hard belief gates.

Applies only to recipes with NO inputs (true raw extraction:
mine-iron-ore, dig-clay, harvest-cotton, mine-sulfur, mine-copper,
etc.). Processing recipes unaffected — they're already bound by input
availability.

Code change: `runProduction` caches `countByType` at top and multiplies
slot progress by `1/sqrt(count)` for raw recipes.

Harness @50k: **first PASS @50k this session**.
- farm-co reduced from 5 farms to 3 (DR equilibrium). Corn still
  flowing — total output `sqrt(3)×base ≈ 7.2/tick` matches demand.
- sulfur-co stabilizes at ~2-4 mines (was cycling deaths).
- cotton-co still volatile at 5 fields (DR didn't prevent overgrowth
  from initial high-clearing window; future fix is tighter growth-
  floor-belief gate or marginal-yield-aware growth decision).
- 14/14 NPCs alive at end.
- Tech walk wider than ever: 12 at ironworking, 6 at industrial-
  chemistry, 2 at steam-engineering, farm-co at electrical-engineering.

### Tech-gated maintenance (2026-05-23) — DONE

First endogenous-demand mechanism. Buildings get a new optional schema
field `tech_maintenance: { tech-id: { item: rate } }`. The actor consumes
and bids for these items only if researched. `npcResearch` also targets
techs that gate tech_maintenance for owned buildings — researching the
tech is incentivized by the modernization demand pattern it unlocks.

Schema:
```yaml
machine-shop:
  maintenance:
    brick: 0.008
    ...
  tech_maintenance:
    industrial-chemistry: { sulfuric-acid: 0.001 }
    electrical-engineering: { electric-motor: 0.0001 }
```

Code:
- `market.js inputDemand`: filters tech_maintenance entries by `actor.researched`
- `tick.js consumeMaintenance`: same filter on inventory draw
- `tick.js npcResearch`: TARGET set now includes techs that gate any
  tech_maintenance entry for an owned building
- `schema.js validate`: cross-checks tech_maintenance items and tech refs

Migration (existing buildings):
- `sulfuric-acid` (was on blast-furnace, machine-shop, glass-furnace as
  baseline maintenance) → moved to `tech_maintenance.industrial-chemistry`
- `electric-motor` (new tech-gated entry) → added to machine-shop and
  assembly-line as `tech_maintenance.electrical-engineering`
- `engine` stays in baseline maintenance — foundational, not gating
  by adoption.

Harness results:
- @20k: industrial-chemistry researched by 7 actors (vs 4 pre-change via
  WALK fallback). ore-co + glass-co in-progress, specifically targeting
  it for blast-furnace/glass-furnace modernization.
- @50k: electrical-engineering reached by farm-co; textile-co in-progress.
  machine-co walks gear-cutting on its way to electrical-engineering
  via machine-shop modernization target.
- Chain stability comparable to pre-change (12 deaths vs ~11). The
  pattern doesn't fix raw-extractor death cycle (cotton-co/sulfur-co/
  copper-co) — that's an orthogonal issue (income-elastic household
  demand or diminishing-returns extraction).

Why this matters: future new items can plug into existing buildings as
`tech_maintenance` entries. Demand emerges automatically as tech
adoption ramps. No more "manually add to STAPLES + manually add to N
building maintenance entries" routine.

### Electrical sub-branch (2026-05-23) — DONE

Tier-5 extension above steam-engineering. Gives actors who reach
steam-engineering a new target (electrical-engineering, 8000 cost) so
walking continues past the prior apex.

- **3 items, 2 tech, 2 buildings, 3 recipes**: copper (t1 raw), wire
  (t2), electric-motor (t5); copper-smelting (prereq ironworking, 1500),
  electrical-engineering (prereq copper-smelting + steam-engineering,
  8000); copper-mine, wire-mill; mine-copper, draw-wire, assemble-motor.
- **2 new actors**: copper-co (raw extraction), electric-co (start_tick:
  8000, wire-mill + copper-smelting, supplies wire for downstream).
- **Copper dual-use**: industrial input + household staple ($50, rate
  0.003) — same dual-use pattern as cotton/sulfur to keep copper-co
  viable.
- **Assemble-motor on assembly-line**: tier-5 endpoint, same building
  as assemble-engine but higher tech tier. recipeForBuilding prefers
  higher-tech, so engineering-co will switch from engines to motors
  once electrical-engineering completes.

Harness @20k:
- 17 actors, 14/14 NPCs alive at final tick.
- electric-co integrates (wire-mill running draw-wire). engineering-co
  walks electrical-engineering (path-aware research targets it via
  assembly-line ownership).
- copper trading at 0.89× fair. wire fair $484 (no external trades —
  electric-co consumes some internally; market trades develop once
  motor production starts).
- electric-motor: idle until engineering-co finishes electrical-
  engineering (~tick 12000-16000 depending on starting cash burn).

### Chemistry branch (2026-05-23) — DONE

Third parallel tech branch: sulfur → sulfuric-acid. Walks
industrial-chemistry independently of metals + textiles trees.

- **2 items, 1 tech, 2 buildings, 2 recipes**: sulfur (t1 raw),
  sulfuric-acid (t2); industrial-chemistry (800, no prereq);
  sulfur-mine, acid-plant; mine-sulfur, distill-acid.
- **2 new actors**: sulfur-co (raw extraction, 1 mine, 1 worker),
  chemical-co (acid-plant + industrial-chemistry, 2 workers).
- **Acid maintenance**: blast-furnace, machine-shop, glass-furnace
  (only the heavy industrial users — initial broad distribution
  including kiln/bottling-plant/assembly-line destabilized the
  chain).
- **Sulfur dual-use**: industrial input (distill-acid) + household
  staple ($70, rate 0.003). Without staple, sulfur-co dies in the
  same single-consumer-dependency pattern that nearly killed
  cotton-co. With it, sulfur-co stabilizes at 2-3 mines.

Harness results:
- @5k: PASS. 12/12 actors alive. Sulfur and acid both trading.
- @20k: PASS. industrial-chemistry researched by 7 actors, walked
  in-progress by another 3. 6 deaths total (cluster damage,
  respawn heals).
- @50k: 7 deaths over run (slightly better than 9 baseline pre-
  chemistry), but final-window cascade — rival-co + ore-co + coke-co
  + cotton-co die in last 5000 ticks. Chain still recovers via
  respawn but ends mid-cycle.

Persistent issues (pre-existing, not fixed here):
- **machine-tool no-trade** — same belief saturation issue.
- **Long-run cascades** — chains decoupling at @50k due to money
  inflation (farm-co at $6M, households at $1.7M, total cash 7×
  baseline). Buffer-stock gov pricing (TODO task #11) would help.

### Textile branch (2026-05-23) — DONE

Parallel tech branch added to widen the walking surface. Before, only one
linear branch (metals) was actively walked by NPCs; glass branch existed
but actors started with the tech pre-researched. Textile is a real walker:

- **3 items, 2 tech, 3 buildings, 3 recipes** added: cotton (t1 raw),
  thread (t2), cloth (t3); textile-spinning (600) → mechanical-loom
  (1500); cotton-field, spinning-mill, loom; harvest-cotton, spin-thread,
  weave-cloth.
- **2 new actors**: cotton-co (raw cotton), textile-co (starts with
  spinning-mill + loom + textile-spinning but NO mechanical-loom — they
  must research it before their loom comes online).
- **Cotton dual-use**: household staple ($40, rate 0.003) + textile
  input. Without the staple, cotton-co dies (textile-co's single
  spinning-mill can't absorb cotton-co's supply). With the staple
  calibrated tighter, cotton-co stabilizes at 1-2 fields.
- **Cloth staple**: $1500, rate 0.001 — gives weave-cloth output a
  demand sink at full chain depth.
- **Cross-branch dep**: loom maintenance includes gear (cross-pulls
  machine-co's output).

Harness results:
- @5k: textile-co researched mechanical-loom by ~tick 1500, cloth
  clearing at 0.93× fair. Whole textile chain active.
- @20k: 7 NPCs at bessemer-process, 4 at gear-cutting, 4 at mechanical-
  loom. farm-co (no targets, WALK fallback) accidentally researches the
  entire tree — wasted cash but visually shows full traversal.
- @50k: 10/10 actors alive at final tick, all 18 recipes running.

Persistent issue (pre-existing, made visible by harness):
- **machine-tool no-trade** — belief × spread asymmetry at belief
  saturation. Ask at fair × 1.05 × belief_max (=$59k) > max NPC bid
  at fair × 0.95 × belief_max (=$53k). No clear. Real fix is cost-based
  price discovery (TODO section below). Doesn't collapse the chain
  because gov ballast at $30k creates some demand.

### Resilience pass (2026-05-23) — DONE

Goal was a self-simulating bot economy that survives indefinitely and
recovers from perturbation. Reached via two paired changes:

- **Stress harness** (`engine/harness.js`, `make harness`): runs headless,
  snapshots every N ticks, extracts events from state diffs, checks five
  invariants (actor-alive, bounded-growth, chain-trading, money-bounded,
  price-band). `--kill A@T` perturbs by deleting an actor at tick T.
  Replaces "5/5 alive @5000" with measurable pass/fail across windows.
- **Respawn** (`tick.js`, `RESPAWN_DELAY=200`): dead non-player actors
  reseed from their `data.actors` spec after a delay, funded from
  households when possible. Breaks cluster cascade: machine-co dies
  → coke-co + ore-co briefly destabilize → all respawn → chain resumes.
- **Belief-floor growth gate** (`market.js`, `GROWTH_FLOOR_BELIEF=0.55`):
  fallback `growthTarget` returns null when the actor's belief for the
  growth recipe's output has pinned at floor. This is the same TODO
  attempt 2 that was previously blocked by kiln cascade — respawn
  absorbs the cascade, so the gate now works. Bounds farm-co at
  ~4 farms (down from 2358 @10k).

Harness results after pass:
- @5k, @10k, @20k: PASS (all five invariants).
- @50k: near-pass, single trailing `no-trade:pig-iron` from sample window.
- @100k: degrades on money-supply (163× baseline) — gov corn ballast is
  pure money creation (~$177/tick net), accumulates linearly. Not a
  collapse, an inflation creep.
- Forced `--kill coke-co@4000` / `--kill machine-co@4000` /
  `--kill farm-co@4000`: world heals within ~5k ticks; all actors alive
  by @15k.

Persistent issues, lower priority:
- **Brick chronically floors** at 0.29× fair — rival-co's kiln capacity
  exceeds bound farm-co's brick demand. Respawn handles it (rival-co
  oscillates death-respawn) but it's noisy.
- **Money supply inflation** — gov corn purchase is unbacked. Long-run
  fix is dynamic gov anchor (drift on observed clearing) or reduced
  gov bid quantity. Deferred — does not collapse the world.

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

- [x] **Building maintenance** wired up: blast-furnace + machine-shop
  consume machine-tools as wear (silent shortfall, NPC bids target a
  200-tick maintenance buffer). Schema `maintenance: {item: rate}`.
- [ ] **Diversified household staples**. Households buy more than corn —
  add brick (housing growth), coal (heat) per worker. Tier the consumption
  so higher-tier items create demand once available.
  - **Parameter constraint (2026-05-10):** household brick bidPrice must
    sit below NPC max bid (fair × 0.95 × 2.0 = $167 for brick) or
    households outbid NPCs and coke-co/ore-co can't get brick to expand,
    dying mid-game. Tried bidPrice $200 (cascade), $120 (still cascade
    from low coke price). The right level + rate combination has to
    keep brick clearing high enough for kiln margin AND let NPCs win
    brick at high belief.
- [x] **Capital depreciation** wired up: every building has
  `maintenance` rates proportional to construction cost (brick on all
  building types; steel on machine-shop; machine-tool on blast-furnace
  + machine-shop as before). 2026-05-10: smoke @5000 — modest impact
  on the chain (ore-co lived longer, machine-co more stressed by added
  maintenance costs).
- [ ] **Drop ballast iteratively**: machine-tool first (highest tier),
  then steel, pig-iron, coal — verifying chain survival at each step.
  Keep corn ballast (wage staple anchor) for v1.
  - **Attempt 1 (machine-tool drop, 2026-05-10):** cascade — machine-co
    + ore-co + coke-co all die by tick 2500. Root cause: machine-co's
    steel input belief saturates at 2.0× fair, making machine-tool COGS
    (~$37.9k) > fair_price ($28.1k). Gov ballast at $30k was masking the
    structural unprofitability. Drop blocked on belief-saturation reform
    (cost-based price discovery, next section). Maintenance demand rate
    is also supply-bottlenecked (machine-co produces 0.007/tick, demand
    only 0.003/tick), so even fixing belief won't be enough without more
    consumers — capital depreciation could fill the gap.

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
  - **Attempt 1 (2026-05-10):** prototyped Phase A (costBasis+lastPaid+
    lastSold tracking, additive — no-op smoke @5000), then Phase B
    (cost-based asks w/ inventory pressure) + Phase C (WTP-based bids,
    growth bids via lastPaid). Result @5000: rival-co + coke-co + ore-co
    DEAD by tick 500-3000 (3/5 NPCs dead). Worse than baseline.
    Root cause: removing belief saturation drops effective markup from
    ~2× (belief × spread = 1.05 × 2.0) to ~1.2 (markup only). At 1.2×
    markup, brick clears at ~$92 (vs baseline $185); rival-co's
    structural wage burden (6 workers × $5/tick = $30/tick) exceeds
    brick margin (~$5/tick at 3 kilns × 0.083 brick/tick × $20 margin).
    Belief saturation was a 2× price ratchet that hid structural
    unprofitability. Raising MARKUP to 1.5 doesn't fix it (fairPrice
    function uses MARKUP, so fair scales up proportionally —
    machine-tool fair goes $28k → $54k, gov ballast still $30k, no
    clear). Belief drop blocked on real-demand reforms (this section's
    predecessor: capital depreciation, household staples) — without
    persistent bid pressure pushing clearing above cost+small-margin,
    cost-based asks can't generate enough margin to pay wages. Reverted
    cleanly; tree matches baseline.

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
- [x] **Credit facility** wired up: each actor can run negative cash up
  to `CREDIT_RUNWAY_TICKS × current_wage_burden` ($150/tick for 30
  workers × 60 ticks = $9k) before the bankruptcy clock starts.
  Addresses the "first time their account goes to -$0.01 = death"
  brittleness. Helps transient shortfalls (ore-co lives 500 ticks
  longer); chronic-loss actors (coke-co with no buyer) still die,
  since infinite credit can't save zero-revenue.

### Bound farm-co exponential growth

By @10k farm-co grows to 2400+ buildings as the gov corn bid scales
with totalWorkers (which includes farm-co's own hires) — positive
feedback loop. Chain eventually collapses around it.

- [ ] **Output-saturation growth gate** (attempted, blocked):
  growthTarget returns null when actor stockpile of growth target's
  output exceeds N ticks of production rate. **Attempt 1 (2026-05-10):**
  any reasonable threshold (30-50 ticks) caps farm-co correctly but
  cascades the chain — kiln operators depend on farm-co's brick
  demand for new farm construction. With farm-co gated, brick belief
  drops to floor, brick clears at $26, kilns insolvent. Tried adding
  gov brick ballast ($185 × qtyCap 5) as replacement demand: player +
  rival survive but coke-co + ore-co still die (coke-co builds coal-
  mines aggressively early, drains cash, hits stress before coke
  demand from ore-co can ramp; ore-co cascades). The gate works
  mechanically but the chain is too brittle to perturbations of
  farm-co's brick demand. Solution likely requires real demand
  diversification (household brick + coal) tuned carefully + perhaps
  slower NPC growth pace (longer wage-runway threshold) so chronic
  bleeders don't dig themselves into a hole early.
  - **Attempt 2 (belief-floor gate, 2026-05-10):** gate only fires
    when actor's priceBelief for the fallback recipe's output has
    pinned at floor (≤ 0.55) — uses existing belief-drift signal as
    "oversupply" proxy. Bounds farm-co cleanly at b:4 (belief floors
    early when farm-co outproduces real corn demand). But same chain
    cascade: player+rival keep growing kilns assuming brick demand,
    overshoot real demand by @500, brick belief floors, both die by
    @1000. Gate is correct mechanism, but ALL fallback-growth actors
    need it active simultaneously, and chain currently depends on
    farm-co's pre-bound brick demand to keep kilns solvent.
- [ ] **Decouple gov corn bid from farm-co's own workforce**
  (attempted, blocked): gov bid cap = `(totalWorkers - farm-co_workers)
  × rate × buffer` breaks the positive feedback without removing gov
  ballast outright.
  - **Attempt 1 (2026-05-10):** implemented as: subtract workers of
    actors whose growthBuilding hosts a recipe outputting the staple.
    Drops gov corn purchases ~200/tick → ~15/tick (10× contraction in
    money creation). Chain cascades by @3000 — coke-co dies first
    (revenue drops as ore-co weakens, ore-co weakens because pig-iron
    market thinned), then ore-co, then brick crashes ($185→$26),
    then player+rival+farm-co die. The gov corn subsidy was a major
    money-creation channel (~$5400/tick); removing it deflated the
    chain's cash flow even though no actor was specifically targeted.
  - **Attempt 2 (qtyCap=200 on gov corn, 2026-05-10):** preserves
    money creation rate at baseline peak (~$5400/tick) but caps it
    flat. @5000 indistinguishable from baseline (farm-co at 211
    buildings, all NPCs alive). @10000 farm-co blows up to 1000
    buildings, -$1.3M cash — household corn demand scales with
    totalWorkers (real economics), so farm-co's hires still feed
    its own demand via the wage→household→corn loop. qtyCap on gov
    isn't enough; the household feedback also needs bounding (or
    farm-co's growth needs gating separately).

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
