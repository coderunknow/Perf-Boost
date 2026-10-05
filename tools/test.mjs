/**
 * PerfBoost behaviour tests.
 *
 * The real PerfBoost_BP/scripts/main.js is imported against the fake
 * "@minecraft/server" implementation in tools/fake-server.mjs, so the shipped
 * script is exercised exactly as the game would run it.
 *
 * Usage: node tools/test.mjs
 */

import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORK = join(ROOT, "dist", ".test");
const SCRIPT = join(ROOT, "PerfBoost_BP/scripts/main.js");
const FAKE = join(ROOT, "tools/fake-server.mjs");

/* ---------------------------------------------------------- harness setup */

rmSync(WORK, { recursive: true, force: true });
mkdirSync(join(WORK, "node_modules/@minecraft/server"), { recursive: true });
mkdirSync(join(WORK, "scripts"), { recursive: true });
copyFileSync(SCRIPT, join(WORK, "scripts/main.js"));
writeFileSync(join(WORK, "package.json"), JSON.stringify({ name: "perfboost-test", private: true, type: "module" }, null, 2));
writeFileSync(
  join(WORK, "node_modules/@minecraft/server/package.json"),
  JSON.stringify({ name: "@minecraft/server", version: "2.0.0", type: "module", main: "index.js" }, null, 2),
);
writeFileSync(join(WORK, "node_modules/@minecraft/server/index.js"), `export * from ${JSON.stringify(pathToFileURL(FAKE).href)};\n`);

const { addPlayer, advance, count, despawn, fireScriptEvent, lastMessage, spawn, state } = await import(pathToFileURL(FAKE).href);

const warnings = [];
const originalWarn = console.warn;
console.warn = (...args) => warnings.push(args.join(" "));

let fixture = 0;
/** Imports a pristine copy of the script with its own module state. */
async function loadScript() {
  return import(pathToFileURL(join(WORK, "scripts/main.js")).href + "?fixture=" + fixture++);
}

/** Resets the fake world and loads a fresh script instance. */
async function boot({ players = 1, rejectSubscribeOptions = false } = {}) {
  state.reset();
  warnings.length = 0;
  for (let index = 0; index < players; index++) addPlayer("Tester" + index);
  state.rejectSubscribeOptions = rejectSubscribeOptions;
  await loadScript();
}

/* ------------------------------------------------------------- assertions */

const failures = [];
let assertions = 0;

function plain(text) {
  return String(text ?? "").replace(/§./g, "");
}

function check(label, condition, detail = "") {
  assertions++;
  if (!condition) failures.push(detail ? `${label} - ${detail}` : label);
}

function equal(label, actual, expected) {
  check(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function messageFor(to) {
  const message = [...state.messages].reverse().find((entry) => entry.to === to);
  return plain(message?.text);
}

/** Spawns items and lets one sweep record their age. */
function seedItems(amount, dimensionId = "minecraft:overworld", typeId = "minecraft:item") {
  const ids = [];
  for (let index = 0; index < amount; index++) {
    ids.push(spawn(typeId, dimensionId, { id: `seed-${dimensionId}-${typeId}-${index}` }).id);
  }
  advance(100); // first sweep only records what it sees
  return ids;
}

/* ------------------------------------------------------------------ tests */

// Idle worlds cost nothing.
await boot({ players: 0 });
advance(300);
equal("an empty world is not swept at all", state.calls.getEntities, 0);
equal("no errors while idle", state.errors.length, 0);

// Scheduling.
await boot();
equal("one interval is registered", state.intervals.length, 1);
equal("the sweep period is 100 ticks", state.intervals[0].period, 100);
equal("the cleaner subscribes with a namespace filter", state.subscribers[0]?.namespaces?.join(","), "perfboost");

// Engine builds that reject the filter option must still get working commands.
await boot({ rejectSubscribeOptions: true });
equal("the subscription falls back without filters", state.subscribers.length, 1);
equal("the fallback subscription has no namespace filter", state.subscribers[0]?.namespaces, undefined);
check("the rejected filter option is reported once", warnings.some((line) => line.includes("script event filter")), warnings.join(" | "));
fireScriptEvent("perfboost:help", state.players[0]);
check("commands work through the fallback subscription", messageFor("Tester0").includes("perfboost:status"), messageFor("Tester0"));
const fallbackMessages = state.messages.length;
fireScriptEvent("other:help", state.players[0]);
equal("the handler still ignores other namespaces", state.messages.length, fallbackMessages);

// Fresh drops are protected, then the oldest excess goes first.
await boot();
seedItems(250);
equal("fresh drops survive the first sweep", count("minecraft:item"), 250);
advance(100);
equal("drops younger than the protection window survive", count("minecraft:item"), 250);

advance(100); // the seeded items are now exactly 200 ticks old
equal("the first trim is limited to the per-sweep budget", state.removedIds.length, 60);
check(
  "the oldest items are removed first",
  state.removedIds.every((id, index) => id === `seed-minecraft:overworld-minecraft:item-${index}`),
  state.removedIds.slice(0, 3).join(", "),
);

advance(100);
equal("the next sweep removes the next oldest batch", state.removedIds.length, 120);
advance(100);
equal("trimming stops at the configured limit", count("minecraft:item"), 100);
equal("only the excess was removed", state.removedIds.length, 150);

advance(500);
equal("a dimension inside its limits is left alone", count("minecraft:item"), 100);
equal("no errors while trimming", state.errors.length, 0);

// Named entities are never removed.
await boot();
seedItems(150);
for (const entity of state.dimensions.get("minecraft:overworld").entities.slice(0, 120)) entity.nameTag = "keep";
advance(300);
equal("named entities are never removed", state.dimensions.get("minecraft:overworld").entities.filter((entity) => entity.nameTag).length, 120);
equal("the unprotected excess is removed instead", state.removedIds.length, 30);

// Every dimension is swept independently.
await boot();
seedItems(150, "minecraft:nether", "minecraft:xp_orb");
seedItems(60, "minecraft:the_end", "minecraft:arrow");
advance(300);
equal("the nether is trimmed to its XP orb limit", count("minecraft:xp_orb", "minecraft:nether"), 75);
equal("the end is trimmed to its arrow limit", count("minecraft:arrow", "minecraft:the_end"), 50);

await boot();
seedItems(40, "minecraft:the_end", "minecraft:arrow");
advance(400);
equal("a dimension below its limit is untouched", count("minecraft:arrow", "minecraft:the_end"), 40);
equal("no errors across dimensions", state.errors.length, 0);

// A dimension the engine refuses must not stop the rest of the sweep.
await boot();
seedItems(150);
state.failDimensions.add("minecraft:the_end");
advance(300);
equal("other dimensions are still trimmed", count("minecraft:item"), 100);
check("the failure is logged to the content log", warnings.some((line) => line.includes("minecraft:the_end")), warnings.join(" | "));
const warningCount = warnings.length;
advance(300);
equal("a repeated failure is only logged once", warnings.length, warningCount);

// An entity the engine refuses to remove is skipped, not fatal.
await boot();
seedItems(150);
for (let index = 0; index < 120; index++) state.removeThrows.add(`seed-minecraft:overworld-minecraft:item-${index}`);
advance(300);
equal("a refused removal does not block the sweep", state.removedIds.length, 30);
equal("a refused removal does not raise an error", state.errors.length, 0);
equal("a refused removal is logged once", warnings.filter((line) => line.includes("remove")).length, 1);

// Age records must not leak: reused ids are treated as brand new.
await boot();
seedItems(150);
for (const entity of [...state.dimensions.get("minecraft:overworld").entities]) despawn(entity);
advance(100); // sees an empty dimension and prunes the age cache
for (let index = 0; index < 150; index++) spawn("minecraft:item", "minecraft:overworld", { id: `seed-minecraft:overworld-minecraft:item-${index}` });
advance(100);
equal("recycled entity ids are treated as fresh drops", count("minecraft:item"), 150);
advance(300);
equal("trimming resumes once they age past the window", count("minecraft:item"), 100);

// Commands.
await boot();
seedItems(250);
const player = state.players[0];

fireScriptEvent("perfboost:status", player);
const status = messageFor("Tester0");
check("status answers the command source", [...state.messages].reverse().find((entry) => entry.to === "Tester0") !== undefined);
check("status reports the item count and limit", status.includes("items 250/100"), status);
check("status reports every dimension", ["Overworld", "Nether", "The End"].every((name) => status.includes(name)), status);
check("status shows the removal totals", status.includes("removed:"), status);
check("status reports the next pass", /next pass in \d+\.\ds/.test(status), status);
check("status explains that the excess is protected for now", status.includes("nothing removable yet"), status);

fireScriptEvent("perfboost:clean", player);
check("clean explains protected excess instead of claiming there is none", messageFor("Tester0").includes("nothing removed:"), messageFor("Tester0"));
equal("clean never removes fresh drops", count("minecraft:item"), 250);

// Isolate the manual path: stop the automatic sweeps, then age the drops.
state.intervals.length = 0;
advance(300);
fireScriptEvent("perfboost:clean", player);
const cleaned = messageFor("Tester0");
check("clean reports the per-type breakdown", cleaned.includes("removed") && cleaned.includes("items"), cleaned);
equal("clean trims straight down to the limit", count("minecraft:item"), 100);

fireScriptEvent("perfboost:clean", player);
check("clean says when there is nothing to do", messageFor("Tester0").includes("nothing to trim"), messageFor("Tester0"));

fireScriptEvent("perfboost:help", player);
const help = messageFor("Tester0");
check("help lists all three commands", ["perfboost:status", "perfboost:clean", "perfboost:help"].every((id) => help.includes(id)), help);
check("help documents the protection rules", help.includes("named entities"), help);

fireScriptEvent("perfboost:nope", player);
check("unknown commands get a hint", messageFor("Tester0").includes("unknown command"), messageFor("Tester0"));

const messagesBefore = state.messages.length;
fireScriptEvent("other_namespace:status", player);
equal("events outside the perfboost namespace are ignored", state.messages.length, messagesBefore);

fireScriptEvent("perfboost:status");
equal("commands from a command block broadcast to the world", lastMessage()?.to, "world");
check("status works without a command source", messageFor("world").includes("Overworld"));

equal("no unexpected errors during the command tests", state.errors.length, 0);

/* ----------------------------------------------------------------- report */

console.warn = originalWarn;
rmSync(WORK, { recursive: true, force: true });

console.log(`PerfBoost tests: ${assertions - failures.length}/${assertions} assertions passed`);
if (failures.length > 0) {
  console.error(`\n${failures.length} failing assertion(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("All behaviour tests passed.");
