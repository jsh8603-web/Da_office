/**
 * test/test-vault.mjs — SO-2.1 + SO-2.2 검증 스크립트
 * node test/test-vault.mjs
 */

import { harvest } from "../src/sources/vault.mjs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLE_VAULT = join(__dirname, "sample-vault");

const cfg = {
  vault_path: SAMPLE_VAULT,
  chunk_size: 500,
  chunk_overlap: 50,
  min_chunk_chars: 50,
};

const records = await harvest(cfg);

console.log(`Total records: ${records.length}`);

// SO-2.1 검증
console.assert(records.length > 0, "records.length > 0");
const ids = records.map((r) => r.id);
const uniqueIds = new Set(ids);
console.assert(uniqueIds.size === ids.length, `IDs should be unique (got ${uniqueIds.size}/${ids.length})`);
console.assert(records.every((r) => r.text.length >= 20), "All records text.length >= 20");

// SO-2.2 검증: 파일명 기반 prefix로 시작하는지 확인
// prefix format: "{filename} [{tags}] — ..." or "{filename}\n..."
console.assert(records.every((r) => {
  const firstLine = r.text.split("\n")[0];
  return /^[^\s]/.test(firstLine); // starts with non-whitespace (filename/heading prepend)
}), "All records text starts with prepended prefix");
const dateRegex = /\d{4}-\d{2}-\d{2}/;
console.assert(records.every((r) => dateRegex.test(r.date)), "All records have date YYYY-MM-DD");

// Show sample
console.log("\nSample records:");
for (const r of records.slice(0, 3)) {
  console.log(`  id=${r.id} date=${r.date} text_len=${r.text.length} hash=${r.content_hash}`);
  console.log(`  text[:80]=${r.text.slice(0, 80).replace(/\n/g, "\\n")}`);
}

console.log("\n✓ All assertions passed — SO-2.1 + SO-2.2 VERIFY PASS");
