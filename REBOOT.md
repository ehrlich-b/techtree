# Reboot — TechTree v2

The original tree (Aug 2025, 127 nodes) had a working YAML pipeline and a useful
three-layer taxonomy, but the content was LLM slop and the future era was structurally
inadequate for "raw nature → +50 years with required and optional breakthrough branches."
This is the new spine.

## Goals

- **Anchor in raw nature.** Tool-making is not the root; it depends on physical
  affordances (combustion, mineral substrate, electromagnetism) that exist before humans.
- **Span to ~2076.** Concrete future projections, not vague gestures.
- **Branch on scenarios.** Some breakthroughs (fusion-grid-commercial, antimatter
  containment, AGI) are gates: downstream tech is only meaningful if the gate fires.
- **Quantify uncertainty.** Each future node carries a `confidence` in [0, 1].
  Confidence propagates through hard prereqs as a min — a tech that depends on a 0.10
  scenario can never be more certain than 0.10.

## Five layers

| Layer       | Definition                                                        | Examples                                |
|-------------|-------------------------------------------------------------------|-----------------------------------------|
| `nature`    | Physical/biological substrate. Always available. No prerequisites.| combustion, gravitation, mineral-substrate |
| `material`  | Physical, reproducible methods. Build, demonstrate, replicate.    | metallurgy, transistor, fusion-reactor  |
| `social`    | Organizational structures that coordinate human effort.           | property, markets, scientific-method-as-institution |
| `knowledge` | Abstract systems for understanding and recording.                 | mathematics, evolution, quantum-mechanics |
| `scenario`  | Future breakthrough/discovery gates with explicit uncertainty.    | agi-emergence, fusion-grid-commercial, antimatter-bulk-containment |

## Dependency types

Three only — `synergistic` was used once across 545 edges in v1; deleted.

- **hard** — absolutely required (steel needs iron). Confidence propagates through.
- **soft** — helps but not essential (telegraph helped railways).
- **catalyst** — accelerates development (mathematics speeds engineering).

## Schema

```yaml
technologies:
  combustion:
    name: "Combustion"
    layer: nature
    one_liner: "Exothermic oxidation of fuels in oxygen."

  fire-control:
    name: "Fire Control"
    layer: material
    year: -1500000
    prerequisites:
      hard: [combustion, tool-making]

  fusion-grid-commercial:
    name: "Fusion at Grid Scale"
    layer: scenario
    year: 2045
    confidence: 0.50
    prerequisites:
      hard: [fusion-ignition, plasma-physics]
    one_liner: "Net-positive fusion deployed at utility scale."

  fusion-rocket:
    name: "Fusion Propulsion"
    layer: material
    year: 2070
    confidence: 0.30           # capped by min(self, hard prereqs) = 0.30 anyway
    prerequisites:
      hard: [fusion-grid-commercial, advanced-materials]
```

The YAML map key IS the id. No redundant `id:` field.

## Confidence

- **Self-confidence:** how likely is this node to exist by its target year, *given its
  prerequisites are met*? Default 1.0 (historical, certain).
- **Effective confidence:** `min(self, min over hard prereqs of effective_confidence)`.
  Computed by tools, not stored.
- **Required vs optional** is just a confidence threshold convention:
  - `≥ 0.50` — anchor scenario; the tree's main timeline assumes it
  - `0.20–0.49` — probable; design-relevant
  - `< 0.20` — speculative side-branch; only matters if it fires

## File layout

```
tree/definitions/
├── nature.yml             # substrate (no era split; ~12 nodes)
├── scenarios.yml          # future gates (~25 nodes)
├── material/{era}.yml     # historical material tech
├── social/{era}.yml       # historical social tech
└── knowledge/{era}.yml    # historical knowledge tech
```

Eras (`prehistoric` … `contemporary`) keep their existing per-layer/era split. The
`future/` per-layer files are rewritten in the new schema and depend on `scenarios.yml`.

## What gets thrown out (with sign-off)

- All 127 generated `tree/technologies/*/README.md` — LLM slop with unfilled placeholders.
- Meta-docs: `EDUCATORS_GUIDE.md`, `STUDENT_EXERCISES.md`, `THEMED_PATHS.md`,
  `CRITICAL_PATHS.md`, `VISUALIZATION_SUMMARY.md`, `ANALYSIS.md`, `tree/NAVIGATION.md`.
  All written before content was solid; bikeshedding artifacts.
- `dependencies.{dot,svg,png}` — regenerate after the new graph stabilizes.
- The "Phase N COMPLETE ✅" theater in `TODO.md` — replaced by a tight reboot tracker.

## What gets kept

- The YAML schema concept and three-layer taxonomy (extended).
- The `build_tools/*.js` — small, no npm deps, mostly works. Schema validator is updated
  to accept both old and new field names so the 127 historical entries keep validating
  during migration.
- The 127 historical YAML entries themselves — content is fine, generated READMEs are
  what's bad.

## Migration

Validator is union-tolerant: `type`/`layer`, `era`/`year`, missing `id`, missing
`complexity` all accepted. So no big-bang migration is needed. New entries use the new
schema; old entries can be migrated lazily or via `build_tools/migrate.js` (deferred).

## Build commands (unchanged)

```
make validate    # schema check across all YAML
make analyze     # stats, including effective-confidence rollup
make graph       # GraphViz output, with confidence-encoded edge styles (TODO)
```
