/**
 * src/build-index.mjs — vault source adapter → batch embed → vectors.jsonl
 *
 * Usage: node src/build-index.mjs [--config path/to/config.json]
 *
 * Flow:
 *   1. Load config.json
 *   2. vault.harvest(cfg) → chunk records
 *   3. Batch POST embed_url/embed (batch=32, text truncated to 1800 chars)
 *   4. Write data/vectors.jsonl ({id,text,source,path,date,vector})
 *   5. Write data/index-state.json ({id → content_hash}) for delta skip (SR Directive 3)
 *   6. Print build summary (count, dim, by_source) to stdout
 *
 * Delta logic:
 *   - Load data/index-state.json if exists (prev run hashes)
 *   - Records whose content_hash matches prev run → reuse existing vector from vectors.jsonl
 *   - Changed/new records → POST /embed for fresh vector
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

import { harvest } from "./sources/vault.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

// --- Config ---
const args = process.argv.slice(2);
const cfgIdx = args.indexOf("--config");
const cfgPath = cfgIdx >= 0 ? args[cfgIdx + 1] : join(PROJECT_ROOT, "config.json");

let cfg;
try {
  cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
} catch (e) {
  console.error(`Failed to load config: ${cfgPath}\n${e.message}`);
  process.exit(1);
}

const EMBED_URL  = (cfg.embed_url ?? "http://127.0.0.1:8787") + "/embed";
const BATCH_SIZE = 32;
const MAX_TEXT   = 1800;
const DATA_DIR   = join(PROJECT_ROOT, "data");
const OUT_FILE   = join(DATA_DIR, "vectors.jsonl");
const STATE_FILE = join(DATA_DIR, "index-state.json");

// --- Load previous index state (delta skip) ---
let prevState = {}; // id → content_hash
let prevVectors = {}; // id → vector (for reuse)

if (existsSync(STATE_FILE)) {
  try {
    prevState = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch { /* ignore corrupt state */ }
}
if (existsSync(OUT_FILE) && Object.keys(prevState).length > 0) {
  try {
    const lines = readFileSync(OUT_FILE, "utf8").split("\n").filter(Boolean);
    for (const line of lines) {
      const rec = JSON.parse(line);
      if (rec.id && rec.vector) prevVectors[rec.id] = rec.vector;
    }
  } catch { /* ignore corrupt vectors */ }
}

// --- Harvest records ---
process.stderr.write("Harvesting vault...\n");
let records;
try {
  records = await harvest(cfg);
} catch (e) {
  console.error(`harvest failed: ${e.message}`);
  process.exit(1);
}
process.stderr.write(`Harvested ${records.length} records\n`);

// --- Separate fresh vs cached ---
const fresh = [];
const cached = [];

for (const rec of records) {
  const prev = prevState[rec.id];
  if (prev && prev === rec.content_hash && prevVectors[rec.id]) {
    cached.push({ rec, vector: prevVectors[rec.id] });
  } else {
    fresh.push(rec);
  }
}
process.stderr.write(`Delta: ${fresh.length} to embed, ${cached.length} reused from cache\n`);

// --- Embed function ---
async function embedBatch(texts) {
  let resp;
  try {
    resp = await fetch(EMBED_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts }),
    });
  } catch (e) {
    throw new Error(`embed_service unreachable at ${EMBED_URL}: ${e.message}`);
  }
  if (!resp.ok) {
    throw new Error(`embed HTTP ${resp.status} ${resp.statusText}`);
  }
  return (await resp.json()).vectors;
}

// --- Batch embed fresh records ---
const freshEmbedded = [];

for (let i = 0; i < fresh.length; i += BATCH_SIZE) {
  const batch = fresh.slice(i, i + BATCH_SIZE);
  const texts = batch.map((r) => r.text.slice(0, MAX_TEXT));
  const vecs = await embedBatch(texts);
  batch.forEach((rec, j) => {
    freshEmbedded.push({ rec, vector: vecs[j] });
  });
  process.stderr.write(`Embedded ${Math.min(i + BATCH_SIZE, fresh.length)}/${fresh.length}\r`);
}
if (fresh.length > 0) process.stderr.write("\n");

// --- Merge all results ---
const all = [
  ...freshEmbedded,
  ...cached,
];

if (all.length === 0) {
  console.error("No records produced — check vault_path in config.json");
  process.exit(1);
}

const dim = all[0].vector?.length ?? 0;

// --- Write vectors.jsonl ---
const jsonlLines = all.map(({ rec, vector }) =>
  JSON.stringify({
    id:     rec.id,
    text:   rec.text,
    source: rec.source,
    path:   rec.path,
    date:   rec.date,
    vector,
  })
);
writeFileSync(OUT_FILE, jsonlLines.join("\n") + "\n", "utf8");

// --- Write index-state.json (delta tracking) ---
const newState = {};
for (const { rec } of all) {
  newState[rec.id] = rec.content_hash;
}
writeFileSync(STATE_FILE, JSON.stringify(newState, null, 2), "utf8");

// --- Build summary ---
const bySource = all.reduce((acc, { rec }) => {
  acc[rec.source] = (acc[rec.source] ?? 0) + 1;
  return acc;
}, {});

const allDimOk = all.every(({ vector }) => Array.isArray(vector) && vector.length === dim);

console.log(JSON.stringify({
  count:       all.length,
  dim,
  all_dim_ok:  allDimOk,
  by_source:   bySource,
  fresh:       fresh.length,
  reused:      cached.length,
  out:         OUT_FILE,
}, null, 2));
