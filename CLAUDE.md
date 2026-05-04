# CLAUDE.md — working conventions for TechTree

## Reanchor

When asked to "reanchor," re-read `README.md`, `DESIGN.md`, `TODO.md`, and
this file. The combination is the project's working state.

## What this is

An idle market simulation. Industrial → space scope. You run one company
among NPCs. Tick-based; workers gain skill; market clears each tick. Full
spec in `DESIGN.md` — keep it consistent with that doc; don't invent parallel
definitions here.

## Entities (one-liners)

- **item** — tradeable good with id, name, era, tier, unit. Either raw
  (extracted via a no-input recipe) or produced (output of some recipe).
- **recipe** — inputs → outputs over `seconds`, requires `workers` and a
  `building`, gated by `tech` (omit `tech` for raw extraction).
- **tech** — research node with prereqs and a research_cost. Researched
  per-actor.
- **building** — hosts recipe slots; has construction cost and maintenance.
- **worker** — has per-tech skill in `[0,1]`; output multiplier 0.5–2.0;
  wage scales with max skill.
- **actor** — company with cash, inventory, buildings, workers, researched
  tech, and a price_book.

## File layout

```
data/
├── items.yml
├── recipes.yml
├── tech.yml
├── buildings.yml
└── world.yml

engine/
├── load.js   # YAML loader
├── schema.js # validator
├── tick.js   # tick loop
├── market.js # clearing
├── worker.js # skill/wages
└── state.js  # save/load

cli/
└── play.js   # interactive REPL
```

## YAML dialect

Hand-rolled subset: nested 2-space-indent maps, inline arrays, single-line
scalars. No multi-line strings, no anchors. Don't introduce features that
need a real parser without first asking.

## Adding nodes

Item:
```yaml
new-item:
  name: "Display Name"
  era: industrial
  tier: 2
  unit: kg
```

Recipe (must reference items, a building, and a tech that all exist):
```yaml
new-recipe:
  name: "Display Name"
  tech: some-tech
  building: some-building
  inputs:
    input-a: 2
  outputs:
    output-a: 1
  seconds: 60
  workers: 1
```

Run `make validate` before committing.

## Editing principles

- **All items productive.** Every item is either output of an extraction
  recipe or consumed by some other recipe. No decorative goods.
- **Tier is structural, not historical.** Tier reflects how deep an item
  sits in the recipe graph, not whether it's "advanced." Don't use tier as
  a status ranking.
- **No LLM filler.** `name` is required; flavor text is not modeled. Keep
  YAML lean.
- **Edit existing files over creating new ones.** Don't add scratch files,
  meta-docs, or planning documents unless asked.
- **Match surrounding style.** YAML files have a specific shape; conform.

## TODO.md is canonical

Track project work in `TODO.md`. The harness's TaskCreate is for in-session
step tracking, not project-level state.

## Scope

- The YAML files in `data/` are the source of truth for game *content*
  (items, recipes, tech, buildings, world spec).
- Runtime state (cash, inventory, skill, market history) lives in JSON
  saves, is not source-controlled.
- v0 is a CLI prototype. Web UI, fancier visualization, and broader era
  coverage are post-v0.
