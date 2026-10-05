/**
 * PerfBoost build script.
 *
 * Packages PerfBoost_BP and PerfBoost_RP into a single .mcaddon (a plain ZIP
 * with one folder per pack). The archive is deterministic: entries are sorted,
 * timestamps are fixed and PNGs are stored uncompressed, so building the same
 * sources twice produces byte-identical output.
 *
 * Usage: node tools/build.mjs [--out <file>]
 */

import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKS = ["PerfBoost_BP", "PerfBoost_RP"];
const VERSION = JSON.parse(readFileSync(join(ROOT, "PerfBoost_BP/manifest.json"), "utf8")).header.version.join(".");
const DEFAULT_OUT = join(ROOT, "dist", `PerfBoost_v${VERSION}.mcaddon`);

/* --------------------------------------------------------- zip primitives */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

/** Collects every file below `directory`, as POSIX-style relative paths. */
function walk(directory, prefix = "") {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = join(directory, entry.name);
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walk(absolute, name));
    else if (entry.isFile()) files.push({ name, absolute });
  }
  return files;
}

/** Builds a ZIP archive from `{ name, data }` entries. */
function zip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  // Fixed timestamp: 1980-01-01 00:00:00, the minimum a ZIP can express.
  const dosTime = 0;
  const dosDate = (0 << 9) | (1 << 5) | 1;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const stored = entry.name.endsWith(".png");
    const raw = entry.data;
    const body = stored ? raw : deflateRawSync(raw, { level: 9 });
    const method = stored ? 0 : 8;
    const checksum = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(0x0800, 6); // UTF-8 file names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, name, body);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4); // version made by
    header.writeUInt16LE(20, 6); // version needed
    header.writeUInt16LE(0x0800, 8);
    header.writeUInt16LE(method, 10);
    header.writeUInt16LE(dosTime, 12);
    header.writeUInt16LE(dosDate, 14);
    header.writeUInt32LE(checksum, 16);
    header.writeUInt32LE(body.length, 20);
    header.writeUInt32LE(raw.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt16LE(0, 30); // extra length
    header.writeUInt16LE(0, 32); // comment length
    header.writeUInt16LE(0, 34); // disk number
    header.writeUInt16LE(0, 36); // internal attributes
    header.writeUInt32LE(0, 38); // external attributes
    header.writeUInt32LE(offset, 42);
    central.push(header, name);

    offset += local.length + name.length + body.length;
  }

  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuffer, end]);
}

/* ------------------------------------------------------------------- main */

const outIndex = process.argv.indexOf("--out");
const destination = outIndex >= 0 && process.argv[outIndex + 1] ? resolve(process.argv[outIndex + 1]) : DEFAULT_OUT;

const entries = [];
for (const pack of PACKS) {
  const directory = join(ROOT, pack);
  const stat = statSync(directory, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) {
    console.error(`build: missing pack folder ${pack}`);
    process.exit(1);
  }
  for (const file of walk(directory)) {
    entries.push({ name: `${pack}/${relative(directory, file.absolute).split("\\").join("/")}`, data: readFileSync(file.absolute) });
  }
}
entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

const archive = zip(entries);
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, archive);

const sha256 = createHash("sha256").update(archive).digest("hex");
console.log(`build: ${relative(ROOT, destination).split("\\").join("/")}`);
console.log(`build: ${entries.length} files, ${(archive.length / 1024).toFixed(1)} KiB, sha256 ${sha256}`);
for (const entry of entries) console.log(`  ${entry.name} (${entry.data.length} B)`);
