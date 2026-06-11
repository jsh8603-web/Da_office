/**
 * src/mcp-server.mjs — memo-RAG MCP Server (stdio)
 *
 * Tool: search_memo(query, k?, source?) → {results:[{id,path,score,snippet}]}
 *
 * Graceful degradation (mcp_server.ts search_da pattern):
 *   - embed service not running → {error: "embed service not running at :8787"}
 *   - vectors.jsonl not found   → {error: "vectors.jsonl not found — run build-index"}
 *   - any other error           → {error: <message>}
 *
 * All responses are JSON (errors too).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { searchMemo } from "./search.mjs";

// ── MCP server init ──────────────────────────────────────────────────────────
const server = new McpServer(
  { name: "memo-rag-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// ── Tool: search_memo ────────────────────────────────────────────────────────
server.tool(
  "search_memo",
  "Semantic search over Obsidian vault memo index using BGE-M3 local embeddings.",
  {
    query:  z.string().describe("Natural-language search query"),
    k:      z.number().optional().describe("Number of results to return (default: config top_k)"),
    source: z.string().optional().describe("Filter by source (e.g. 'vault') — omit for all sources"),
  },
  async (args) => {
    const { query, k, source } = args;

    let results;
    try {
      results = await searchMemo(query, { k, source });
    } catch (e) {
      // Graceful: all errors returned as JSON, not thrown
      let msg = e.message ?? String(e);
      if (msg.includes("unreachable") || msg.includes("fetch failed") || msg.includes("ECONNREFUSED")) {
        msg = "embed service not running at :8787 — start python embed_service.py first";
      } else if (msg.includes("vectors.jsonl not found")) {
        msg = "vectors.jsonl not found — run: node src/build-index.mjs";
      }
      return {
        content: [{ type: "text", text: JSON.stringify({ error: msg }) }],
      };
    }

    return {
      content: [{ type: "text", text: JSON.stringify({ results }) }],
    };
  }
);

// ── Server start (stdio transport) ──────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr for logs — stdout is MCP protocol only
  process.stderr.write("memo-rag-mcp MCP Server running on stdio\n");
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err}\n`);
  process.exit(1);
});
