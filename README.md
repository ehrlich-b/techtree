# TechTree

An idle market simulation built on a tech tree from the industrial era through
space.

You run one company among several NPC competitors in a tick-based economy.
Workers gain skill at recipes they repeatedly run. Every good in the game has
a productive use — items are extracted, transformed, and sold; cash is just
the clearing mechanism. Research unlocks new recipes. The market clears each
tick; prices respond to supply and demand.

Pure Node.js, no npm dependencies. CLI-first; sessions are short — the
simulation keeps running while you're away.

## Status

Pre-v0. Anchor docs and project skeleton are in place; engine and seed data
are stubs. See [TODO.md](TODO.md) for what's next.

## Run

```
make validate    # check data integrity (refs resolve, no cycles)
make play        # start the CLI loop (TODO)
```

## Layout

- [DESIGN.md](DESIGN.md) — model spec: entities, tick loop, market clearing,
  schema.
- [CLAUDE.md](CLAUDE.md) — working conventions for contributors.
- [TODO.md](TODO.md) — current milestones.
- `data/` — YAML source of truth for items, recipes, tech, buildings, world.
- `engine/` — simulation core (loader, validator, tick, market, save/load).
- `cli/` — interactive REPL.

## Conventions

- Item, recipe, tech, and building ids are `lowercase-with-hyphens`.
- YAML dialect is a deliberate subset (single-line scalars, 2-space maps,
  inline arrays). The hand-rolled loader does not support multi-line strings
  or anchors.
- Every item must be productive: extracted from a deposit-style recipe, or
  consumed by at least one other recipe. No purely-decorative goods.

## History

This started as a static DAG of human technological development from physical
substrate through speculative late-21st-century tech. The v3 game pivot kept
the "tech tree" framing but discarded the data — the prior schema lives in
git history if needed.
