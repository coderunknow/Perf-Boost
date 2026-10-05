/**
 * Minimal, controllable stand-in for the Minecraft "@minecraft/server" module.
 *
 * tools/test.mjs copies this file into a temporary node_modules folder and then
 * imports the real PerfBoost_BP/scripts/main.js, so the shipped script is the
 * one under test - no reimplementation of the cleaner in the test.
 */

export const state = {
  tick: 0,
  players: [],
  dimensions: new Map(),
  intervals: [],
  subscribers: [],
  messages: [],
  errors: [],
  removedIds: [],
  failDimensions: new Set(),
  failTypes: new Set(),
  removeThrows: new Set(),
  rejectSubscribeOptions: false,
  nextId: 0,
  calls: { getEntities: 0, remove: 0, getDimension: 0 },

  reset() {
    this.tick = 0;
    this.players = [];
    this.dimensions = new Map();
    this.intervals = [];
    this.subscribers = [];
    this.messages = [];
    this.errors = [];
    this.removedIds = [];
    this.failDimensions = new Set();
    this.failTypes = new Set();
    this.removeThrows = new Set();
    this.rejectSubscribeOptions = false;
    this.nextId = 0;
    this.calls = { getEntities: 0, remove: 0, getDimension: 0 };
    for (const id of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
      this.dimensions.set(id, { id, entities: [] });
    }
  },
};

state.reset();

/** Adds a player, so automatic sweeps stop being skipped. */
export function addPlayer(name = "Tester") {
  const player = {
    typeId: "minecraft:player",
    name,
    isValid: true,
    sendMessage(text) {
      state.messages.push({ to: name, text: String(text) });
    },
  };
  state.players.push(player);
  return player;
}

/** Spawns an entity into a dimension and returns it. */
export function spawn(typeId, dimensionId = "minecraft:overworld", options = {}) {
  const dimension = state.dimensions.get(dimensionId);
  if (!dimension) throw new Error("unknown dimension " + dimensionId);
  const entity = {
    id: options.id ?? `${typeId.replace(/[^a-z_]/g, "")}-${state.nextId++}`,
    typeId: typeId,
    dimensionId: dimensionId,
    nameTag: options.nameTag ?? "",
    isValid: true,
    remove() {
      state.calls.remove++;
      if (state.removeThrows.has(this.id)) throw new Error("engine refused removal of " + this.id);
      this.isValid = false;
      state.removedIds.push(this.id);
      despawn(this);
    },
  };
  dimension.entities.push(entity);
  return entity;
}

/** Removes an entity from the world without going through Entity.remove(). */
export function despawn(entity) {
  const dimension = state.dimensions.get(entity.dimensionId);
  if (!dimension) return;
  const index = dimension.entities.indexOf(entity);
  if (index >= 0) dimension.entities.splice(index, 1);
  entity.isValid = false;
}

/** Entities currently inside a dimension, optionally filtered by type. */
export function count(typeId, dimensionId = "minecraft:overworld") {
  return state.dimensions.get(dimensionId).entities.filter((entity) => entity.typeId === typeId).length;
}

export function entityIds(typeId, dimensionId = "minecraft:overworld") {
  return state.dimensions.get(dimensionId).entities.filter((entity) => entity.typeId === typeId).map((entity) => entity.id);
}

/** Runs the interval callbacks for the given number of ticks. */
export function advance(ticks) {
  for (let step = 0; step < ticks; step++) {
    state.tick++;
    for (const interval of state.intervals) {
      if (interval.next <= state.tick) {
        interval.next += interval.period;
        try {
          interval.callback();
        } catch (error) {
          state.errors.push(error);
        }
      }
    }
  }
}

/** Fires a /scriptevent command, honouring the namespaces filter. */
export function fireScriptEvent(id, sourceEntity) {
  const namespace = String(id).split(":")[0];
  for (const subscriber of state.subscribers) {
    if (subscriber.namespaces && !subscriber.namespaces.includes(namespace)) continue;
    try {
      subscriber.callback({ id, message: "", sourceEntity, sourceType: sourceEntity ? "Entity" : "Server" });
    } catch (error) {
      state.errors.push(error);
    }
  }
}

export function lastMessage() {
  return state.messages.length > 0 ? state.messages[state.messages.length - 1] : undefined;
}

export const system = {
  get currentTick() {
    return state.tick;
  },
  runInterval(callback, ticks) {
    const period = Math.max(1, Math.floor(ticks));
    state.intervals.push({ callback, period, next: state.tick + period });
    return state.intervals.length;
  },
  run(callback) {
    state.intervals.push({ callback, period: 1, next: state.tick + 1 });
    return state.intervals.length;
  },
  clearRun() {},
  afterEvents: {
    scriptEventReceive: {
      subscribe(callback, options) {
        if (options && state.rejectSubscribeOptions) throw new Error("the engine rejected the filter options");
        state.subscribers.push({ callback, namespaces: options?.namespaces });
        return { unsubscribe() {} };
      },
    },
  },
};

export const world = {
  getAllPlayers() {
    return [...state.players];
  },
  getDimension(id) {
    state.calls.getDimension++;
    if (state.failDimensions.has(id)) throw new Error("dimension unavailable: " + id);
    const dimension = state.dimensions.get(id);
    if (!dimension) throw new Error("unknown dimension " + id);
    return {
      id: dimension.id,
      getEntities(query) {
        state.calls.getEntities++;
        if (state.failTypes.has(query?.type)) throw new Error("unsupported entity type " + query.type);
        return dimension.entities.filter((entity) => entity.typeId === query?.type);
      },
    };
  },
  sendMessage(text) {
    state.messages.push({ to: "world", text: String(text) });
  },
};

export const EntityComponentTypes = {
  Arrow: "minecraft:arrow",
  Item: "minecraft:item",
};

export default { system, world, EntityComponentTypes };
