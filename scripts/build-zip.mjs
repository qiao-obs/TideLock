import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const INCLUDE_PATHS = ['manifest.json', 'icons', '_locales', 'src'];

function readPngDimensions(filePath) {
  const buf = fs.readFileSync(filePath);
  const sig = buf.subarray(0, 8);
  const expected = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!sig.equals(expected)) {
    throw new Error(`Invalid PNG signature: ${filePath}`);
  }
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
  };
}

function validateExtension() {
  const manifestPath = path.join(ROOT, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  if (manifest.manifest_version !== 3) {
    throw new Error(`Expected manifest_version 3, got ${manifest.manifest_version}`);
  }

  // Validate icon dimensions
  for (const [sizeStr, relPath] of Object.entries(manifest.icons || {})) {
    const abs = path.join(ROOT, relPath);
    if (!fs.existsSync(abs)) throw new Error(`Missing icon file: ${relPath}`);
    const dims = readPngDimensions(abs);
    const expectedSize = Number(sizeStr);
    if (dims.width !== expectedSize || dims.height !== expectedSize) {
      throw new Error(`Icon ${relPath} is ${dims.width}x${dims.height}, expected ${expectedSize}x${expectedSize}`);
    }
  }

  // Validate content scripts and background SW exist
  if (manifest.background?.service_worker) {
    const sw = path.join(ROOT, manifest.background.service_worker);
    if (!fs.existsSync(sw)) throw new Error(`Missing service worker: ${manifest.background.service_worker}`);
  }
  const seenScriptPaths = new Map();
  for (const cs of manifest.content_scripts || []) {
    const world = cs.world || 'ISOLATED';
    for (const f of [...(cs.js || []), ...(cs.css || [])]) {
      if (!fs.existsSync(path.join(ROOT, f))) throw new Error(`Missing content script asset: ${f}`);
      if (seenScriptPaths.has(f) && seenScriptPaths.get(f) !== world) {
        throw new Error(
          `Content script "${f}" is shared across worlds (${seenScriptPaths.get(f)} & ${world}); Chromium deduplicates identical script paths across worlds.`
        );
      }
      seenScriptPaths.set(f, world);
    }
  }
  const coreEngine = fs.readFileSync(path.join(ROOT, 'src/core/feed-engine.js'));
  const mainEngine = fs.readFileSync(path.join(ROOT, 'src/content/page-engine.js'));
  if (!coreEngine.equals(mainEngine)) {
    throw new Error('src/content/page-engine.js is out of sync with src/core/feed-engine.js');
  }
  if (manifest.action?.default_popup) {
    const p = path.join(ROOT, manifest.action.default_popup);
    if (!fs.existsSync(p)) throw new Error(`Missing popup file: ${manifest.action.default_popup}`);
  }

  return manifest;
}

function walkFiles(entryPath, baseDir = ROOT) {
  const full = path.join(baseDir, entryPath);
  const stat = fs.statSync(full);
  if (stat.isFile()) {
    return [entryPath.replace(/\\/g, '/')];
  }
  const results = [];
  for (const name of fs.readdirSync(full).sort()) {
    const rel = path.join(entryPath, name);
    results.push(...walkFiles(rel, baseDir));
  }
  return results;
}

// Pure-Node CRC32 & ZIP builder (zero external dependencies, cross-platform)
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  crcTable[i] = c >>> 0;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZip(relFiles) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const rel of relFiles) {
    const data = fs.readFileSync(path.join(ROOT, rel));
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const nameBuf = Buffer.from(rel, 'utf8');

    // Local file header (30 bytes + name)
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 flag
    localHeader.writeUInt16LE(8, 8); // deflate
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    localParts.push(localHeader, nameBuf, compressed);

    // Central directory header (46 bytes + name)
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
    centralHeader.writeUInt16LE(8, 10); // deflate
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + compressed.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(relFiles.length, 8);
  eocd.writeUInt16LE(relFiles.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

const manifest = validateExtension();
const files = INCLUDE_PATHS.flatMap((p) => walkFiles(p));
fs.mkdirSync(DIST, { recursive: true });
const outFile = path.join(DIST, `tidelock-v${manifest.version}.zip`);
const zipBuffer = buildZip(files);
fs.writeFileSync(outFile, zipBuffer);

console.log(`Built ${outFile} (${files.length} files, ${(zipBuffer.length / 1024).toFixed(1)} KB)`);
