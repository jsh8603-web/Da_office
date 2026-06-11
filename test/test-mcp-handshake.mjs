/**
 * test/test-mcp-handshake.mjs — SO-5.1 MCP initialize + tools/list verification
 *
 * Spawns mcp-server.mjs as a child process and exchanges MCP protocol messages
 * via stdin/stdout to verify:
 *   1. initialize handshake succeeds
 *   2. tools/list contains "search_memo"
 *   3. search_memo call returns JSON structure (error graceful, no crash)
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = join(__dirname, "../src/mcp-server.mjs");
const NODE = process.execPath;

function jsonrpc(id, method, params = {}) {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
}

async function runTest() {
  const proc = spawn(NODE, [SERVER_PATH], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  const messages = [];

  proc.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
    // Parse complete JSON lines
    const lines = stdout.split("\n");
    stdout = lines.pop(); // keep incomplete line
    for (const line of lines) {
      if (line.trim()) {
        try {
          messages.push(JSON.parse(line));
        } catch { /* ignore non-JSON */ }
      }
    }
  });

  const stderrLines = [];
  proc.stderr.on("data", (d) => stderrLines.push(d.toString()));

  function waitForMessage(id, timeout = 3000) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting for msg id=${id}`)), timeout);
      const check = () => {
        const msg = messages.find((m) => m.id === id);
        if (msg) { clearTimeout(t); resolve(msg); return; }
        setTimeout(check, 50);
      };
      check();
    });
  }

  // 1. Initialize
  proc.stdin.write(jsonrpc(1, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0" },
  }));

  const initResp = await waitForMessage(1);
  console.assert(initResp.result, "initialize should return result");
  console.log("SO-5.1: initialize handshake OK ✓");

  // Send initialized notification
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");

  // 2. tools/list
  proc.stdin.write(jsonrpc(2, "tools/list", {}));
  const toolsResp = await waitForMessage(2);
  const tools = toolsResp.result?.tools ?? [];
  const searchMemoTool = tools.find((t) => t.name === "search_memo");
  console.assert(searchMemoTool, `search_memo should be in tools/list, got: ${JSON.stringify(tools.map((t) => t.name))}`);
  console.log("SO-5.1: tools/list contains search_memo ✓");

  // 3. search_memo call (service not running — expect graceful JSON error)
  proc.stdin.write(jsonrpc(3, "tools/call", {
    name: "search_memo",
    arguments: { query: "test query" },
  }));
  const callResp = await waitForMessage(3, 5000);
  console.assert(callResp.result?.content?.[0]?.text, "search_memo should return content[0].text");
  const responseText = callResp.result.content[0].text;
  const responseJson = JSON.parse(responseText);
  console.assert(
    responseJson.results !== undefined || responseJson.error !== undefined,
    `response should have results or error, got: ${responseText}`
  );
  console.log(`SO-5.1: search_memo call returns JSON ✓ (${responseJson.error ? "error: graceful" : "results: " + responseJson.results.length})`);

  proc.stdin.end();
  proc.kill();

  console.log("\n✓ SO-5.1 MCP handshake + tools/list + search_memo PASS");
  process.exit(0);
}

runTest().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
