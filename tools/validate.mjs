/**
 * PerfBoost validator.
 *
 * Checks the pack sources for the mistakes that are easy to make and hard to
 * spot in-game: broken JSON, particle overrides that target identifiers the
 * vanilla resource pack does not define, textures that are not actually
 * transparent, malformed manifests and stale build output.
 *
 * Usage: node tools/validate.mjs [--dist]
 */

import { inflateRawSync, inflateSync } from "node:zlib";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BP = join(ROOT, "PerfBoost_BP");
const RP = join(ROOT, "PerfBoost_RP");
const VERSION = [0, 1, 0];
const VERSION_TEXT = VERSION.join(".");

const failures = [];
const warnings = [];
let checks = 0;

function expect(label, condition, detail = "") {
  checks++;
  if (!condition) failures.push(detail ? `${label}: ${detail}` : label);
  return !!condition;
}

function warn(label) {
  warnings.push(label);
}

function readJson(path) {
  const raw = readFileSync(path);
  expect(`${path} must not start with a UTF-8 BOM`, raw[0] !== 0xef || raw[1] !== 0xbb || raw[2] !== 0xbf);
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch (error) {
    failures.push(`${path}: invalid JSON (${error.message})`);
    return null;
  }
}

/* ------------------------------------------------------- vanilla particles */

/**
 * Identifiers defined by the vanilla resource pack.
 * Source: Bedrock-OSS/bedrock-wiki "Vanilla Particles" (working, issue-prone,
 * bubble and permanent particles). Overriding anything outside this list has
 * no effect in game, which is the exact bug class this check exists for.
 */
const VANILLA_PARTICLES = new Set(
  (
    // Working particles
    "minecraft:basic_flame_particle minecraft:basic_portal_particle minecraft:basic_smoke_particle minecraft:bleach " +
    "minecraft:blue_flame_particle minecraft:camera_shoot_explosion minecraft:campfire_smoke_particle " +
    "minecraft:campfire_tall_smoke_particle minecraft:candle_flame_particle minecraft:critical_hit_emitter " +
    "minecraft:crop_growth_emitter minecraft:dragon_breath_trail minecraft:dragon_death_explosion_emitter " +
    "minecraft:dragon_destroy_block minecraft:dragon_dying_explosion minecraft:endrod minecraft:end_chest " +
    "minecraft:evocation_fang_particle minecraft:evoker_spell minecraft:cauldron_explosion_emitter " +
    "minecraft:egg_destroy_emitter minecraft:falling_border_dust_particle minecraft:falling_dust_dragon_egg_particle " +
    "minecraft:falling_dust_gravel_particle minecraft:falling_dust_red_sand_particle " +
    "minecraft:falling_dust_sand_particle minecraft:falling_dust_scaffolding_particle " +
    "minecraft:falling_dust_top_snow_particle minecraft:heart_particle minecraft:honey_drip_particle " +
    "minecraft:huge_explosion_lab_misc_emitter minecraft:huge_explosion_emitter minecraft:ice_evaporation_emitter " +
    "minecraft:knockback_roar_particle minecraft:lab_table_misc_mystical_particle minecraft:large_explosion " +
    "minecraft:lava_drip_particle minecraft:lava_particle minecraft:llama_spit_smoke " +
    "minecraft:magnesium_salts_emitter minecraft:mob_portal minecraft:mycelium_dust_particle " +
    "minecraft:obsidian_glow_dust_particle minecraft:obsidian_tear_particle minecraft:redstone_ore_dust_particle " +
    "minecraft:redstone_repeater_dust_particle minecraft:redstone_torch_dust_particle " +
    "minecraft:redstone_wire_dust_particle minecraft:rising_border_dust_particle " +
    "minecraft:sculk_sensor_redstone_particle minecraft:snowflake_particle minecraft:spore_blossom_ambient_particle " +
    "minecraft:spore_blossom_shower_particle minecraft:stalactite_lava_drip_particle " +
    "minecraft:stalactite_water_drip_particle minecraft:totem_particle minecraft:villager_angry " +
    "minecraft:villager_happy minecraft:water_drip_particle minecraft:water_evaporation_bucket_emitter " +
    "minecraft:water_splash_particle_manual " +
    // Issue-prone particles (still real identifiers)
    "minecraft:arrow_spell_emitter minecraft:balloon_gas_particle minecraft:basic_crit_particle " +
    "minecraft:conduit_absorb_particle minecraft:conduit_attack_emitter minecraft:dragon_breath_fire " +
    "minecraft:dragon_breath_lingering minecraft:electric_spark_particle minecraft:enchanting_table_particle " +
    "minecraft:elephant_tooth_paste_vapor_particle minecraft:death_explosion_emitter " +
    "minecraft:eyeofender_death_explode_particle minecraft:explosion_particle " +
    "minecraft:falling_dust_concrete_powder_particle minecraft:lab_table_heatblock_dust_particle " +
    "minecraft:misc_fire_vapor_particle minecraft:mobspell_emitter minecraft:mob_block_spawn_emitter " +
    "minecraft:note_particle minecraft:portal_directional minecraft:portal_reverse_particle " +
    "minecraft:rain_splash_particle minecraft:shulker_bullet minecraft:silverfish_grief_emitter " +
    "minecraft:soul_particle minecraft:sparkler_emitter minecraft:splash_spell_emitter " +
    "minecraft:water_evaporation_actor_emitter minecraft:water_splash_particle minecraft:water_wake_particle " +
    "minecraft:wax_particle minecraft:wither_boss_invulnerable " +
    // Bubble particles
    "minecraft:basic_bubble_particle minecraft:basic_bubble_particle_manual minecraft:bubble_column_bubble " +
    "minecraft:bubble_column_down_particle minecraft:bubble_column_up_particle minecraft:cauldron_bubble_particle " +
    "minecraft:cauldron_splash_particle minecraft:dolphin_move_particle minecraft:eye_of_ender_bubble_particle " +
    "minecraft:fish_hook_particle minecraft:fish_pos_particle minecraft:glow_particle " +
    "minecraft:guardian_attack_particle minecraft:guardian_water_move_particle " +
    "minecraft:sponge_absorb_water_particle minecraft:squid_flee_particle minecraft:squid_ink_bubble " +
    "minecraft:squid_move_particle minecraft:underwater_torch_particle " +
    // Permanent particles
    "minecraft:mobflame_emitter minecraft:nectar_drip_particle minecraft:phantom_trail_particle " +
    "minecraft:stunned_emitter"
  ).split(/\s+/),
);

/* --------------------------------------------------------- png verification */

/** Minimal decoder for non-interlaced 8-bit PNGs (enough for this pack). */
function decodePng(buffer) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (buffer.length < 8 || signature.some((byte, index) => buffer[index] !== byte)) {
    throw new Error("not a PNG file");
  }
  let offset = 8;
  let header = null;
  const data = [];
  let palette = null;
  let transparency = null;

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        depth: body[8],
        color: body[9],
        interlace: body[12],
      };
    } else if (type === "PLTE") {
      palette = body;
    } else if (type === "tRNS") {
      transparency = body;
    } else if (type === "IDAT") {
      data.push(body);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }

  if (!header) throw new Error("missing IHDR");
  if (header.depth !== 8) throw new Error(`unsupported bit depth ${header.depth}`);
  if (header.interlace !== 0) throw new Error("interlaced PNGs are not supported");

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.color];
  if (!channels) throw new Error(`unsupported colour type ${header.color}`);

  const raw = inflateSync(Buffer.concat(data));
  const stride = header.width * channels;
  const pixels = Buffer.alloc(header.height * stride);
  let cursor = 0;

  for (let y = 0; y < header.height; y++) {
    const filter = raw[cursor++];
    const line = raw.subarray(cursor, cursor + stride);
    cursor += stride;
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const previous = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[x - channels] : 0;
      const b = previous[x];
      const c = x >= channels ? previous[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`unknown filter ${filter}`);
      out[x] = value & 0xff;
    }
  }

  return {
    width: header.width,
    height: header.height,
    channels,
    color: header.color,
    palette,
    transparency,
    pixels,
    /** Alpha of one pixel, 0-255. */
    alpha(x, y) {
      const index = y * stride + x * channels;
      if (header.color === 6) return pixels[index + 3];
      if (header.color === 4) return pixels[index + 1];
      if (header.color === 3 && transparency) return transparency[pixels[index]] ?? 255;
      return 255;
    },
  };
}

/* ------------------------------------------------------------- pack checks */

/** Files directly below `directory`, recursively, as POSIX paths. */
function listFiles(directory, prefix = "") {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolute = join(directory, entry.name);
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...listFiles(absolute, name));
    else if (entry.isFile()) files.push(name);
  }
  return files;
}

function validateManifest(path, pack, role) {
  const manifest = readJson(path);
  if (!manifest) return null;

  expect(`${pack}/manifest.json has format_version 2`, manifest.format_version === 2, String(manifest.format_version));
  const header = manifest.header ?? {};
  expect(`${pack} header.version is ${VERSION_TEXT}`, JSON.stringify(header.version) === JSON.stringify(VERSION), JSON.stringify(header.version));
  expect(`${pack} header.name mentions v${VERSION_TEXT}`, typeof header.name === "string" && header.name.includes(VERSION_TEXT));
  expect(`${pack} header.description is set`, typeof header.description === "string" && header.description.length > 0);
  expect(`${pack} header.uuid is a UUID`, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(header.uuid ?? ""));
  expect(
    `${pack} min_engine_version is at least 1.21.90`,
    Array.isArray(header.min_engine_version) && header.min_engine_version[0] === 1 && header.min_engine_version[1] >= 21,
    JSON.stringify(header.min_engine_version),
  );

  const modules = manifest.modules ?? [];
  const uuids = new Set([header.uuid, ...modules.map((module) => module.uuid)]);
  expect(`${pack} has no duplicate module UUIDs`, uuids.size === modules.length + 1);

  if (role === "behavior") {
    const script = modules.find((module) => module.type === "script");
    expect("behavior pack declares a script module", !!script);
    if (script) {
      expect("script module uses javascript", script.language === "javascript");
      expect("script entry file exists", statSync(join(BP, script.entry), { throwIfNoEntry: false })?.isFile() === true, script.entry);
    }
    expect("behavior pack declares a data module", modules.some((module) => module.type === "data"));
    const dependency = (manifest.dependencies ?? []).find((entry) => entry.module_name === "@minecraft/server");
    expect("behavior pack depends on @minecraft/server", !!dependency);
    expect("behavior pack targets @minecraft/server 2.0.0", dependency?.version === "2.0.0", String(dependency?.version));
  } else {
    expect("resource pack declares a resources module", modules.some((module) => module.type === "resources"));
  }

  return manifest;
}

function validateScript() {
  const path = join(BP, "scripts/main.js");
  const source = readFileSync(path, "utf8");
  expect("scripts/main.js is not empty", source.trim().length > 0);
  expect("scripts/main.js has no CRLF line endings", !source.includes("\r\n"));
  expect("scripts/main.js uses the version 0.1.0", source.includes('VERSION = "0.1.0"'));
  expect("scripts/main.js imports @minecraft/server", /from\s+"@minecraft\/server"/.test(source));
  expect("scripts/main.js does not use the removed Entity.isValid() method", !/\.isValid\s*\(\s*\)/.test(source));
  expect("scripts/main.js keeps the three documented script events", ["perfboost:status", "perfboost:clean", "perfboost:help"].every((id) => source.includes(id)));
  expect("scripts/main.js never removes players", !/typeId\s*===?\s*"minecraft:player"/.test(source));
  return source;
}

function validateParticles() {
  const directory = join(RP, "particles");
  const files = listFiles(directory).filter((name) => name.endsWith(".json"));
  expect("resource pack ships particle overrides", files.length > 0);

  const identifiers = new Set();
  for (const name of files) {
    const path = join(directory, name);
    const json = readJson(path);
    if (!json) continue;

    const identifier = json.particle_effect?.description?.identifier;
    const base = name.replace(/\.json$/, "");
    if (!expect(`${name} declares an identifier`, typeof identifier === "string")) continue;
    expect(`${name} identifier matches the file name`, identifier === `minecraft:${base}`, `got ${identifier}`);
    expect(`${name} targets a vanilla particle`, VANILLA_PARTICLES.has(identifier), `${identifier} is not a vanilla particle identifier`);
    expect(`${name} is not a duplicate override`, !identifiers.has(identifier), identifier);
    identifiers.add(identifier);

    const components = json.particle_effect?.components ?? {};
    const instant = components["minecraft:emitter_rate_instant"];
    const lifetime = components["minecraft:particle_lifetime_expression"];
    const billboard = components["minecraft:particle_appearance_billboard"];
    const emitter = components["minecraft:emitter_lifetime_once"];
    expect(`${name} emits a single particle`, instant?.num_particles <= 1, String(instant?.num_particles));
    expect(`${name} keeps the emitter alive for at most 0.05s`, emitter?.active_time <= 0.05, String(emitter?.active_time));
    expect(`${name} keeps particles alive for at most 0.05s`, lifetime?.max_lifetime <= 0.05, String(lifetime?.max_lifetime));
    expect(
      `${name} shrinks the particle to at most 0.01 blocks`,
      Array.isArray(billboard?.size) && billboard.size.every((value) => value <= 0.01),
      JSON.stringify(billboard?.size),
    );
    expect(`${name} renders with an alpha material`, json.particle_effect?.description?.basic_render_parameters?.material === "particles_alpha");
  }

  const expected = ["minecraft:rain_splash_particle", "minecraft:basic_smoke_particle", "minecraft:campfire_smoke_particle"];
  for (const identifier of expected) {
    expect(`particle overrides include ${identifier}`, identifiers.has(identifier));
  }
  return identifiers;
}

function validateTextures() {
  const textures = [
    { path: join(RP, "textures/environment/rain.png"), width: 16, height: 16, transparent: true },
    { path: join(RP, "textures/environment/snow.png"), width: 16, height: 16, transparent: true },
    { path: join(BP, "pack_icon.png"), width: 256, height: 256, transparent: false },
    { path: join(RP, "pack_icon.png"), width: 256, height: 256, transparent: false },
  ];

  for (const texture of textures) {
    const name = texture.path.replace(ROOT + "/", "");
    let png;
    try {
      png = decodePng(readFileSync(texture.path));
    } catch (error) {
      failures.push(`${name}: cannot be decoded (${error.message})`);
      continue;
    }
    checks++;
    expect(`${name} is ${texture.width}x${texture.height}`, png.width === texture.width && png.height === texture.height, `${png.width}x${png.height}`);

    if (texture.transparent) {
      let opaque = 0;
      for (let y = 0; y < png.height; y++) {
        for (let x = 0; x < png.width; x++) if (png.alpha(x, y) !== 0) opaque++;
      }
      expect(`${name} is fully transparent`, opaque === 0, `${opaque} opaque pixels would hide the world behind them`);
    }
  }

  const icons = [readFileSync(join(BP, "pack_icon.png")), readFileSync(join(RP, "pack_icon.png"))];
  expect("both packs ship the same icon", icons[0].equals(icons[1]));
}

function validatePackLayout() {
  const allowed = new Set(["manifest.json", "pack_icon.png", "scripts", "particles", "textures"]);
  for (const pack of [BP, RP]) {
    for (const entry of readdirSync(pack)) {
      expect(`${pack}/${entry} is a known pack entry`, allowed.has(entry), "unexpected file or folder");
    }
  }
  for (const pack of [BP, RP]) {
    for (const name of listFiles(pack)) {
      expect(`${pack}/${name} uses a safe file name`, /^[A-Za-z0-9._/-]+$/.test(name) && !name.includes(" "), "avoid spaces and special characters");
    }
  }
}

/* ---------------------------------------------------------------- artifact */

/** Reads a ZIP archive into a map of name -> Buffer. */
function readZip(buffer) {
  const entries = new Map();
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error("end of central directory not found");

  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  for (let index = 0; index < count; index++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("bad central directory entry");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = buffer.subarray(dataStart, dataStart + compressedSize);
    entries.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function validateArtifact() {
  const directory = join(ROOT, "dist");
  const stat = statSync(directory, { throwIfNoEntry: false });
  const artifacts = stat?.isDirectory() ? readdirSync(directory).filter((name) => name.endsWith(".mcaddon")) : [];
  if (artifacts.length === 0) {
    warn("dist/ has no .mcaddon yet - run `npm run build`");
    return;
  }
  expect("dist/ contains exactly one .mcaddon", artifacts.length === 1, artifacts.join(", "));
  const name = `PerfBoost_v${VERSION_TEXT}.mcaddon`;
  if (!artifacts.includes(name)) {
    failures.push(`dist/: expected ${name}, found ${artifacts.join(", ")}`);
    return;
  }

  let entries;
  try {
    entries = readZip(readFileSync(join(directory, name)));
  } catch (error) {
    failures.push(`${name}: cannot be read as a ZIP (${error.message})`);
    return;
  }

  const expected = new Map();
  for (const pack of ["PerfBoost_BP", "PerfBoost_RP"]) {
    for (const file of listFiles(join(ROOT, pack))) {
      expected.set(`${pack}/${file}`, readFileSync(join(ROOT, pack, file)));
    }
  }

  expect(`${name} contains every source file`, [...expected.keys()].every((key) => entries.has(key)));
  expect(`${name} contains nothing else`, [...entries.keys()].every((key) => expected.has(key)));
  for (const [key, bytes] of expected) {
    const packed = entries.get(key);
    expect(`${name} :: ${key} matches the source byte for byte`, packed?.equals(bytes), packed ? "content differs" : "missing");
  }

  const manifest = JSON.parse(entries.get("PerfBoost_BP/manifest.json").toString("utf8"));
  expect(`${name} declares version ${VERSION_TEXT}`, JSON.stringify(manifest.header.version) === JSON.stringify(VERSION));
}

/* ------------------------------------------------------------------- main */

const bpManifest = validateManifest(join(BP, "manifest.json"), "PerfBoost_BP", "behavior");
const rpManifest = validateManifest(join(RP, "manifest.json"), "PerfBoost_RP", "resource");
if (bpManifest && rpManifest) {
  expect("the packs use different UUIDs", bpManifest.header.uuid !== rpManifest.header.uuid);
}
const script = validateScript();
const particles = validateParticles();
validateTextures();
validatePackLayout();

if (process.argv.includes("--dist") || statSync(join(ROOT, "dist"), { throwIfNoEntry: false })) {
  validateArtifact();
}

/* Report */

console.log(`PerfBoost v${VERSION_TEXT} validation`);
console.log(`  pack files ......... BP ${listFiles(BP).length}, RP ${listFiles(RP).length}`);
console.log(`  particle overrides . ${particles.size}`);
console.log(`  script ............. ${(script.length / 1024).toFixed(1)} KiB`);
console.log(`  checks ............. ${checks} (${checks - failures.length} passed)`);

for (const message of warnings) console.log(`  warning: ${message}`);

if (failures.length > 0) {
  console.error(`\n${failures.length} problem(s):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log("  result ............. OK");
