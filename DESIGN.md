# Design

## Goals

- **Anchor in physical substrate.** Tool-making isn't the root; it depends on
  physical affordances — combustion, mineral substrate, electromagnetism — that
  exist before humans. The graph should bottom out in nature, not in the first
  human action.
- **Span to ~2076.** Concrete future projections rather than vague gestures.
  Far-future tech that depends on contested breakthroughs should be modeled
  honestly, not omitted.
- **Branch on scenarios.** Some breakthroughs (commercial fusion, antimatter
  containment, AGI) are gates: downstream tech is only meaningful if the gate
  fires. Make this explicit.
- **Quantify uncertainty.** A graph that mixes "the wheel" and "warp drive"
  without distinguishing their epistemic status is misleading. Every node
  carries a confidence in [0, 1].

## Five layers

| Layer       | Definition                                                        | Examples                                                  |
|-------------|-------------------------------------------------------------------|-----------------------------------------------------------|
| `nature`    | Physical/biological substrate. Always available. No prerequisites.| combustion, gravitation, mineral-substrate                |
| `material`  | Physical, reproducible methods. Build, demonstrate, replicate.    | metallurgy, transistor, fusion-reactor                    |
| `social`    | Organizational structures that coordinate human effort.           | property, markets, scientific-method-as-institution       |
| `knowledge` | Abstract systems for understanding and recording.                 | mathematics, evolution, quantum-mechanics                 |
| `scenario`  | Future breakthrough/discovery gates with explicit uncertainty.    | agi-emergence, fusion-grid-commercial, antimatter-bulk-containment |

The split between `material`, `social`, and `knowledge` is the same three-way
distinction that holds for historical analysis: a steam engine, a joint-stock
company, and the calculus are different *kinds* of human achievement and have
different prerequisite structures. `nature` and `scenario` are added as the
graph's lower and upper bounds — what the rest of it bottoms out in, and what
gates the future.

## Dependency types

Three only.

- **hard** — absolutely required. Steel needs iron. Confidence propagates
  through hard edges.
- **soft** — helps but not essential. Telegraph helped railways operate at
  scale, but railways predate it.
- **catalyst** — accelerates development. Mathematics speeds engineering;
  engineering can develop without it but more slowly.

There is no `synergistic` type. It was used once across 545 edges in an earlier
revision and dropped — most "synergistic" relationships were better expressed
as a pair of soft/catalyst edges.

Cycle detection runs on `hard` edges only. Mutually-reinforcing pairs in
`soft` or `catalyst` (mathematics ↔ astronomy, agriculture ↔ pottery) are
valid and expected — they represent feedback loops, not contradictions.

## Confidence

- **Self-confidence** — how likely is this node to exist by its target year,
  *given its prerequisites are met*? Default 1.0 (historical, certain).
- **Effective confidence** — `min(self, min over hard prereqs of
  effective)`. Computed by `effectiveConfidence()` in `schema.js`, not
  stored.

The propagation rule says: a tech can be no more confident than the least
confident gate it depends on. If `fusion-rocket` (self 0.30) depends hard on
`fusion-grid-commercial` (effective 0.50), `fusion-rocket`'s effective
confidence is 0.30. If `antimatter-power-cell` (self 0.30) depends hard on
`antimatter-bulk-containment` (effective 0.08), the cell's effective
confidence is 0.08, regardless of how confident we are in the cell engineering
itself.

### Bands

A confidence threshold convention rather than a separate field:

- `≥ 0.50` — **anchor**. The main timeline assumes it. We should plan around it.
- `0.20–0.49` — **probable**. Design-relevant if it fires, but not load-bearing.
- `< 0.20` — **speculative**. Side-branch. Only matters if it fires.

`fusion-grid-commercial` at 0.50 is the lowest-confidence anchor in the current
tree — it's the threshold case for "yes, plan around this."
`antimatter-bulk-containment` at 0.08 is a clean speculative example: real
physics, real downstream tech, but firmly side-branch.

## Schema

The YAML map key is the id; there's no separate `id:` field.

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
    one_liner: "Net-positive fusion deployed competitively at utility scale."

  fusion-rocket:
    name: "Fusion Propulsion"
    layer: material
    year: 2070
    confidence: 0.30           # effective = min(0.30, 0.50) = 0.30
    prerequisites:
      hard: [fusion-grid-commercial, advanced-materials]
```

### Required fields

- `name` — display name
- `layer` — one of the five

### Optional fields

- `year` — integer; negative for BCE. Used for layout and the future-window filter.
- `confidence` — number in [0, 1]. Defaults to 1.0.
- `prerequisites.{hard,soft,catalyst}` — arrays of ids.
- `one_liner` — single-line description shown in `report.js` output.
- `sources`, `notes` — free text, not enforced.

## File layout

```
tree/definitions/
├── nature.yml             # substrate (no era split)
├── scenarios.yml          # future gates
├── material/{era}.yml     # historical material tech
├── social/{era}.yml       # historical social tech
└── knowledge/{era}.yml    # historical knowledge tech
```

Eras: `prehistoric` (< 3000 BCE), `ancient` (3000 BCE – 500 CE), `medieval`
(500 – 1450), `early-modern` (1450 – 1750), `industrial` (1750 – 1950),
`information` (1950 – 2000), `contemporary` (2000 – 2030), `future` (≥ 2030).
The era split is for human navigation; the tree itself is keyed on `year`.

## Tools

- `schema.js` — YAML loader, validator, cycle detector, confidence rollup. The
  YAML loader is hand-rolled (no npm dependency) and supports a deliberate
  subset: nested 2-space-indent maps, inline arrays, single-line scalars.
- `grapher.js` — GraphViz emitter. Shape encodes layer (cylinder/box/ellipse/
  diamond/octagon), fill opacity encodes effective confidence, edge style
  encodes dep type (solid red / dashed gray / dotted blue). Year-bucketed
  L→R layout with nature pinned leftmost.
- `report.js` — text view of the future window, grouped by effective
  confidence band, with each scenario's downstream reach.

## Open questions

- **Substrate-rooting historical tech.** Currently 8 of ~127 historical nodes
  are rooted explicitly in `nature`; the rest reach nature only transitively.
  Whether to assert e.g. `language → mechanical-affordances` (vocal tract /
  hearing) explicitly is mostly judgment, not mechanical.
- **Granularity.** "Mathematics" is one node; in reality it's hundreds of
  technologies developed over millennia. The current granularity targets the
  level where a graph is interpretable; finer granularity is possible but
  changes the tool from "tech tree" to "history of ideas database."
- **Disputed origins.** Where invention is contested (compass, gunpowder,
  printing) the YAML records the earliest credible date. The graph is not the
  place to litigate origin debates; that belongs in per-node prose, currently
  not modeled.
