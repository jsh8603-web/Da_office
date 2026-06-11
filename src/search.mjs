/**
 * src/search.mjs — cosine rank + rerank gate (fail-OPEN)
 *
 * Ported from ~/.claude/scripts/da-vector/lib/memo-recall-test.mjs (rank logic).
 *
 * export async function searchMemo(query, opts) → results[]
 *
 * opts:
 *   k?      — top-k results (default: cfg.top_k or 5)
 *   source? — filter by source field (e.g. "vault")
 *   cfg?    — override config object (default: load from ../config.json)
 *
 * Config keys consumed:
 *   embed_url, tau, tau_r, pre_n, top_k, rerank, min_chunk_chars
 *
 * rerank gate (SR Directive 1):
 *   - embed_service.py normalize=True already returns sigmoid[0,1] scores
 *   - tau_r=0.30 absolute cut is valid (no additional sigmoid needed)
 *   - fail-OPEN: rerank=off OR service failure → cosine top_k returned silently
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");
const VECTORS_FILE  = join(PROJECT_ROOT, "data", "vectors.jsonl");
const CONFIG_FILE   = join(PROJECT_ROOT, "config.json");

// --- Cached state (module-level, loaded once) ---
let _vectors = null;
let _cfg     = null;

function loadConfig() {
  if (_cfg) return _cfg;
  _cfg = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
  return _cfg;
}

function loadVectors() {
  if (_vectors) return _vectors;
  if (!existsSync(VECTORS_FILE)) {
    throw new Error(`vectors.jsonl not found at ${VECTORS_FILE} — run build-index first`);
  }
  const lines = readFileSync(VECTORS_FILE, "utf8").split("\n").filter(Boolean);
  _vectors = lines.map((l) => JSON.parse(l));
  return _vectors;
}

/** L2-normalize a vector in place and return it. */
function normalize(v) {
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => x / norm);
}

/** Cosine similarity (assumes both are already normalized). */
function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Embed a single query text via embed_service. */
async function embedQuery(text, embedUrl) {
  const resp = await fetch(`${embedUrl}/embed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ texts: [text] }),
  });
  if (!resp.ok) throw new Error(`embed HTTP ${resp.status}`);
  return (await resp.json()).vectors[0];
}

/**
 * Cosine rank candidates against query vector.
 * Returns sorted array of { id, path, source, score, text } desc by score.
 */
function cosineRank(qvec, candidates, tau) {
  const nq = normalize([...qvec]);
  return candidates
    .map((rec) => {
      const nv = normalize([...rec.vector]);
      const score = dot(nq, nv);
      return { id: rec.id, path: rec.path, source: rec.source, score, text: rec.text };
    })
    .filter((r) => r.score >= tau)
    .sort((a, b) => b.score - a.score);
}

/**
 * Rerank top candidates via /rerank endpoint.
 * fail-OPEN: any error returns null (caller falls back to cosine).
 */
async function tryRerank(query, candidates, rerankUrl, tauR, topK) {
  try {
    const docs = candidates.map((c) => ({ id: c.id, text: c.text }));
    const resp = await fetch(rerankUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, docs, top_k: topK }),
    });
    if (!resp.ok) return null; // fail-OPEN
    const { results } = await resp.json();
    // Filter by tau_r and map back to full candidate data
    return results
      .filter((r) => r.score >= tauR)
      .map((r) => {
        const orig = candidates.find((c) => c.id === r.id);
        return orig ? { ...orig, score: r.score } : null;
      })
      .filter(Boolean)
      .slice(0, topK);
  } catch {
    return null; // fail-OPEN: network error
  }
}

/**
 * Search memo index.
 *
 * @param {string} query
 * @param {{ k?: number, source?: string, cfg?: object }} opts
 * @returns {Promise<Array<{id,path,score,snippet}>>}
 */
export async function searchMemo(query, opts = {}) {
  const cfg      = opts.cfg ?? loadConfig();
  const embedUrl = cfg.embed_url ?? "http://127.0.0.1:8787";
  const tau      = cfg.tau      ?? 0.45;
  const tauR     = cfg.tau_r    ?? 0.30;
  const preN     = cfg.pre_n    ?? 8;
  const topK     = opts.k ?? cfg.top_k ?? 5;
  const doRerank = cfg.rerank !== "off" && cfg.rerank !== false;
  const sourceFilter = opts.source ?? null;

  const vectors = loadVectors();

  // Apply source filter
  const candidates = sourceFilter
    ? vectors.filter((r) => r.source === sourceFilter)
    : vectors;

  // Embed query
  const qvec = await embedQuery(query, embedUrl);

  // Cosine rank → top pre_n above tau
  const ranked = cosineRank(qvec, candidates, tau).slice(0, preN);

  if (ranked.length === 0) {
    return [];
  }

  // Rerank gate (fail-OPEN)
  let final;
  if (doRerank) {
    const rerankUrl = `${embedUrl}/rerank`;
    const reranked = await tryRerank(query, ranked, rerankUrl, tauR, topK);
    final = reranked ?? ranked.slice(0, topK); // fallback to cosine on failure
  } else {
    final = ranked.slice(0, topK);
  }

  // Format output
  return final.map((r) => ({
    id:      r.id,
    path:    r.path,
    score:   +r.score.toFixed(4),
    snippet: r.text.slice(0, 200),
  }));
}

// CLI mode: node src/search.mjs "query string"
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const query = process.argv[2];
  if (!query) {
    console.error("Usage: node src/search.mjs <query>");
    process.exit(1);
  }
  const results = await searchMemo(query);
  console.log(JSON.stringify(results, null, 2));
}
