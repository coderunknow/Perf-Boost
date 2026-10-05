# Changelog

All notable changes to PerfBoost are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-05

First public release: the initial behaviour + resource pack upload, rebuilt around a hardened
cleaner, a verified resource pack and a reproducible build.

### Added

- Reproducible build pipeline: `npm run build` produces `dist/PerfBoost_v0.1.0.mcaddon` with sorted
  entries and fixed timestamps, so identical sources always produce identical bytes.
- Validation for the whole pack (`npm run validate`): manifests, particle identifiers against the
  vanilla list, texture size and transparency, script invariants and a byte-for-byte comparison of
  the built archive against the sources — 299 checks.
- Behaviour test suite (`npm test`) that runs the shipped `scripts/main.js` against a fake
  `@minecraft/server`: 51 assertions covering protection rules, oldest-first ordering, budgets,
  per-dimension limits, engine failures, cache pruning and every command.
- Continuous integration and a release workflow that rebuilds and verifies the add-on, then attaches
  it to the GitHub release.
- Documentation: `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `.editorconfig`, `.gitattributes`.
- Resource pack coverage for 16 more high-frequency vanilla particles: tall campfire smoke, water
  and cauldron splashes, bubbles, water/lava drips, flame, candle flame and the explosion effects.
- New 256×256 pack icon, shipped identically in both packs.

### Changed

- Behaviour pack rewritten for reliability and cost:
  - the cleaner pauses automatically while no player is online (unloaded worlds cost nothing);
  - a single pass removes at most 60 entities, keeping the cleanup itself smooth;
  - every engine call is guarded, so a refusing dimension or entity never stops the sweep and never
    raises an error;
  - repeated failures are written to the content log once per cause instead of every pass;
  - the age cache is pruned against the live entity population and capped, so it cannot grow
    unbounded.
- Per-dimension limits tightened: items 200 → **100**, XP orbs 150 → **75**, arrows 100 → **50**.
- `status` output is now per dimension, marks over-limit rows in red, reports lifetime and
  last-pass removals, the time to the next pass and whether excess is still protected.
- `help` documents the protection rules alongside the three commands.
- Script events are subscribed with a `perfboost` namespace filter, with a fallback for engines that
  reject the filter option.
- Packs use a `min_engine_version` of 1.21.90 and the stable `@minecraft/server` 2.0.0 module, so no
  experimental toggles are needed.
- The `.mcaddon` is now a build artifact (attached to releases) instead of a committed binary.

### Fixed

- The rain splash override targeted `minecraft:rain_splash`, which is not a vanilla identifier, so
  it never had any effect; it now targets `minecraft:rain_splash_particle`.
- `/scriptevent perfboost:clean` and `status` reported "nothing to trim" when the excess was only
  protected by the age window; they now say exactly what is happening.
- Entities first seen by the cleaner can no longer be removed in the same pass that discovers them.
- Removals refused by the engine no longer consume the per-pass budget, so one protected entity
  cannot stop the rest of the sweep.

### Removed

- Stale `PerfBoost_v0.1.0.mcaddon` binary from the repository root (superseded by `dist/` builds and
  release assets).

[0.1.0]: https://github.com/coderunknow/Perf-Boost/releases/tag/v0.1.0
