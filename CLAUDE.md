# CLAUDE.md — working conventions for TechTree

## Reanchor

When asked to "reanchor," re-read `README.md`, `DESIGN.md`, `TODO.md`, and
this file. The combination is the project's working state.

## Model

Five layers, three dependency types, confidence in [0, 1] propagating through
hard prereqs as a min. Full spec in `DESIGN.md` — keep it consistent with
that doc; don't invent parallel definitions here.

- Layers: `nature`, `material`, `social`, `knowledge`, `scenario`.
- Dep types: `hard`, `soft`, `catalyst`. There is no `synergistic`.
- IDs are `lowercase-with-hyphens`. The YAML map key *is* the id.

## File layout

```
tree/definitions/
├── nature.yml
├── scenarios.yml
├── material/{era}.yml
├── social/{era}.yml
└── knowledge/{era}.yml

build_tools/
├── schema.js     # validator, cycle detector, confidence rollup
├── grapher.js    # GraphViz renderer
└── report.js     # confidence-banded text view of future window
```

Eras: `prehistoric, ancient, medieval, early-modern, industrial, information,
contemporary, future`.

## Build

```
make validate    # schema + cycle check + confidence rollup
make graph       # dependencies.{dot,svg}
make report      # future-window text report
make all         # all of the above
```

The YAML loader in `schema.js` is hand-rolled and supports a deliberate subset
of YAML: nested 2-space-indent maps, inline arrays, single-line scalars. No
multi-line strings, no anchors. Don't introduce features that need a real
parser without first asking.

## Adding a node

Required: `name`, `layer`. Optional: `year`, `confidence`, `prerequisites.{hard,
soft,catalyst}`, `one_liner`. That's it. Everything beyond that is fluff
unless the use case demands it.

```yaml
new-tech:
  name: "Display Name"
  layer: material
  year: 1850
  prerequisites:
    hard: [parent-id]
```

For scenario nodes, add `confidence` explicitly. For historical nodes, omit it
(defaults to 1.0).

## Editing principles

- **Historical accuracy first.** Every claim must have a basis. Document
  uncertainty rather than papering over it.
- **No "primitive" vs "advanced" framing.** Recognize parallel and
  non-Western invention paths.
- **No LLM filler.** Don't pad `one_liner` fields with meaningless adjectives.
  If a node doesn't need one, omit it.
- **Edit existing files over creating new ones.** Don't add scratch files,
  meta-docs, or planning documents unless asked.
- **Match surrounding style.** The YAML files have a specific shape; conform
  to it.

## TODO.md is canonical

Track project work in `TODO.md` directly. The harness's TaskCreate is for
in-session step tracking, not project-level state.

## Scope

- The YAML files in `tree/definitions/` are the source of truth. The graph
  has no other persistent representation; rendered outputs (`dependencies.svg`,
  the text report) are derived.
- Per-technology prose is intentionally not modeled. If it ever is, it'll be
  deliberate and bounded — not auto-generated.
- This isn't a game; there are no costs, points, or civilizations. It's a
  data structure plus visualization.
