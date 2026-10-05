import { system, world } from "@minecraft/server";

/**
 * PerfBoost v0.1.0 - behaviour pack entry point.
 *
 * Once per sweep period the cleaner counts dropped items, XP orbs and arrows in
 * every dimension and removes the OLDEST excess entities first, so a fresh drop
 * is always the last thing to go.
 *
 * Never removed:
 *   - players and every entity type that is not tracked below
 *   - entities with a name tag
 *   - anything the cleaner has seen for less than the protection window
 *
 * In-game commands (also work from command blocks and the server console):
 *   /scriptevent perfboost:status
 *   /scriptevent perfboost:clean
 *   /scriptevent perfboost:help
 */

/* --------------------------------------------------------------- settings */

const VERSION = "0.1.0";
const TAG = "§a[PerfBoost v" + VERSION + "]§r";

const CONFIG = {
  /** Automatic sweep period in ticks (100 ticks = 5 seconds). */
  intervalTicks: 100,
  /** Entities younger than this are protected (200 ticks = 10 seconds). */
  minAgeTicks: 200,
  /** Maximum removals a single automatic sweep may perform. */
  removePerSweep: 60,
  /**
   * Hard cap on retained age records. Only reached if pruning fails, in which
   * case the cache is reset and every entity is re-seeded as freshly seen.
   */
  maxTracked: 20000,
  /** Per-dimension soft limits, evaluated in this order. */
  limits: [
    { typeId: "minecraft:item", label: "items", max: 100 },
    { typeId: "minecraft:xp_orb", label: "XP orbs", max: 75 },
    { typeId: "minecraft:arrow", label: "arrows", max: 50 },
  ],
  /** Dimensions that are swept; unavailable ones are skipped silently. */
  dimensions: ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"],
};

/* ------------------------------------------------------------------ state */

/** Entity id -> tick the cleaner first saw that entity. */
const firstSeen = new Map();
/** Entity ids observed during the current sweep, used to prune `firstSeen`. */
const liveIds = new Set();
/** Failures that were already written to the content log, keyed by context. */
const warned = new Set();

/** Removals still allowed in the sweep that is currently running. */
let sweepBudget = 0;
/** Lifetime removal count for this world session. */
let removedTotal = 0;
/** Removals performed by the most recent automatic sweep. */
let removedLastSweep = 0;
/** Tick of the next automatic sweep. */
let nextSweepTick = 0;
/** True while automatic sweeps are skipped because nobody is online. */
let paused = false;

/* ---------------------------------------------------------------- helpers */

/** Writes an engine failure to the content log once per context. */
function warnOnce(context, error) {
  if (warned.has(context)) return;
  warned.add(context);
  console.warn("[PerfBoost] " + context + ": " + error);
}

/** Number of players online; assumes 1 when the engine cannot answer. */
function onlinePlayers() {
  try {
    return world.getAllPlayers().length;
  } catch (error) {
    warnOnce("getAllPlayers", error);
    return 1;
  }
}

/** Every configured dimension that this engine build can hand out. */
function dimensions() {
  const list = [];
  for (const id of CONFIG.dimensions) {
    try {
      list.push(world.getDimension(id));
    } catch (error) {
      warnOnce("dimension " + id, error);
    }
  }
  return list;
}

/** "minecraft:overworld" -> "Overworld". */
function shortName(dimension) {
  let id;
  try {
    id = String(dimension.id);
  } catch (error) {
    return "Unknown";
  }
  const separator = id.indexOf(":");
  const name = separator >= 0 ? id.slice(separator + 1) : id;
  if (name === "overworld") return "Overworld";
  if (name === "nether") return "Nether";
  if (name === "the_end") return "The End";
  return name;
}

/* ------------------------------------------------------------------- scan */

/**
 * Counts one dimension/type pair and collects the entities that may be removed.
 * Returns undefined when the engine rejects the query (unknown type or
 * dimension), which keeps the sweep going in every other dimension.
 */
function readRow(dimension, limit, tick) {
  let entities;
  try {
    entities = dimension.getEntities({ type: limit.typeId });
  } catch (error) {
    warnOnce("getEntities " + limit.typeId, error);
    return undefined;
  }

  const eligible = [];
  for (const entity of entities) {
    let id;
    try {
      id = entity.id;
    } catch (error) {
      continue;
    }
    liveIds.add(id);

    let first = firstSeen.get(id);
    if (first === undefined) {
      // First sighting: seed the clock, never remove in the same sweep.
      firstSeen.set(id, tick);
      continue;
    }
    if (tick - first < CONFIG.minAgeTicks) continue;
    if (!entity.isValid) continue;
    try {
      if (entity.nameTag) continue;
    } catch (error) {
      continue;
    }
    eligible.push({ entity: entity, id: id, first: first });
  }

  return {
    label: limit.label,
    max: limit.max,
    total: entities.length,
    // `excess` is what has to go; `removable` is how much may go right now.
    excess: Math.max(0, entities.length - limit.max),
    removable: Math.max(0, Math.min(entities.length - limit.max, eligible.length)),
    eligible: eligible,
  };
}

/** Drops age records for entities that no longer exist. */
function pruneFirstSeen() {
  for (const id of firstSeen.keys()) {
    if (!liveIds.has(id)) firstSeen.delete(id);
  }
  if (firstSeen.size > CONFIG.maxTracked) {
    warnOnce("age cache", "over " + CONFIG.maxTracked + " records; resetting");
    firstSeen.clear();
  }
}

/** Reads every tracked type in every dimension. Returns per-dimension groups. */
function scanWorld() {
  const tick = system.currentTick;
  liveIds.clear();

  const groups = [];
  for (const dimension of dimensions()) {
    const group = { name: shortName(dimension), rows: [] };
    for (const limit of CONFIG.limits) {
      const row = readRow(dimension, limit, tick);
      if (row) group.rows.push(row);
    }
    if (group.rows.length > 0) groups.push(group);
  }

  pruneFirstSeen();
  return groups;
}

/* ------------------------------------------------------------------ clean */

/**
 * Removes entities above each limit, oldest first, until the budget runs out.
 * Returns the removal count plus a per-type breakdown for user feedback.
 */
function cleanGroups(groups, budget) {
  sweepBudget = budget;
  const breakdown = [];
  let removed = 0;
  let deferred = 0;

  for (const group of groups) {
    for (const row of group.rows) {
      let needed = row.total - row.max;
      if (needed <= 0 || sweepBudget <= 0) continue;

      row.eligible.sort(function (a, b) {
        return a.first - b.first;
      });

      let count = 0;
      for (const candidate of row.eligible) {
        if (needed <= 0 || sweepBudget <= 0) break;
        if (!candidate.entity.isValid) continue;
        try {
          candidate.entity.remove();
        } catch (error) {
          // Protected or already despawned; skip it and keep the target count.
          warnOnce("remove " + row.label, error);
          continue;
        }
        firstSeen.delete(candidate.id);
        count++;
        removed++;
        needed--;
        sweepBudget--;
      }

      // Excess that stayed behind because no candidate was eligible for removal
      // (still inside the protection window, named, or refused by the engine).
      if (needed > 0 && sweepBudget > 0) deferred += needed;
      if (count > 0) breakdown.push({ label: row.label, count: count });
    }
  }

  return { removed: removed, deferred: deferred, breakdown: breakdown };
}

/** One automatic pass: scan, trim within budget, refresh the schedule. */
function autoSweep() {
  const result = cleanGroups(scanWorld(), CONFIG.removePerSweep);
  removedTotal += result.removed;
  removedLastSweep = result.removed;
}

/* ----------------------------------------------------------------- output */

function breakdownText(breakdown) {
  const parts = [];
  for (const entry of breakdown) parts.push(entry.count + " " + entry.label);
  return parts.join(", ");
}

function statusMessage() {
  const groups = scanWorld();
  const lines = [TAG + " §7status"];
  let above = 0;
  let excess = 0;
  let removable = 0;

  for (const group of groups) {
    const parts = [];
    for (const row of group.rows) {
      if (row.total > row.max) {
        above++;
        excess += row.excess;
        removable += row.removable;
      }
      parts.push(
        row.total > row.max
          ? "§c" + row.label + " " + row.total + "/" + row.max + "§r"
          : row.label + " " + row.total + "/" + row.max
      );
    }
    lines.push("§7" + group.name + ":§r " + parts.join(", "));
  }

  if (groups.length === 0) lines.push("§7no dimensions available§r");

  let footer = "§7removed:§r " + removedTotal + " §7(last pass:§r " + removedLastSweep + "§7)§r";
  if (paused) {
    footer += " §7· paused, no players online§r";
  } else {
    const inTicks = Math.max(0, nextSweepTick - system.currentTick);
    footer += " §7· next pass in §r" + (inTicks / 20).toFixed(1) + "s";
  }
  lines.push(footer);

  if (above > 0) {
    lines.push(
      removable > 0
        ? "§e" + above + " pair(s) above the limit: §f" + removable + "§e of §f" + excess + "§e excess entities can go now.§r"
        : "§e" + above + " pair(s) above the limit: nothing removable yet (protected: named or younger than " + CONFIG.minAgeTicks / 20 + "s).§r"
    );
  }
  return lines.join("\n");
}

function cleanMessage() {
  const result = cleanGroups(scanWorld(), Number.MAX_SAFE_INTEGER);
  removedTotal += result.removed;

  const protectedNote = "protected (named or younger than " + CONFIG.minAgeTicks / 20 + "s)";

  if (result.removed === 0) {
    if (result.deferred > 0) {
      return TAG + " nothing removed: §f" + result.deferred + "§r excess entities are " + protectedNote + ".";
    }
    return TAG + " nothing to trim, every tracked type is within its limit.";
  }
  const left = result.deferred > 0 ? " §7" + result.deferred + " more are " + protectedNote + ".§r" : "";
  return TAG + " removed §f" + result.removed + "§r entities (" + breakdownText(result.breakdown) + ")." + left;
}

function helpMessage() {
  return [
    TAG + " §7commands",
    "§f/scriptevent perfboost:status§r - live counts and limits",
    "§f/scriptevent perfboost:clean§r - trim every dimension now",
    "§f/scriptevent perfboost:help§r - show this list",
    "§7Running automatically every " +
      CONFIG.intervalTicks / 20 +
      "s; entities fresher than " +
      CONFIG.minAgeTicks / 20 +
      "s and named entities are never removed.§r",
  ].join("\n");
}

/** Answers the command source, or broadcasts when a block/console ran it. */
function reply(target, text) {
  try {
    if (target && typeof target.sendMessage === "function") {
      target.sendMessage(text);
      return;
    }
    world.sendMessage(text);
  } catch (error) {
    warnOnce("reply", error);
  }
}

function onScriptEvent(event) {
  let id = "";
  try {
    if (typeof event.id === "string") id = event.id.toLowerCase();
  } catch (error) {
    return;
  }
  // The subscription already filters by namespace; this guard keeps the handler
  // correct on engines that cannot take the filter option.
  if (id.indexOf("perfboost:") !== 0) return;

  const target = event.sourceEntity;
  try {
    if (id === "perfboost:status") {
      reply(target, statusMessage());
    } else if (id === "perfboost:clean") {
      reply(target, cleanMessage());
    } else if (id === "perfboost:help") {
      reply(target, helpMessage());
    } else {
      reply(target, TAG + " §eunknown command §f" + id + "§e. Try §f/scriptevent perfboost:help§e.");
    }
  } catch (error) {
    warnOnce("command " + id, error);
    reply(target, TAG + " §cthat command failed - see the content log for details.");
  }
}

/* ---------------------------------------------------------------- startup */

/**
 * Subscribes to /scriptevent commands. The namespace filter keeps unrelated
 * add-on traffic out of this handler; engines that reject the option still get
 * a plain subscription, with the guard inside the handler doing the filtering.
 */
function subscribeToCommands() {
  try {
    system.afterEvents.scriptEventReceive.subscribe(onScriptEvent, { namespaces: ["perfboost"] });
    return;
  } catch (error) {
    warnOnce("script event filter", error);
  }
  try {
    system.afterEvents.scriptEventReceive.subscribe(onScriptEvent);
  } catch (error) {
    warnOnce("script event subscription", error);
  }
}

subscribeToCommands();

system.runInterval(function () {
  try {
    nextSweepTick = system.currentTick + CONFIG.intervalTicks;
    // Unloaded worlds cost nothing to keep clean, so skip the sweep entirely.
    paused = onlinePlayers() === 0;
    if (paused) return;
    autoSweep();
  } catch (error) {
    warnOnce("automatic sweep", error);
  }
}, CONFIG.intervalTicks);
