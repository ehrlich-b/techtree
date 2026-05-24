# TODO

## Where we are

Pre-v0 prototype. Engine + smoke harness work. Economy survives @50k with
14/14 actors alive at end, ~49 deaths total over the run. Tech tree gets
walked deep (electrical-engineering reached). Chain mostly stable; the
loudest remaining artifact is a degenerate corn-pivot where every
struggling actor diversifies into gov-subsidized corn farming.

The economy is held up by hand-tuned gov ballast and pre-pinned NPC
niches. It's a simulation _of_ an economy, not an emergent one yet. v1
goal is replacing the hand-tuned scaffolding (gov subsidies, fixed
`growth_building` per actor, belief saturation, hand-coded survival
parameters) with mechanisms that produce real emergence: prices find
non-cap levels, supply chains tolerate single-actor loss, NPCs choose
niches by observation, runs diverge across seeds.

## Running

```
make validate                          # check data integrity
make play                              # CLI loop
make harness                           # 5k smoke
make harness ARGS="--ticks 50000 --every 5000"
make harness ARGS="--kill coke-co@4000"  # perturbation test
TT_TRACE_VERBOSE=1 make harness        # full 30-decision death dumps
```

Death dumps print to stderr inline during a run.

## Open structural issues (visible in death traces / smoke output)

- **Single-buyer fragility on processor chains.** Pattern visible in
  death dumps: ore-co builds blast-furnace → researches bessemer
  (~500 ticks) → wages bleed dry waiting for steel capacity → dies.
  Gov ballast caps pig-iron purchases at 2/tick; no other external
  buyer exists. Same shape for glass-co, electric-co. (engine/tick.js
  npcResearch + npcGrow; engine/market.js governmentOrders)

- **Early-game over-build.** At t=1-4, default belief 1.0 passes the
  margin gate, so actors build expensive niche buildings (blast-furnace,
  glass-furnace) before any market signal exists. ore-co builds 2
  blast-furnaces at t=1 and t=4, then dies by t=657. (engine/market.js
  growthTarget; gate is `marginRecipe` + belief-floor)

- **Degenerate corn pivot.** Cross-niche raw-extraction pivots are
  working too well — every struggling actor builds a farm because gov
  bid on corn at $50 is ~4.8× fair price. Pivot is rational; the
  underlying gov-subsidy asymmetry is the real problem.

- **Money inflation creep.** Households at $12.8M @50k (vs $214k
  baseline = 60× inflation). Gov ballast injects ~$200/tick net into
  the system (buyer-of-last-resort with no sterilization). Real fix is
  buffer-stock pricing (see queued).

- **Belief saturation.** priceBelief multiplier hits [0.5, 2.0] walls
  rather than finding equilibrium. For machine-tool the ask × max_belief
  × spread exceeds the max NPC bid × max_belief × spread, so it doesn't
  clear without gov ballast. Real fix is cost-based price discovery
  (predecessor: real demand reforms below).

## Queued (next sprints, ordered by impact-to-risk)

- **Defer first growth.** Don't grow before tick N (~100) or before
  first sale. Cheap. Kills early over-builds. (engine/tick.js npcGrow)

- **Stress-aware research pause.** Skip research when stress ≥ 2.
  Saves wages for dying actors that are wasting them studying tech
  they won't get to use. (engine/tick.js npcResearch)

- **Buffer-stock gov pricing** (long-standing). Adaptive gov bid/ask
  scaled by gov inventory: bid drops as gov stockpile grows, rises as
  it depletes. Fixes inflation AND the corn-pivot degeneracy in one
  change. (engine/market.js governmentOrders + items.yml gov_ballast
  schema extension)

- **Diversified household staples.** Households buy brick, coal beyond
  corn. Already partially supported (`household:` block in items.yml).
  Tune bid_prices so households don't outbid NPCs for inputs — that
  cascaded twice in prior attempts.

- **Goal-seeking NPCs (full).** Drop `growth_building` from world.yml
  entirely. Cross-niche pivot already exists for raw extraction; extend
  to processing (with input-availability check) and have actors
  discover their niche end-to-end from observed prices.

- **Multiple suppliers per item.** Spawn a second coke-co, separate
  steel-co from ore-co. Single-actor death stops killing downstream
  demand or upstream supply.

- **Seeded RNG.** Worker hire order, NPC decision ties, recipe pick
  ties — all currently deterministic. Run 10 seeds @5000 ticks as a
  matrix; an emergent economy diverges across seeds.

## Mechanisms currently in place (for context recovery)

- Per-actor `priceBelief` per item, drifting on fill outcomes, clamped
  [0.5, 2.0]. (engine/tick.js applyPriceDrift)
- Synthetic actors: `households` (wage absorber, staple buyer) and
  `government` (money issuer, buyer-of-last-resort with qty caps).
  Gov cash side suppressed in `settle` — trades create/destroy money.
- Tech-walking research: TARGET (owned-building recipe) → PATH
  (transitive prereq of a target) → WALK (cheapest available).
  (engine/tick.js npcResearch)
- Margin-driven growth target: belief-weighted per-recipe margin picks
  the highest-margin building each tick. (engine/market.js
  growthTarget + marginRecipe + recipeMarginPerTick)
- Cross-niche pivots: raw-extraction recipes in unowned building types
  considered with 0.4× PIVOT_PENALTY. (engine/market.js marginRecipe)
- DR on raw extraction: per-building yield × `1/sqrt(N)` for raw
  recipes; total scales sublinearly. (engine/tick.js runProduction +
  engine/market.js recipeMarginPerTick)
- Stress states 0–4, recomputed each tick from cash-vs-wage-runway:
  growth freeze at 1, hiring freeze at 2, layoff one idle/tick at 3,
  fire-sale + idle production at 4. (engine/tick.js computeStress)
- Credit facility: 60 ticks of wage runway as negative-cash credit
  before bankruptcy clock. (engine/tick.js computeStress + CREDIT_RUNWAY_TICKS)
- Bankruptcy + eviction + liquidation: 500-tick clock; fire-sale at
  250; residual cash + 50% asset recovery routes to households.
  (engine/tick.js liquidate + evictionFireSale)
- Respawn: dead non-player actors reseed from data.actors after 200
  ticks; funded from households. (engine/tick.js respawnDead)
- Staggered spawn: actors with `start_tick > 0` enter the world at
  their tick. (engine/tick.js spawnPendingActors)
- Demolition: chronic-negative recipes demolished when actor has >1 of
  the building type (redundancy gate). 30% material recovery.
  (engine/tick.js evaluateSlotsAndDemolish)
- Decision + trade instrumentation: per-actor 100-entry ring buffers.
  Death dump on liquidation. (engine/state.js recordDecision /
  logActorTrade; engine/tick.js dumpDeath)
- Schema in items.yml: per-item `household: {rate, bid_price,
  elasticity?}` and `gov_ballast: {bid_price, ask_price?, qty_cap}`
  blocks. Engine derives the lists at runtime.
- Schema in buildings.yml: `tech_maintenance: {tech: {item: rate}}`
  for adoption-gated maintenance demand.

## Parking lot (v1+)

- Cost-based price discovery (replace belief saturation).
- Inventory buffers (smooth transient supply gaps).
- Loans, equity finance, insurance.
- Strategic NPCs (cornering, undercut, tech race).
- Information / contemporary / future eras.
- Finite/depleting deposits with mining claims.
- Web UI on top of the engine.
- **Spatial layer**: sparse city graph (`world.yml` adjacency), lots
  as building hosts (footprint vs capacity), per-city markets, vehicle
  tiers tech-gated, distance-based transport stack (seller toll +
  inter-city transport + buyer toll). Geographic arbitrage falls out
  for free under cost-based pricing. Schema-breaking; clean v1 break.

## Conventions

- Update this file when scope changes; don't let it drift.
- `make validate` before committing data changes.
- Item/recipe/tech/building ids: `lowercase-with-hyphens`.
- Detailed history of completed work lives in git commit messages, not
  here.
