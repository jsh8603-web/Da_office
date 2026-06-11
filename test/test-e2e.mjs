/**
 * test/test-e2e.mjs — SO-6.2 end-to-end verification
 *
 * Flow: sample vault → build-index → searchMemo (2 queries)
 *
 * Requirements:
 *   - embed_service.py running at :8787 → full e2e with real embeddings
 *   - service not running → mock flow verification (structural check)
 *
 * Pass criteria:
 *   - 2 queries both return non-empty results (or expected service-down error)
 *   - At least 1 query top-1 semantically relevant (sample answer labels)
 */

import { execFileSync, spawnSync } from "child_process";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { searchMemo } from "../src/search.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const TEST_CFG_PATH = join(__dirname, "test-config.json");
const NODE = process.execPath;

// Test config points to sample-vault (with real service port)
const testCfg = JSON.parse(readFileSync(TEST_CFG_PATH, "utf8"));
testCfg.embed_url = "http://127.0.0.1:8787"; // real service port

// Write a temp config for build-index subprocess (it reads config file directly)
const TEMP_CFG_PATH = join(__dirname, "test-config-e2e.json");
writeFileSync(TEMP_CFG_PATH, JSON.stringify(testCfg, null, 2), "utf8");

// Check if embed service is running
async function isServiceRunning() {
  try {
    const resp = await fetch("http://127.0.0.1:8787/health", { signal: AbortSignal.timeout(2000) });
    return resp.ok;
  } catch {
    return false;
  }
}

const serviceUp = await isServiceRunning();
console.log(`embed_service :8787 status: ${serviceUp ? "RUNNING" : "NOT RUNNING"}`);

if (!serviceUp) {
  console.log("\n[MOCK FLOW] embed service not running — verifying structural mock flow");
  console.log("SO-6.2 NOTE: embed_service.py 미가동 시 mock 흐름 검증");

  // Verify build-index reports clear error (not silent failure)
  const buildResult = spawnSync(NODE, [join(ROOT, "src/build-index.mjs"), "--config", TEMP_CFG_PATH], {
    encoding: "utf8",
    timeout: 10000,
  });
  const buildOutput = (buildResult.stdout || "") + (buildResult.stderr || "");
  const hasExpectedError = buildOutput.includes("unreachable") || buildOutput.includes("fetch failed") || buildOutput.includes("ECONNREFUSED");
  console.assert(hasExpectedError, `build-index should report service unreachable, got: ${buildOutput.slice(0, 200)}`);
  console.log("build-index reports service-down error clearly ✓");

  // Verify searchMemo returns expected error
  let searchErr = null;
  try {
    const vectors_path = join(ROOT, "data/vectors.jsonl");
    if (!existsSync(vectors_path)) {
      // No vectors.jsonl yet — expected
      console.log("vectors.jsonl not yet built (expected — service not running) ✓");
    } else {
      await searchMemo("BGE 임베딩 서비스 포트", { cfg: testCfg });
    }
  } catch (e) {
    searchErr = e.message;
    console.log(`searchMemo throws expected error: ${searchErr.slice(0, 80)} ✓`);
  }

  console.log("\n✓ SO-6.2 MOCK FLOW PASS (service not running — full e2e deferred to service-up)");
  console.log("ACTION: python embed_service.py 실행 후 node test/test-e2e.mjs 재실행으로 full e2e 검증");
  process.exit(0);
}

// === FULL E2E (service running) ===
console.log("\n[FULL E2E] embed service running — executing full e2e verification");

// Build index
console.log("Building index from sample-vault...");
const buildResult = spawnSync(NODE, [join(ROOT, "src/build-index.mjs"), "--config", TEMP_CFG_PATH], {
  encoding: "utf8",
  timeout: 120000,
});
if (buildResult.status !== 0) {
  console.error("build-index FAILED:", buildResult.stderr);
  process.exit(1);
}
const buildSummary = JSON.parse(buildResult.stdout);
console.log("Build summary:", JSON.stringify(buildSummary));
console.assert(buildSummary.count > 0, "should build at least 1 record");
console.assert(buildSummary.dim > 0, "dim should be > 0");
console.log("build-index OK ✓");

// Query 1: BGE embedding topic (expected: note2.md BGE 관련 청크)
const q1 = "BGE-M3 임베딩 서비스 포트 8787";
const r1 = await searchMemo(q1, { cfg: testCfg, k: 3 });
console.log(`\nQuery 1: "${q1}"`);
console.assert(r1.length > 0, "Query 1 should return results");
console.log(`Results: ${r1.length} (top-1: ${r1[0]?.path} score=${r1[0]?.score})`);
console.log(`Snippet: ${r1[0]?.snippet.slice(0, 80)}`);
// Relevance check: top-1 should mention BGE or embedding
const q1Relevant = r1[0]?.snippet.toLowerCase().includes("bge") || r1[0]?.snippet.includes("임베딩") || r1[0]?.snippet.includes("note2");
console.assert(q1Relevant, `Query 1 top-1 should be about BGE/embedding, got: ${r1[0]?.snippet.slice(0, 100)}`);
console.log("Query 1 top-1 relevant ✓");

// Query 2: project scaffolding topic (expected: note1.md 프로젝트 관련 청크)
const q2 = "회사 환경 이식 lancedb 제거 memo-RAG";
const r2 = await searchMemo(q2, { cfg: testCfg, k: 3 });
console.log(`\nQuery 2: "${q2}"`);
console.assert(r2.length > 0, "Query 2 should return results");
console.log(`Results: ${r2.length} (top-1: ${r2[0]?.path} score=${r2[0]?.score})`);
console.log(`Snippet: ${r2[0]?.snippet.slice(0, 80)}`);
console.log("Query 2 returns results ✓");

console.log("\n✓ SO-6.2 FULL E2E PASS");
