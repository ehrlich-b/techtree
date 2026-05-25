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

Pre-v0 prototype. Engine + smoke harness functional. Cost-anchored pricing
landed: the full heavy chain clears in the open market, prices discover
cost-anchored levels (no belief-wall saturation), and the corn monoculture
is gone. The economy is now active rather than frozen; the open frontier is
firm churn in thin-margin single-producer chains (needs seeded RNG to tune
+ multi-supplier redundancy). See [TODO.md](TODO.md) for the full picture.

## Run

```
make validate                                # check data integrity
make play                                    # start the CLI loop
make harness                                 # 5k-tick smoke
make harness ARGS="--ticks 50000 --every 5000"
make harness ARGS="--kill coke-co@4000"      # perturbation test
TT_TRACE_VERBOSE=1 make harness              # full death dumps
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
