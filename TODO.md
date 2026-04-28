# TODO

## Open work

- **Wire historical tech to `nature` substrate explicitly where it sharpens
  the graph.** Currently 8 of ~127 historical nodes name nature parents
  directly; the rest reach nature only transitively through `tool-making`,
  `agriculture`, etc. The judgment call is per-node: is asserting e.g.
  `language → mechanical-affordances` (vocal tract / hearing) clarifying or
  pedantic? Walk era-by-era and decide case-by-case.

- **Sources.** No node currently has a populated `sources` field. The schema
  accepts it; nothing enforces it. Decide whether to require sources on new
  nodes and backfill systematically, or leave it as an optional field that
  gets filled when claims are contested.

- **Disputed-origin prose.** The graph stores a single year and parent set per
  tech. For technologies with multiple credible invention points (writing,
  agriculture, metallurgy, the wheel) the nuance is currently not modeled.
  Adding a free-text `notes` field per node is cheap; rendering it is the
  question.

- **Browsable rendering.** `dependencies.svg` is the only visual output and
  it's a wall of 192 nodes. A static-site view (one page per node, prereqs
  and dependents linked, confidence band rendered) is the obvious upgrade
  but is real work and may not be worth it until the content is denser.

## Conventions

- Update this file when scope changes — don't let it drift.
- Use `make validate` before committing changes to YAML.
- New nodes: name, layer, year (if applicable), prereqs. Everything else
  optional.
