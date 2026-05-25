# TODO

## Where we are

Pre-v0 prototype. Engine + smoke harness work. Main-engine economy
survives @50k with 14/14 actors alive at end, ~0-16 deaths total over
the run. Tech tree walked deep (electrical-engineering reached, assemble-
motor active for the first time). Chain mostly stable; the loudest
remaining artifact is a degenerate corn-pivot where every struggling
actor diversifies into gov-subsidized corn farming.

The main-engine economy is held up by hand-tuned gov ballast and pre-
pinned NPC niches. It's a simulation _of_ an economy, not an emergent
one yet. v1 goal is replacing the hand-tuned scaffolding with mechanisms
that produce real emergence: prices find non-cap levels, supply chains
tolerate single-actor loss, NPCs choose niches by observation, runs
diverge across seeds.

**Sidecar diagnostic — Lengnick (2013) baseline replica.** Built as a
self-contained sanity probe (`engine/lengnick.js`, `make lengnick`) to
confirm the ABM literature's stability mechanisms work in this codebase.
Reaches stable equilibrium at @50k across 5 seeds: unemployment 3.5-7.4%,
price $5.3-5.7, wage $14.3-15.5, inventory in-band, zero bankruptcies,
money supply exactly conserved. Confirms the bug isn't structural — it's
in the main engine's decision rules. The pieces that did the work and
are missing from the main engine:
  1. Cost-anchored price bounds: `1.025 × mc ≤ price ≤ 1.15 × mc`.
     Without an upper bound, our belief multiplier hits its wall and
     prices ratchet without anchoring back to cost.
  2. Inventory band drives hiring/firing (lo=0.25× demand, hi=1.0×).
     Our margin-driven growth ignores inventory; this is the supply-
     follows-demand mechanism we never built right.
  3. Dividends recycle excess firm cash to households (reserve = 6×
     monthly wage bill). Our hh-cash-drain hack is the same idea but
     shaped wrong (cliff vs flow).
  4. Wage-down requires γ=24 months of consecutive full employment.
     This is the only damping that prevents a wage-price spiral when
     vacancies are persistent.
  5. Bounded shopping search (vendor list = 7, swap rate 25% on
     stockout/cheaper-found). We don't have a "household shopping"
     primitive at all — gov + households just bid at fixed prices.

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

- **electric-co survival gap.** Mostly fixed. electric-co is now
  vertically integrated (wire-mill + assembly-line + electrical-
  engineering preresearched) and motors have household demand. They
  thrive from t=8000 to ~t=20000, then die when steel inventory
  exhausts (smelt-steel still idle because nobody can profitably
  produce steel — see "steel chain idle" below). Dropped from 14
  deaths to 5-7 per 50k run.

- **Early-game over-build.** Mostly addressed by defer-first-growth +
  demand-aware margin: actors no longer over-build at t=1-4. Still
  fires at exactly t=100 when defer-gate lifts if first-sale signal
  is from a transient gov subsidy; gate is OR not AND so a $50 corn
  sale to gov satisfies the "first sale" condition. (engine/tick.js
  GROWTH_DEFER_TICKS)

- **Degenerate corn pivot.** Cross-niche raw-extraction pivots are
  working too well — every struggling actor builds a farm because gov
  bid on corn at $50 is ~4.8× fair price. Pivot is rational; the
  underlying gov-subsidy asymmetry is the real problem.

- **Money inflation creep.** Fixed via households cash drain
  (HOUSEHOLDS_CASH_CAP=$100k, HOUSEHOLDS_DRAIN_RATE=0.001 per tick of
  excess, cash deleted). Households now settle at $300-400k @50k (vs
  $15M before). Side effect: heavy chain now stays alive end-to-end,
  no-trade events 30→16 over the run, NPC deaths drop to ~0 on the
  base smoke and machine-co perturbation.

- **Belief saturation.** priceBelief multiplier hits [0.5, 2.0] walls
  rather than finding equilibrium. For machine-tool the ask × max_belief
  × spread exceeds the max NPC bid × max_belief × spread, so it doesn't
  clear without gov ballast. Real fix is cost-based price discovery
  (predecessor: real demand reforms below).

- **Steel chain partially fixed via separate steel-co.** Spawning a
  dedicated steel-co (start_tick=3000, bessemer-process pretrained,
  blast-furnace + 3 workers + minimal inventory) makes smelt-steel
  run mid-run and clears steel to electric-co at $3600-4100/unit. They
  still overgrow (margin-driven growth picks blast-furnace; they can't
  staff slot 2 with only 3 workers, so the second building is pure
  cost). Currently dies 1-2× per 50k run then respawns. Real fix would
  be a staffing-aware growthTarget that skips growing buildings whose
  current slots can't be staffed. Cumulative effect on smoke: 40→35
  no-trade events, 2→1 dead checkpoints over the run.

## Queued (next sprints, ordered by impact-to-risk)

- **Diversified household staples.** Households buy brick, coal beyond
  corn. Already partially supported (`household:` block in items.yml).
  Tune bid_prices so households don't outbid NPCs for inputs — that
  cascaded twice in prior attempts.

- **Goal-seeking NPCs (full).** Drop `growth_building` from world.yml
  entirely. Cross-niche pivot already exists for raw extraction; extend
  to processing (with input-availability check) and have actors
  discover their niche end-to-end from observed prices.

- **Multiple suppliers per item.** Done for coke (coke-co-2,
  start_tick=2000) and steel (separated from ore-co). Coke-co kill
  test confirms the chain stays alive when one dies. Could extend to
  brick/iron-ore if those become bottlenecks. Single-actor death
  should stop killing downstream demand or upstream supply.

- **Staffing-aware growthTarget.** Skip building types whose current
  slots aren't fully staffed. Right now steel-co (3 workers, 1 blast-
  furnace, 1 slot) keeps picking blast-furnace as growth target — it
  builds a second one but can't staff it, dies 2k ticks later from the
  brick spend. Same pattern would hit any actor with a high-margin
  building they're fully utilizing.

- **Seeded RNG.** Worker hire order, NPC decision ties, recipe pick
  ties — all currently deterministic. Run 10 seeds @5000 ticks as a
  matrix; an emergent economy diverges across seeds.

## Dead-end attempts (don't repeat)

- **Stress-aware research pause** (skip research when stress ≥ 2):
  zero measurable impact on survival. Research is free (1 point/tick,
  no worker/cash cost), so pausing it doesn't save anything. Would
  matter only if research were tied to a worker slot — separate
  refactor.

- **Grow cooldown** (per-actor 60-tick gate between successive grows):
  same death count as baseline (40) but slightly worse chain health.
  The cooldown doesn't address the root issue — that the margin signal
  is wrong, not that growth is mistimed.

- **Total-payroll wage runway in npcGrow** (require cash > [existing +
  new] payroll × N ticks): 40 → 55 deaths. Healthy actors run on
  revenue, not cash; conservative gate starves expansion.

- **Buffer-stock gov pricing on pig-iron/steel/machine-tool**: prices
  crash to 0.25× base as gov saturates, killing the actors whose
  growth was attracted by the high signal. Buffer-stock only works
  for items with real non-gov demand (e.g., corn has households) AND
  needs marginRecipe to see gov's current bid, not just fair price.

- **Buffer-stock on corn alone** (target_qty 4k or 20k): 2× death rate
  because actors still pivot to corn based on anchor price; gov bid
  drops as inventory grows; pivoted actors die when corn price
  collapses. Same root issue — actors aren't reading gov's current bid.

- **ore-co bessemer pretrain** (give ore-co bessemer-process at start
  so it self-consumes pig-iron into steel): 30 deaths (better) but 4
  final no-trade items vs 2 baseline. ore-co survives but the
  pig-iron + coke markets dry up.

- **Lower gov pig-iron bid** ($500 vs $1300, closer to cost): 61
  deaths. ore-co revenue plunges; chain starves of money.

- **Tighten defer gate to AND** (require both 100 ticks AND first
  sale, instead of OR): 23 deaths but more final no-trade items.
  The OR gate is closer to optimal for current setup.

- **ore-co bessemer pretrain + 9 workers + extra coke** (retry to see
  if new motor demand changed the dynamic): 30 deaths (vs 16). ore-co
  dies 16 times — extra workers + bessemer means they run both slots
  but flood the pig-iron + steel markets, prices collapse, they
  bleed payroll. Confirmed bessemer pretrain is a dead-end even with
  the new motor demand pulling steel.

- **Tighter PIVOT_PENALTY (0.4 → 0.25)** to keep actors in their core
  niche: 30 deaths (vs 16). Pivots are actually saving rival-co and
  textile-co when their core niche saturates. Restricting them just
  trades one death pattern for another.

- **Higher electric-co starting cash ($60k → $80k)**: 17 deaths
  (vs 16). The extra cash funds more bad bets (more cross-niche
  buildings during pivot), so it doesn't actually buy survival time.
  $60k is the sweet spot.

- **Brick input on farm-corn** (to disqualify farms from cross-niche
  pivot via the !isRaw rule): 134 deaths — catastrophic. Adding any
  input to a major staple recipe cascades hard because corn is
  household rate 0.1 (the highest staple drain). Even 1 brick/cycle
  starves farm-co when bricks are scarce, gov corn supply collapses,
  households starve, system unwinds. Anti-pivot solutions need to
  live at the growthTarget level, not in the recipe data.

- **Cross-niche pivot cap (1 or 2 per actor)**: cap=1 = 29 no-trade /
  3 dead (vs 30/1); cap=2 = 32/2. Pivots are a real survival mechanism
  — restricting them just kills the actors who were using corn as cash
  ballast. The corn pile-on (14 farms) is rational given the gov+
  household corn bid. Real fix needs to make corn less attractive
  without breaking the staple market — open problem.

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
- Demand-aware margin: when state.marketHistory has >=10 samples for
  an output item, revenue is scaled by min(1, marketRate/outputRate)
  — actors don't over-estimate margin on items where real volume is
  hard-capped (gov-only buyers, slow-clearing chains).
  (engine/market.js outputSaturation + recipeMarginPerTick)
- Downstream-demand tech targets: a tech is a TARGET for npcResearch
  if it gates a recipe whose inputs include any item the actor
  produces. Lets producers research toward creating demand for their
  own output (e.g., wire → electrical-engineering for motors).
  (engine/tick.js npcResearch)
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
