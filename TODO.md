# TODO

## Where we are

Pre-v0 prototype. Engine + smoke harness work. **Cost-anchored pricing
landed** (replaces the old belief multiplier) and the economy is now
*active* rather than frozen: the full heavy chain (coke → pig-iron →
steel → machine-tool) clears in the real market, prices discover
cost-anchored levels (everything 0.8–1.3× fair, no more 2× belief walls),
and the corn monoculture is gone (1 farm vs 16). Money inflation dropped
from ~9.7× to ~3× over 50k. The cost-anchored *mechanism* is structural —
but the ensemble (now built, below) shows the **outcome is not robust: only
3/10 seeds stay healthy to 50k**. The single `make harness` PASS we shipped
is a lucky trajectory, not a stable economy.

**Reframe (important).** The gov ballast and pinned NPC niches are *not*
debt to be removed — they're the economy's anchors, exactly how shipping
economic games work (Victoria 3, Capitalism Lab). The 1-sector Lengnick
proof showed the micro-rules *can* emerge; the job was never "zero
scaffolding," it was "legible, responsive, non-degenerate prices on top
of a few designed anchors." That's now achieved. Emergence here means
the *middle layer* self-organizes (prices, chain response, niche
filling), not that boundary conditions are absent.

**Residual: firm churn.** The activated economy surfaces ~180–250 NPC
deaths/50k (vs 30 in the frozen baseline — but that baseline had a dead
chain). It oscillates 14–16/16 alive; the harness endpoint sometimes
catches an actor mid-respawn. Root cause is thin-margin single-producer
chains + 200-tick respawn gaps that propagate shocks — the "single-actor
loss breaks the chain" fragility. **The instrument is now built**
(`make harness ARGS="--seeds N --ticks T"`, init-cash jitter per seed —
see harness.js/state.js) and it pins the fragility precisely: at 10×50k,
**3/10 healthy**, dominant failures **chemical-co dies (4/10)** and the
**pig-iron / machine-tool chains go dormant** (`no-trade`, 3/10) — the
exact firm-decapitalization-breaks-the-chain signature the 2-sector
testbed solved. Next two steps, ordered: (1) **port the testbed recipe**
(market-clearing prices + working-capital credit) and re-run the ensemble
to move 30% → ?, then (2) **multi-supplier redundancy** so one death
doesn't zero a chain link. Both are below.

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

**Sidecar follow-on — 2-sector Lengnick** (`engine/lengnick2.js`,
`make lengnick2`, `--ensemble N` for seeded multi-seed eval). **SOLVED.**
The naive 1-sector recipe does NOT generalize — the bare model has a
dominant depression attractor (~88% unemployment, every seed). Stability
needs two mechanisms together, neither sufficient alone (the stock-flow-
consistent prescription — Caiani et al. 2016):
  1. **Market-clearing prices** (`PRICE_CLEARING`). Price moves proportional
     to the inventory gap with an open ceiling (cost floor still binds), so
     a demand spike is rationed by a price rise instead of an unfillable
     stockout. The 1.025–1.15×mc cap was forcing permanent empty shelves →
     vacancy-driven wage spiral → cash exhaustion → collapse. Alone: full
     employment for ~1500 ticks, then inflates and collapses.
  2. **Firm working-capital credit** (`CREDIT_ENABLE`, limit = N×wage bill).
     Firms borrow to cover payroll instead of shedding labor on a transient
     cash dip (the decapitalization that kills #1 alone); repaid from
     revenue. Money-honest: loans net out of the money gate.
Together: **19/20 seeds healthy at 50k**, unemployment median 6.3%, both
sectors staffed, money conserved, stable the whole run. Both toggles default
off (bare baseline = depression, preserved). Knobs: PRICE_CLEAR_GAIN,
CREDIT_MONTHS (6 = sweet spot; higher overheats).
  Open (cosmetic, not stability): nominal price *level* random-walks up (no
  monetary anchor); firms churn (~3k bankruptcies/50k) under aggregate
  stability — the same micro-churn-vs-macro-stability the main engine shows.
  How it was found: a seeded ensemble + written health gate (`--ensemble`,
  classify/GATE) turned chaotic single-trajectory tuning into reproducible
  yes/no signals (~24 experiments, each a clean refutation or confirmation).
  That instrument is the reusable asset.

**Implication for the engine port.** The proven recipe is now concrete:
market-clearing price discovery + a firm credit sector. The main engine
already has analogs of both — a credit facility (60-tick wage runway) and
gov anchors that substitute for clean price discovery (which is why it
already clears the heavy chain). So the port is de-risked. **The seeded
ensemble instrument is now built in the main engine** (`harness --seeds`),
and it gives us the before-number the port must beat: **30% healthy
(3/10)**. Port order from here: (1) ✓ instrument — done; (2) **market-
clearing prices + working-capital credit** (the proven recipe), re-run the
ensemble, and only keep the change if it moves 30% upward. Now that the
instrument exists, every pricing change is validated against the
distribution, not a single chaotic trajectory — the discipline that ends
the floundering.

Already ported (last session): cost-anchored price bounds (ask = own mc ×
markup [1.025, 1.15]) + inventory-band markup signal — the heavy chain
clears, prices anchor to cost, no saturation walls. Dividends approximated
by the households cash drain; γ-month wage damping and bounded shopping
remain unported, not currently blocking.

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

- **Degenerate corn pivot. RESOLVED.** Two-part fix: (a) re-priced corn
  anchors to a real retail margin (gov bid $50→$8, household $50→$14;
  removed gov corn market-maker ask) so the ~7× arbitrage is gone, and
  (b) added a pivot shortage gate — cross-niche raw pivots require the
  target clearing ≥1.3× fair (`PIVOT_PRICE_RATIO`), plus a growth glut
  gate. farm-corn down from 16 slots to ~1. Corn clears at ~1.1–1.3×
  fair.

- **Money inflation creep.** Fixed via households cash drain
  (HOUSEHOLDS_CASH_CAP=$100k, HOUSEHOLDS_DRAIN_RATE=0.001 per tick of
  excess, cash deleted). Households now settle at $300-400k @50k (vs
  $15M before). Side effect: heavy chain now stays alive end-to-end,
  no-trade events 30→16 over the run, NPC deaths drop to ~0 on the
  base smoke and machine-co perturbation.

- **Belief saturation. RESOLVED — this was the headline bug.** Replaced
  the priceBelief multiplier entirely with cost-anchored pricing: ask =
  own marginal cost × markup in [1.025, 1.15], markup nudged by inventory
  band; buyers bid at observed market VWAP. The machine-tool / heavy-chain
  no-trade deadlock (ask drifted above every bid) is gone — the whole
  chain clears at 0.8–1.1× fair. (engine/market.js npcOrders +
  actorUnitCost; engine/tick.js updatePricing)

- **Steel chain clears. Staffing-gate idea dropped as obviated.** Under
  cost-anchored pricing, steel-co's old over-build death was a *false
  margin signal* (belief said "build" while steel didn't actually sell);
  market-referenced margin + the glut gate now block expansion when steel
  isn't moving, so no separate staffing-aware growthTarget is needed. (A
  naive idle-slot gate would also wrongly freeze 1-recipe-2-slot buildings
  like spinning-mill/loom/wire-mill.) steel-co still churns as a thin
  single-product actor — see firm-churn frontier above.

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

- **Seeded RNG + ensemble eval. ✓ DONE** (`harness --seeds N`, commit
  f9ec5ce). Approach note: rather than inject per-tick behavioral noise
  into hire/decision/recipe ties (which would add hot-loop RNG + cost), the
  seed perturbs only **initial actor cash (±8%) once at init** — cash gates
  every stress/affordability decision in tick.js, so a small starting
  spread fans the deterministic engine into distinct trajectories at zero
  per-tick cost (tick loop stays deterministic; no-seed path byte-
  identical). Reuses `checkInvariants` as the classifier (empty = healthy).
  First measurement: **10×50k = 3/10 healthy** — chemical-co death (4/10)
  + pig-iron/machine-tool dormancy (3/10) are the dominant failures. This
  is the before-number for the pricing port. (Known limitation: at horizons
  below an actor's `start_tick`, `checkInvariants` reports it as `dead:` —
  spurious for short ensembles; 50k is past all spawns, so the result is
  clean. One-line guard worth adding.)

- **Multiple suppliers per item (churn fix).** The firm-churn frontier:
  thin-margin single-producer chain links (coke-co, steel-co, ore-co for
  pig-iron) die in correlated cascades, and respawn-into-the-same-niche
  reignites it. More producers per link + shorter/smarter respawn so one
  death doesn't zero a chain stage. Pairs with the gov-strategic-reserve
  idea (see dead-ends — shelved for now, but the right shape).

- **Staffing-aware growthTarget. DROPPED (obviated).** Cost-anchored
  margin + glut gate already block the over-build death this was meant to
  fix; an idle-slot gate would wrongly freeze 1-recipe-2-slot buildings.

## Dead-end attempts (don't repeat)

- **Gov strategic-reserve asks** (give gov ask_price on coke/pig-iron/
  steel/machine-tool + starting reserves, so it sells from stock to
  buffer an upstream producer's death). Sound *concept* — addresses the
  real "upstream death starves downstream" fragility, and gov already
  hoards the inventory it buys. But under cost-anchored pricing it removed
  an input constraint on downstream producers, unleashed a construction
  surge, and blew brick to 5.3× fair while the chaotic re-trajectory
  revived the corn pivot (19 farms). Reverted. Revisit *after* seeded RNG
  exists to tune it, and pair with a brick-supply response.

- **Bumping coke gov bid to make the floor "effective"** ($450→$480, so
  gov bid clears above the producer's cost-floor ask): regime-shifted into
  corn=19 farms, machine-tool no-trade, deaths 346. Pure trajectory chaos
  — confirms churn params are not hand-tunable without seeded RNG.

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

- Cost-anchored pricing: NPC ask = own marginal cost × per-item markup in
  [1.025, 1.15]; markup nudged each tick by inventory band; buyers bid at
  observed market VWAP (fair as fallback). Replaced the old priceBelief
  multiplier. (engine/market.js npcOrders + actorUnitCost + marketRef;
  engine/tick.js updatePricing)
- Inventory-band markup signal: `salesEMA` (smoothed units sold/tick)
  sizes lo/hi bands in ticks-of-sales; below lo → raise markup, above hi
  → cut. (engine/tick.js updatePricing, INV_LOW_TICKS/INV_HIGH_TICKS)
- Growth glut gate: don't build capacity for an output stocked above its
  hi band — supply-follows-demand overbuild brake. (engine/tick.js npcGrow)
- Pivot shortage gate: cross-niche raw pivots require the target clearing
  ≥1.3× fair (PIVOT_PRICE_RATIO) on top of the 0.4× PIVOT_PENALTY.
  (engine/market.js marginRecipe)
- Skill-seeded crews: starting + growth-hired workers seeded to skill 0.5
  in the recipe's tech (output 1.25×), same as tech-adoption hires — so
  respawned actors aren't born at 0.5× output bleeding into death.
  (engine/state.js applyStartingAssignments; engine/tick.js npcGrow)
- Synthetic actors: `households` (wage absorber, staple buyer) and
  `government` (money issuer, buyer-of-last-resort with qty caps).
  Gov cash side suppressed in `settle` — trades create/destroy money.
- Tech-walking research: TARGET (owned-building recipe) → PATH
  (transitive prereq of a target) → WALK (cheapest available).
  (engine/tick.js npcResearch)
- Margin-driven growth target: market-referenced per-recipe margin picks
  the highest-margin building each tick. (engine/market.js
  growthTarget + marginRecipe + recipeMarginPerTick)
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
