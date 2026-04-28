# TechTree

A directed acyclic graph of human technological development, from physical
substrate up through speculative late-21st-century scenarios. Each node is a
technology — material, social, or knowledge — wired to its prerequisites by
type. Future nodes carry a confidence in [0, 1] that propagates through hard
prereqs as a min, so a tech downstream of a 0.10 scenario can never be more
certain than 0.10.

192 nodes, ~680 edges. Pure Node.js tooling, no npm dependencies. GraphViz
for rendering.

## Layers

| Layer       | Definition                                                        | Examples                                                  |
|-------------|-------------------------------------------------------------------|-----------------------------------------------------------|
| `nature`    | Physical/biological substrate. Always available. No prerequisites.| combustion, electromagnetism-phenomenon, mineral-substrate|
| `material`  | Physical, reproducible methods. Build, demonstrate, replicate.    | metallurgy, transistor, fusion-reactor                    |
| `social`    | Organizational structures that coordinate human effort.           | property, markets, ai-governance-regime                   |
| `knowledge` | Abstract systems for understanding and recording.                 | mathematics, evolution, quantum-mechanics                 |
| `scenario`  | Future breakthrough/discovery gates with explicit uncertainty.    | agi-emergence, fusion-grid-commercial, antimatter-bulk-containment |

## Dependency types

- **hard** — absolutely required (steel needs iron). Confidence propagates through.
- **soft** — helps but not essential (telegraph helped railways).
- **catalyst** — accelerates development (mathematics speeds engineering).

Cycles are checked on `hard` edges only. Mutually-reinforcing pairs in `soft`
or `catalyst` (math ↔ astronomy) are valid and expected.

## Confidence

- **Self-confidence:** how likely a node exists by its target year, *given its
  prerequisites are met*. Default 1.0 for historical nodes.
- **Effective confidence:** `min(self, min over hard prereqs of effective)`.
  Computed by tools, not stored.
- **Bands:** `≥ 0.50` anchor (main timeline plans around it), `0.20–0.49`
  probable, `< 0.20` speculative side-branch.

Current rollup: 128 certain, 24 anchor, 20 probable, 20 speculative.

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
```

The map key *is* the id. No redundant `id:` field.

## Layout

```
tree/definitions/
├── nature.yml             # substrate (no era split; ~12 nodes)
├── scenarios.yml          # future gates (~27 nodes)
├── material/{era}.yml     # historical material tech
├── social/{era}.yml       # historical social tech
└── knowledge/{era}.yml    # historical knowledge tech

build_tools/
├── schema.js              # YAML loader, validator, cycle check, confidence rollup
├── grapher.js             # GraphViz renderer (shape by layer, opacity by confidence)
└── report.js              # confidence-banded text view of the future window
```

Eras: `prehistoric, ancient, medieval, early-modern, industrial, information,
contemporary, future`.

## Build

```
make validate    # schema + cycle check + confidence rollup
make graph       # dependencies.dot + dependencies.svg (needs GraphViz)
make report      # text view of future-window tech grouped by confidence band
make all         # all of the above
```

## Design

See [DESIGN.md](DESIGN.md) for the layer/dependency/confidence model in detail
and the rationale behind each choice.

## Conventions

- IDs are `lowercase-with-hyphens`. Descriptive but concise.
- Every claim has historical basis. Document uncertainty; don't paper over it.
- No "primitive" vs "advanced" framing. Recognize parallel and non-Western
  invention paths.
- The map key is the id. The YAML hand-loader has no npm deps but also no
  exotic features — single-line scalars, 2-space indent, inline arrays.
