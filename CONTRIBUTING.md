# Contributing to PerfBoost

Thanks for taking the time to help. PerfBoost is deliberately small: it does one job, it does it
carefully, and it stays easy to audit. Please keep changes in that spirit.

## Getting started

You need Node.js 18 or newer. There are no dependencies to install.

```bash
git clone https://github.com/coderunknow/Perf-Boost.git
cd Perf-Boost
npm run check   # tests + build + validation
```

`npm run check` must pass before a pull request is merged. It runs, in order:

| Command | What it covers |
| --- | --- |
| `npm test` | Behaviour of `PerfBoost_BP/scripts/main.js` against a fake `@minecraft/server` |
| `npm run build` | Produces `dist/PerfBoost_v0.1.0.mcaddon` |
| `npm run validate` | Manifests, particle identifiers, textures, script invariants, built archive |

## Repository layout

```
PerfBoost_BP/           behavior pack sources
  manifest.json         pack manifest (UUIDs, version, @minecraft/server dependency)
  scripts/main.js       the whole cleaner, one file
PerfBoost_RP/           resource pack sources
  manifest.json
  particles/*.json      particle overrides
  textures/environment/ weather textures
tools/                  build, validation and test tooling (Node, no dependencies)
```

## Guidelines

- **Keep it small.** A performance add-on that costs performance to run is a contradiction. Prefer a
  native query over a loop, and prefer not running at all when there is nothing to do.
- **Never remove something the pack did not promise to remove.** Players, named entities, untracked
  types and fresh entities are off limits. If you change a guarantee, document it in `README.md`,
  `CHANGELOG.md` and the header comment in `main.js`.
- **Guard every engine call.** The script API can throw for entities, dimensions and removals that
  are no longer valid; a failure in one place must never abort a sweep.
- **Formatting.** Two spaces, LF line endings, one statement per line, double quotes. The codebase
  is plain JavaScript (no build step for the pack itself) and must run on the engine's ES2020-class
  runtime — avoid very new syntax.
- **Resource pack.** Particle override files must be named after the vanilla identifier they
  override, must target an identifier in the vanilla particle list, and must stay minimal. The
  validator enforces all of that.
- **Tests.** Add an assertion for every behaviour change. Bug fixes should come with a test that
  fails before the fix.

## Pull requests

1. Branch from `main`.
2. Make the change, update documentation where needed.
3. Run `npm run check` and make sure it is green.
4. Describe what changed and why; mention the exact steps you used to verify it in game if you could
   test in game (version, platform, world setup).

## Reporting bugs

Open an issue with:

- the Minecraft version and platform (Windows, Android, dedicated server, …);
- the PerfBoost version;
- what you expected and what happened;
- the relevant content log lines (any line starting with `[PerfBoost]`);
- the output of `/scriptevent perfboost:status`, if commands are working.

## Releasing

See the *Releasing* section of the [README](README.md#releasing).
