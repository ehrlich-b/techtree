# TODO

## Reboot status (2026-04-26)

The original v1 tree (Aug 2025) had a working pipeline and a useful three-layer
taxonomy, but the 127 generated READMEs were LLM slop, the future era was structurally
inadequate for "raw nature → +50 years with required/optional breakthroughs," and 6
meta-docs were written before content was solid. v2 spine is now in place:
`REBOOT.md` is the design.

### Done

- New schema: `nature` and `scenario` layers added; `confidence` (0–1) field; `year`
  replaces `era`; `synergistic` dropped; redundant `id:` field optional.
- `tree/definitions/nature.yml` — 12 substrate nodes (combustion, electromagnetism-
  phenomenon, mineral-substrate, etc.). The new roots.
- `tree/definitions/scenarios.yml` — 27 breakthrough gates split across confidence
  bands (anchor ≥ 0.50, probable 0.20–0.49, speculative < 0.20). Includes Bryan's
  required example (`fusion-grid-commercial`, c=0.50) and optional example
  (`antimatter-bulk-containment`, c=0.08).
- New future YAMLs (`material/social/knowledge/future.yml`) wired to scenarios.
- `build_tools/schema.js` rewritten: union-tolerant (v1+v2), proper YAML parsing,
  cycle detection on hard edges only, reference resolution scoped to first-class
  dep types, confidence propagation via `effectiveConfidence()`.
- `build_tools/report.js` — confidence-banded view of the future tree and scenario
  reach. `make report` to run.
- A handful of strategic historical entries wired to nature substrate as exemplars:
  `tool-making`, `fire-control`, `agriculture`, `metallurgy`, `astronomy`, `genetics`,
  `quantum-mechanics`, `electricity`.
- 192 nodes validate clean. Effective-confidence distribution: 128 certain, 24
  anchor, 20 probable, 20 speculative.
- `build_tools/migrate.js` — one-shot v1→v2 converter. Run on all 22 legacy YAMLs:
  116 entries migrated, 76 v2 entries round-tripped. Net `-2102/+296` lines. Year
  inferred from `historical.first_occurrence` regex, falling back to era midpoint.
  Idempotent: re-running on v2 data is a no-op.
- `build_tools/grapher.js` rewritten for v2: shape by layer (nature=cylinder,
  material=box, social=ellipse, knowledge=diamond, scenario=octagon), fill opacity
  by effective confidence (33/77/BB/FF for speculative/probable/anchor/certain),
  edge style by dep type (hard=red solid, soft=gray dashed, catalyst=blue dotted).
  Year-bucketed L→R layout pinning nature substrate at rank=min. Renders 192-node
  tree to `dependencies.{dot,svg}` (81KB / 387KB).
- Deleted v1 cruft: 127 LLM-slop READMEs (`tree/technologies/*/README.md`) and 7
  bikeshed meta-docs (`EDUCATORS_GUIDE.md`, `STUDENT_EXERCISES.md`, `THEMED_PATHS.md`,
  `CRITICAL_PATHS.md`, `VISUALIZATION_SUMMARY.md`, `ANALYSIS.md`, `tree/NAVIGATION.md`).

### Pending — non-destructive work

- [ ] Wire remaining historical entries to `nature` substrate (currently only 8 of 127
  rooted explicitly; the rest reach nature only transitively). Many historical entries
  with human-only prereqs (mathematics, language, philosophy) are arguably correct as-is
  — the question is whether to assert e.g. `language → mechanical-affordances` (vocal
  tract / hearing) explicitly. Mostly judgment, not mechanical.
- [ ] Decide whether `tree/technologies/` (the symlink-based folder structure) is still
  worth maintaining post-reboot, or replace with a single rendered HTML/static-site view.

### Notes

- The v1 had `synergistic` deps used exactly once across 545 edges. Dropped from the
  schema; tolerated in legacy data so old YAML still loads.
- Cycle detection now runs only on `hard` edges. `mathematics ↔ astronomy` and similar
  mutually-reinforcing pairs in `soft`/`catalyst` were valid v1 data flagged as cycles
  by the old validator; that was a bug.
- The v1 schema required 6 fields including `complexity` and `description`. v2 requires
  only `name` and `layer`. Most v1 fields are tolerated and ignored.
