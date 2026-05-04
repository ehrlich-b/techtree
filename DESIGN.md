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

### Recipe

Converts inputs to outputs over time inside a building.

- `tech` — tech_id that gates this recipe. Required for non-extraction recipes.
- `building` — building_id that hosts it.
- `inputs` — `{item_id: amount}` consumed per cycle.
- `outputs` — `{item_id: amount}` produced per cycle.
- `seconds` — cycle time at average skill 1.0.
- `workers` — count required. Cycle cannot start with fewer assigned.

Inputs are debited at cycle start, outputs credited at cycle end. Insufficient
inputs → cycle does not start; building slot sits idle but workers still draw
wages.

### Tech

A research node.

- `prereqs` — list of tech_ids.
- `research_cost` — knowledge points (or seconds × scientist count, equivalent).
- `era` — for grouping/UI.

Tech is per-actor: each actor has its own `researched` set. Researching a tech
unlocks all recipes that name it.

### Building

Hosts recipe slots.

- `slots` — concurrent recipe instances.
- `construction` — `{item_id: amount}` to build.
- `maintenance` — cash per tick whether running or idle.
- `accepts` — optional list of recipe tags or eras to filter what can run here.

### Worker

A hired hand.

- `skill` — `{tech_id: float in [0,1]}`. 1.0 is mastery.
- `assigned` — building_id + slot, or null.
- `wage` — derived: `base_wage × (1 + 2 × max(skill values))`.

When a worker contributes to a running recipe, their skill in that recipe's
tech ticks up: `skill += learning_rate × (1 - skill)`. Output multiplier of a
running recipe is `0.5 + 1.5 × avg(skill across assigned workers in the
recipe's tech)`, clamped to `[0.5, 2.0]`.

### Actor

A company. Player is one; NPCs are others. State per actor: `cash`,
`inventory`, `buildings`, `workers`, `researched`, `price_book` (sell prices
per item), and a `strategy` (NPCs only — fixed lookup table).

## Loops

### Tick

1. **Production.** For each running recipe instance, accumulate progress:
   `dprogress = (output_multiplier) / recipe.seconds`. When `progress ≥ 1.0`,
   credit outputs, reset, attempt to consume inputs for next cycle.
2. **Skill.** Each worker on a running recipe gains skill in that recipe's
   tech.
3. **Orders.** Player and NPCs post buy/sell orders. Player auto-posts sells
   for items in their `price_book`; NPCs post liquidity orders around
   `fair_price`.
4. **Clearing.** Per item: pool bids and asks, match highest bid against
   lowest ask, clear at midpoint, repeat until no overlap.
5. **Settlement.** Cash debited for buys, credited for sells; wages and
   maintenance debited.
6. **Bankruptcy.** If `cash < 0` for `N` consecutive ticks, actor liquidates
   (sell inventory at fair_price × 0.5, demolish buildings for half-refund).

### Market

`fair_price(item)` is computed from the cheapest known recipe path:

```
fair_price(raw_item)      = base_extraction_cost × markup
fair_price(produced_item) = (sum over inputs of fair_price × amount
                             + wage_cost(recipe))
                            / output_amount × markup
```

Where `markup = 1.2` and `wage_cost = recipe.workers × base_wage × recipe.seconds`.

NPC liquidity rules per item:
- Always bid `bid_size` units at `fair_price × 0.95`.
- Always ask `ask_size` units at `fair_price × 1.05`.
- Adjust `fair_price` periodically based on observed clearing prices
  (exponential moving average).

This is not an order book in the trading sense; it's enough liquidity to make
the player feel a market without modeling NPC strategy. Strategic NPCs are
post-v0.

### Idle / catch-up

Active session: 1 tick = 1 second wall.

When the session is closed: on next open, run `min(elapsed_seconds, 24h)`
worth of ticks in fast-path mode (no UI, batched market clears). Catch-up
should resolve a 24h gap in a few seconds.

## Finance

v0 is just cash + production. Loans, equity, and insurance are post-v0.

## Schema

YAML, hand-loaded. Subset: nested 2-space maps, inline arrays, single-line
scalars. No multi-line strings, no anchors.

```yaml
# data/items.yml
items:
  iron-ore:
    name: "Iron Ore"
    era: industrial
    tier: 1
    unit: kg

  steel:
    name: "Steel"
    era: industrial
    tier: 2
    unit: kg
```

```yaml
# data/recipes.yml
recipes:
  mine-iron:
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
    prereqs: [metallurgy-basic]
    research_cost: 100
```

```yaml
# data/buildings.yml
buildings:
  blast-furnace:
    name: "Blast Furnace"
    slots: 1
    construction:
      brick: 200
      iron-bar: 50
    maintenance: 10
```

```yaml
# data/world.yml
actors:
  player:
    cash: 10000
  rival-co:
    cash: 10000
    strategy: balanced
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
├── load.js   # YAML loader (dialect carried from v2)
├── schema.js # validator: refs resolve, recipe DAG acyclic, tech DAG acyclic
├── tick.js   # tick loop (production, skill, orders, clearing, settlement)
├── market.js # fair_price + clearing
├── worker.js # skill update + wage
└── state.js  # save/load JSON

cli/
└── play.js   # interactive REPL
```

Save state lives at `./save.json` (gitignored). Not source-controlled.

## Open questions

- **Recipe cycles.** Tools-make-tools cycles are real (a steel mill needs
  steel for parts). The graph allows them; `fair_price` resolution must handle
  them by fixed-point iteration with a fallback bound, not pure recursion.
- **NPC bootstrap.** NPCs need to post liquidity for items the player wants
  to sell. Solution: every NPC posts liquidity for every item it has cash
  for. Concentration is a strategy parameter for v1+.
- **Bankruptcy respawn.** When an NPC dies, does the world re-seed it? Yes
  after a delay — sandbox should keep multiple actors alive. Strategy may
  rotate.
- **Player-vs-NPC asymmetry.** v0 NPCs are dumb liquidity providers. v1+
  NPCs may corner markets, undercut, race tech. Out of scope for v0.
