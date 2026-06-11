/**
 * test/test-teams.mjs — SO-5.2 teams stub verification
 */
import { harvest } from "../src/sources/teams.mjs";

console.assert(typeof harvest === "function", "harvest must be a function");
console.log("import OK, harvest is function ✓");

try {
  await harvest({});
  console.error("FAIL: harvest() should throw");
  process.exit(1);
} catch (e) {
  console.assert(e.message.includes("not implemented"), `message must include 'not implemented', got: ${e.message}`);
  console.log(`teams harvest() throws: "${e.message}" ✓`);
}

console.log("\n✓ SO-5.2 teams stub PASS");
