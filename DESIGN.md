# Design

## Premise

You run one company in a tick-based market. Other companies (NPCs) run beside
you. Workers gain skill at recipes they repeatedly run. Every item exists to
be sold or to feed another recipe — there are no decorative goods. You
research tech to unlock new recipes. Money is the clearing mechanism; the real
game is the production graph.

Scope: industrial era through space. Roughly 1850 to 2080.

## Entities

### Item

A tradeable good. Either **raw** (extracted via a no-input recipe) or
**produced** (output of some recipe). Properties:

- `id` — `lowercase-with-hyphens`, doubles as YAML map key.
- `name` — display.
- `era` — `industrial | information | contemporary | future`.
- `tier` — integer 1–5, rough complexity. Drives baseline `fair_price`.
- `unit` — `kg`, `count`, `kwh`, `m3`, etc.
- `household` — optional, marks the item as a consumer staple:
  `{ rate, bid_price, elasticity? }`. Households drain `total_workers ×
  rate` per tick and bid at `bid_price`.
- `gov_ballast` — optional, marks the item as a government-ballasted
  good: `{ bid_price, ask_price?, qty_cap }`. Gov bids the configured
  price for up to `qty_cap` units per tick; if `ask_price` is set,
  also asks at that price (market-maker on staples).

### Recipe

Converts inputs to outputs over time inside a building.

- `tech` — tech_id that gates this recipe. Required for non-extraction recipes.
- `building` — building_id that hosts it.
- `inputs` — `{item_id: amount}` consumed per cycle.
- `outputs` — `{item_id: amount}` produced per cycle.
- `seconds` — cycle time at average skill 1.0.
- `workers` — count required. Cycle cannot start with fewer assigned.

Inputs debited at cycle start (progress=0). Each tick adds
`output_multiplier × dr_factor / seconds` to progress. When progress ≥ 1.0,
outputs credited and progress reset. For raw extraction (no inputs),
`dr_factor = 1/sqrt(N)` where N is the actor's count of same-type
buildings — total extraction yield scales as `sqrt(N)` rather than `N`.

### Tech

A research node.

- `prereqs` — list of tech_ids.
- `research_cost` — knowledge points. Researcher accumulates one point
  per tick while `researchInProgress` targets the tech.
- `era` — for grouping/UI.

Tech is per-actor: each actor has its own `researched` set. Researching a tech
unlocks all recipes that name it.

### Building

Hosts recipe slots.

- `slots` — concurrent recipe instances.
- `construction` — `{item_id: amount}` to build.
- `maintenance` — `{item_id: rate_per_tick}` consumed by the building each
  tick. Silent shortfall: missing items don't stop production; demand
  pressure shows up via the actor's bids targeting a rolling
  maintenance buffer.
- `tech_maintenance` — `{tech_id: {item_id: rate}}`. Same shape as
  maintenance but only consumed when the actor has researched the
  tech. Models tech adoption: researching `industrial-chemistry`
  makes blast-furnaces start consuming sulfuric-acid, which
  incentivizes acid producers to ramp.

### Worker

A hired hand.

- `skill` — `{tech_id: float in [0,1]}`. 1.0 is mastery.
- `assigned` — building_id + slot, or null.
- `wage` — derived: `base_wage × (1 + 0.5 × max(skill values))`. Ranges
  $5–$7.50 at `base_wage = $5`.

When a worker contributes to a running recipe, their skill in that recipe's
tech ticks up: `skill += learning_rate × (1 - skill)`. Output multiplier of a
running recipe is `0.5 + 1.5 × avg(skill across assigned workers in the
recipe's tech)`, clamped to `[0.5, 2.0]`.

Newly-hired workers via slot-adoption (`npcFillEmptySlots`) get a skill 0.5
seed in the recipe's tech so adoption isn't gated by a multi-thousand-tick
skill ramp. Workers hired by raw growth still start at skill 0.

### Actor

A company. Player is one; NPCs are others. Per-actor state:

- `cash`, `inventory` (item → qty), `workers`, `buildings` (with slot
  assignments), `researched` (Set), `researchInProgress` (or null).
- `priceBook` — player only — auto-ask prices.
- `priceBelief` — NPC only — per-item multiplier in [0.5, 2.0],
  drifting each tick from fill outcomes.
- `strategy` — `null` (player), `'households'`, `'government'`, or an
  NPC strategy string. The two synthetic strategies are scripted; all
  other NPC actors use a single generic order/growth path.
- `growthBuilding` — seed niche from world.yml. Used as fallback when
  margin-driven growth doesn't find a target. Cross-niche pivots can
  override.
- `stress` (0–4) and `bankruptTicks` — tracked each tick (see
  Resilience).
- `decisions[]` and `tradeLog[]` — 100-entry ring buffers of past
  actions and trades for diagnostics.

### Synthetic actors

- **`households`** absorbs wages (all NPC payroll routes here), drains
  staple inventory per tick (`totalWorkers × rate`), and bids each
  tick for each `household:` item up to `HOUSEHOLD_BID_BUDGET_FRAC`
  of its cash.
- **`government`** is the money issuer. Bids/asks for each
  `gov_ballast:` item up to `qty_cap` per tick. Gov cash side is
  suppressed in `settle` — trades create money for sellers and absorb
  it from buyers (modeling fiat issuance via market operations).
  Liquidation proceeds + residual cash route to households, not gov,
  keeping money supply bounded by gov issuance.

## Loops

### Tick (engine/tick.js)

1. **Production + research.** For each actor: advance running slots
   (debit inputs at progress 0, credit outputs at 1.0); advance
   `researchInProgress` by 1 point; NPC picks new research target if
   idle.
2. **Household consumption.** Drain `totalWorkers × rate` from
   households inventory per staple item.
3. **Order gathering + clearing.** Each actor posts bids/asks: NPCs
   via `npcOrders` (surplus asks + input/maintenance/growth bids),
   households via `householdOrders` (staple bids), gov via
   `governmentOrders` (ballast bids/asks), player via `playerOrders`
   (priceBook + pendingBids). Per-item double auction matches at
   midpoint.
4. **Price drift.** NPC priceBelief drifts on fill outcomes: filled
   ask → up, unfilled ask → down; bids inverted.
5. **Slot adoption + growth + demolition.** Empty slots get filled
   with the best researched recipe (`npcFillEmptySlots`). New
   buildings constructed when growthTarget + materials + cash
   conditions met (`npcGrow`). Chronic-negative slots in redundant
   buildings demolished (`evaluateSlotsAndDemolish`).
6. **Wages + maintenance.** Per actor: pay wages to households,
   consume maintenance items.
7. **Stress + bankruptcy.** Recompute stress; lay off one idle
   worker/tick at stress 3; advance bankruptcy clock at stress 4.
   Eviction fire-sale at 250 ticks. Liquidation at 500 ticks.
8. **Respawn + spawn.** Dead non-player actors respawn after 200
   ticks; staggered actors enter at their `start_tick`.

### Market

`fair_price(item)` is a fixed-point iteration over the recipe graph
(8 iterations, converges). Computed once per data load and cached.

NPCs ask surplus inventory at `fair × (1 + spread) × belief`. They
bid for input + maintenance + growth-material shortfalls at
`fair × (1 ± spread) × belief`, budgeted at fractions of cash.
Distressed actors (stress ≥ 3) discount asks (0.5×); insolvent
(stress 4) discount further (0.2×). Belief values clamped [0.5, 2.0].

### Growth target

`growthTarget(actor, data, prices)` returns the building type to
construct next:

1. **Margin path** — highest belief-weighted per-tick margin recipe
   the actor could run. Considered: any owned-building recipe, plus
   raw-extraction recipes in unowned building types (with a 0.4×
   `PIVOT_PENALTY`). Gated on `MIN_GROWTH_MARGIN_PER_TICK = 1.0`.
2. **Bottleneck path** — most-negative net flow item drives growth of
   a recipe that produces it (raw or owned-niche only).
3. **Fallback `growthBuilding`** — actor's seed niche, gated by both
   the same margin floor and a belief-floor (≤ 0.55 → oversupplied,
   don't grow).

### Resilience

- **Stress** (0–4): cash-vs-wage-runway tiers. Triggers graduated
  behaviors per level (growth freeze, hiring freeze, layoffs, fire-
  sale + production idle).
- **Credit facility**: 60 ticks of wage runway as negative-cash
  credit before bankruptcy clock starts.
- **Bankruptcy**: 500-tick clock at stress 4. Eviction fire-sale at
  250 ticks (half of inventory at 50% recovery).
- **Liquidation**: inventory + buildings recovered at 50% × fair to
  households; actor deleted; respawn queued (200-tick delay) if
  non-player.
- **Decision/trade ring buffers**: last 100 entries each per non-
  synthetic actor. Dumped on liquidation as a compact one-liner by
  default; `TT_TRACE_VERBOSE=1` for full 30 decisions + 20 trades.

### Idle / catch-up

Active session: 1 tick = 1 second wall.

When the session is closed: on next open, run `min(elapsed_seconds, 24h)`
worth of ticks in fast-path mode. Catch-up resolves a 24h gap in seconds.

## Schema

YAML, hand-loaded. Subset: nested 2-space maps (up to 3 levels), inline
arrays, single-line scalars. No multi-line strings, no anchors.

```yaml
# data/items.yml
items:
  iron-ore:
    name: "Iron Ore"
    era: industrial
    tier: 1
    unit: kg

  corn:
    name: "Corn"
    era: industrial
    tier: 1
    unit: kg
    household:
      rate: 0.1
      bid_price: 50
    gov_ballast:
      bid_price: 50
      ask_price: 50
      qty_cap: 8
```

```yaml
# data/recipes.yml
recipes:
  mine-iron-ore:
    name: "Mine Iron Ore"
    building: iron-mine
    outputs:
      iron-ore: 5
    seconds: 30
    workers: 2

  smelt-steel:
    name: "Smelt Steel"
    tech: bessemer-process
    building: blast-furnace
    inputs:
      pig-iron: 2
      coal: 1
    outputs:
      steel: 2
    seconds: 60
    workers: 2
```

```yaml
# data/tech.yml
tech:
  bessemer-process:
    name: "Bessemer Process"
    era: industrial
    prereqs: [ironworking]
    research_cost: 100
```

```yaml
# data/buildings.yml
buildings:
  blast-furnace:
    name: "Blast Furnace"
    slots: 2
    construction:
      brick: 200
    maintenance:
      brick: 0.006
      machine-tool: 0.0005
    tech_maintenance:
      industrial-chemistry:
        sulfuric-acid: 0.001
```

```yaml
# data/world.yml
actors:
  player:
    cash: 10000
  rival-co:
    cash: 1000
    strategy: balanced
    growth_building: kiln
    starting_buildings: [kiln, kiln]
    starting_workers: 4
    starting_assignments:
      kiln: fire-bricks
  engineering-co:
    cash: 50000
    strategy: balanced
    growth_building: assembly-line
    start_tick: 8000        # spawns mid-game
  households:
    cash: 100000
    strategy: households
  government:
    cash: 1000000
    strategy: government
```

## File layout

```
data/
├── items.yml
├── recipes.yml
├── tech.yml
├── buildings.yml
└── world.yml

engine/
├── load.js     # YAML loader (subset dialect)
├── schema.js   # validator: refs resolve, recipe DAG acyclic, tech DAG acyclic
├── tick.js     # tick loop: production, research, orders, clearing, growth,
│               # demolition, wages, stress, bankruptcy, respawn
├── market.js   # fair_price, order generation per actor type, double-auction
│               # clearing, growthTarget, recipe margin
├── worker.js   # skill update, wage formula
├── state.js    # save/load JSON, decision/trade ring buffer helpers
└── harness.js  # headless smoke runner with invariant checks

cli/
└── play.js     # interactive REPL
```

Save state lives at `./save.json` (gitignored). Not source-controlled.

## Finance

v0 is just cash + production + a credit facility (negative-cash buffer up to
60 ticks of wage runway). Loans, equity, and insurance are post-v0.
