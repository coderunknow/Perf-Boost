# PerfBoost

**A small, careful performance add-on for Minecraft Bedrock Edition.**

PerfBoost trims the entity clutter that quietly costs frames on busy worlds — dropped items, XP orbs
and arrows — and ships a lightweight resource pack that removes the smoke, splashes, drips and
flames that add up over a long session, along with the full-screen rain and snow layer.

Both packs are bundled in a single `.mcaddon`, work on **Bedrock 1.21.90 or newer** and use the
**stable** `@minecraft/server` 2.0.0 API, so **no experimental toggles are required**.

[![CI](https://github.com/coderunknow/Perf-Boost/actions/workflows/ci.yml/badge.svg)](https://github.com/coderunknow/Perf-Boost/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/coderunknow/Perf-Boost?label=release)](https://github.com/coderunknow/Perf-Boost/releases)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Minecraft](https://img.shields.io/badge/Minecraft-1.21.90%2B-3C8527)

---

## Contents

- [What it does](#what-it-does)
- [Install](#install)
- [Commands](#commands)
- [Safety guarantees](#safety-guarantees)
- [Configuration](#configuration)
- [How the cleaner works](#how-the-cleaner-works)
- [Resource pack](#resource-pack)
- [Compatibility](#compatibility)
- [Repository layout](#repository-layout)
- [Development](#development)
- [Releasing](#releasing)
- [Troubleshooting](#troubleshooting)
- [License](#license)

## What it does

**Behavior pack — the cleaner.** Every 5 seconds it counts dropped items, XP orbs and arrows in each
dimension. Anything above the per-dimension limit is removed **oldest first**, capped at 60 removals
per pass so the cleanup itself never causes a hitch.

**Resource pack — the lightweight visuals.** Nineteen vanilla particle effects that are emitted in
huge numbers are overridden with a single, sub-pixel, near-instant particle, and the rain/snow
textures are made fully transparent so bad weather costs nothing to draw. Nothing else about the
vanilla look is touched.

## Install

1. Download `PerfBoost_v0.1.0.mcaddon` from [Releases](../../releases) (or build it yourself — see
   [Development](#development)).
2. Open the file with Minecraft: **Windows / Android / iOS / console** — double-click or use
   *Settings → Storage → Import*; **Bedrock Dedicated Server** — drop it into the server's
   `development_behavior_packs` area or unzip it into the `behavior_packs`/`resource_packs`
   folders.
3. Enable both packs for the world:
   - **PerfBoost v0.1.0 (Behavior)** — world settings → *Behavior Packs*
   - **PerfBoost v0.1.0 (Resources)** — world settings → *Resource Packs*
4. Leave the world's experiments untouched: this add-on needs none.

> Existing worlds are safe to update: nothing is stored in the world, and every value is derived at
> runtime. Settings are applied per world, exactly like any other pack.

## Commands

Three commands, run them from chat, a command block or the server console:

| Command | What it does |
| --- | --- |
| `/scriptevent perfboost:status` | Live counts per dimension, limits, removal totals and the next pass |
| `/scriptevent perfboost:clean` | Runs the cleaner immediately, without the 60-removals budget |
| `/scriptevent perfboost:help` | Lists the commands and the protection rules |

Example `status` output:

```
[PerfBoost v0.1.0] status
Overworld: items 212/100, XP orbs 40/75, arrows 3/50
Nether: items 5/100, XP orbs 0/75, arrows 0/50
The End: items 12/100, XP orbs 0/75, arrows 0/50
removed: 148 (last pass: 60) · next pass in 3.4s
1 pair(s) above the limit: 112 of 112 excess entities can go now.
```

Counts above a limit are shown in red, and the add-on tells you when excess entities are still
inside the protection window instead of silently doing nothing.

## Safety guarantees

The cleaner never removes:

- **players** — or any entity type it does not track, such as mobs, boats or minecarts;
- **named entities** — anything with a name tag is treated as yours to keep;
- **fresh entities** — anything first seen less than 10 seconds ago is protected, so a drop is
  always older than the pile it joins before it can be considered.

On top of that:

- removal is **oldest first**, so the item that survives is the one that was dropped last;
- a single pass removes at most **60 entities**, which keeps the cleanup itself smooth;
- automatic passes are **skipped while no player is online**, because unloaded worlds do not lag;
- every engine call that can fail is guarded, and a failure in one dimension never stops the sweep;
- failures are written to the content log **once per cause** instead of every pass.

## Configuration

All tuning lives in one object at the top of
[`PerfBoost_BP/scripts/main.js`](PerfBoost_BP/scripts/main.js):

| Key | Default | Meaning |
| --- | --- | --- |
| `intervalTicks` | `100` | Time between automatic passes (100 ticks = 5 s) |
| `minAgeTicks` | `200` | Protection window for newly seen entities (200 ticks = 10 s) |
| `removePerSweep` | `60` | Maximum removals per automatic pass |
| `maxTracked` | `20000` | Safety cap on the age cache; only relevant if pruning ever fails |
| `limits` | items `100`, XP orbs `75`, arrows `50` | Per-dimension limits, checked in this order |
| `dimensions` | overworld, nether, the end | Dimensions that are swept |

Change a value, then run `npm run check` and `npm run build` to produce an updated `.mcaddon`. The
limits are **per dimension**, so `items: 100` means 100 dropped items *per dimension*.

## How the cleaner works

1. **Scan** — one `getEntities` query per tracked type per dimension (9 queries per pass).
2. **Age** — each entity's first sighting is remembered by entity id. Newly seen entities start
   their protection window and are never removed in the pass that meets them.
3. **Select** — entities above the limit are sorted by age and the oldest are chosen first.
4. **Trim** — up to `removePerSweep` removals, skipped for named entities, entities that are already
   gone and anything the engine refuses to remove.
5. **Prune** — age records for entities that no longer exist are dropped, so the cache follows the
   real entity population instead of growing forever.

The whole pass is a handful of native queries and an array sort, and it costs nothing while no
player is online.

## Resource pack

Overridden particle effects (all replaced by a single sub-pixel particle with a ~1-tick lifetime):

| Group | Particles |
| --- | --- |
| Smoke | `basic_smoke_particle`, `campfire_smoke_particle`, `campfire_tall_smoke_particle` |
| Splashes | `rain_splash_particle`, `water_splash_particle`, `water_splash_particle_manual`, `cauldron_splash_particle`, `basic_bubble_particle` |
| Drips | `lava_drip_particle`, `stalactite_lava_drip_particle`, `water_drip_particle`, `stalactite_water_drip_particle` |
| Flame | `basic_flame_particle`, `candle_flame_particle`, `lava_particle` |
| Explosions | `explosion_particle`, `large_explosion`, `huge_explosion_emitter`, `death_explosion_emitter` |
| Weather | `textures/environment/rain.png` and `snow.png` are fully transparent, so rain and snow are invisible |

Every identifier is validated against the vanilla particle list, so an override that would have no
effect in game fails CI. Smoke and campfire smoke are the noticeable ones: campfires no longer
produce smoke while the pack is enabled.

Damage, sounds, loot, mob behaviour and gameplay are **not** affected.

## Compatibility

| | |
| --- | --- |
| Minecraft | Bedrock 1.21.90 or newer (stable, no experiments) |
| Script API | `@minecraft/server` 2.0.0 |
| Realms | Supported (pack settings are per world) |
| Dedicated server | Supported, both packs are client-safe |
| Other add-ons | The cleaner only touches items, XP orbs and arrows; it will not fight add-ons that add their own entities unless those types are tracked. |

The resource pack is client-side: players who join without it simply see vanilla particles. The
behavior pack is world-side.

## Repository layout

```
PerfBoost_BP/           behavior pack (manifest, icon, scripts/main.js)
PerfBoost_RP/           resource pack (manifest, icon, particles/, textures/)
tools/build.mjs         deterministic .mcaddon packager
tools/validate.mjs      manifest, particle, texture and artifact validation
tools/test.mjs          behaviour tests for scripts/main.js
tools/fake-server.mjs   fake @minecraft/server used by the tests
.github/workflows/      CI and release automation
dist/                   build output (git-ignored)
```

## Development

Requires Node.js 18 or newer. No dependencies are installed — the tools use the standard library.

```bash
npm test        # behaviour tests for the cleaner
npm run build   # dist/PerfBoost_v0.1.0.mcaddon
npm run validate # checks manifests, particles, textures and the built archive
npm run check   # all three, in that order
```

`npm run check` is the gate used by CI: it runs the behaviour tests, rebuilds the `.mcaddon` and
verifies that the archive contains exactly the sources, byte for byte. Builds are deterministic —
building the same sources twice produces the same SHA-256.

The behaviour tests run the real `scripts/main.js` against a fake `@minecraft/server`, covering the
protection rules, oldest-first ordering, per-sweep budget, per-dimension limits, engine failures,
age-cache pruning, every command and the command-block fallback path.

## Releasing

1. Update the version in `PerfBoost_BP/manifest.json`, `PerfBoost_RP/manifest.json`,
   `PerfBoost_BP/scripts/main.js` (`VERSION`), `package.json` and `CHANGELOG.md`.
2. Run `npm run check` and commit.
3. Tag the release: `git tag v0.1.0 && git push origin v0.1.0`.
4. The [release workflow](.github/workflows/release.yml) reruns the checks, rebuilds the add-on,
   verifies it and attaches `PerfBoost_v0.1.0.mcaddon` to the tag's GitHub release (creating the
   release on the tag if it does not exist yet).
5. Release notes are curated from `CHANGELOG.md`, for example
   `gh release edit v0.1.0 --notes-file RELEASE_NOTES.md`.

## Troubleshooting

**Nothing happens when I use the commands.** Check that the behavior pack is enabled and that the
script module loaded: the content log (Bedrock: *Settings → Creator → Content Log*) shows
`[PerfBoost]` warnings if something is wrong. `/scriptevent` commands must use the exact
`perfboost:` namespace.

**The cleaner removed something I wanted to keep.** Add a name tag to it — named entities are never
removed — or raise the limit in the configuration.

**The pack needs to be re-loaded after editing scripts.** Bedrock reloads the script module when the
world starts, or when you run `/reload` (server operators). After a reload all entities are treated
as freshly seen for 10 seconds.

**Rain or snow is invisible.** That is intentional: the resource pack ships fully transparent weather
textures, which is what removes the cost of the full-screen weather layer. Turn the resource pack off
for that world if you want vanilla weather back.

## License

[MIT](LICENSE) © coderunknow
