/**
 * src/sources/vault.mjs — Obsidian vault source adapter
 *
 * Adapter interface (same signature as teams.mjs):
 *   export async function harvest(cfg): Promise<Record[]>
 *
 * Record schema:
 *   { id: string, text: string, source: "vault", path: string, date: string, content_hash: string }
 *
 * cfg fields consumed:
 *   vault_path    — absolute path to Obsidian vault root
 *   chunk_size    — target chars per sliding-window chunk (default 1000)
 *   chunk_overlap — overlap chars between sliding chunks (default 150)
 *   min_chunk_chars — minimum chars to emit a chunk (default 50, SR Directive)
 */

import { readFileSync, statSync } from "fs";
import { createHash } from "crypto";
import { join, relative, basename, extname } from "path";
import { glob } from "./glob-util.mjs";

const DEFAULT_CHUNK_SIZE    = 1000;
const DEFAULT_CHUNK_OVERLAP = 150;
const DEFAULT_MIN_CHARS     = 50;

/**
 * Strip YAML frontmatter block (--- ... ---) from markdown text.
 * Returns { body, frontmatter } where frontmatter is a plain key:value object.
 */
function stripFrontmatter(text) {
  const fm = {};
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { body: text, frontmatter: fm };

  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    if (key) fm[key] = val;
  }
  return { body: text.slice(match[0].length), frontmatter: fm };
}

/**
 * Split text by heading markers (#, ##, ###).
 * Returns array of { heading: string|null, body: string }.
 */
function splitByHeadings(text) {
  const sections = [];
  const lines = text.split(/\r?\n/);
  let current = { heading: null, lines: [] };

  for (const line of lines) {
    const m = line.match(/^(#{1,3})\s+(.+)/);
    if (m) {
      if (current.lines.length > 0 || current.heading !== null) {
        sections.push(current);
      }
      current = { heading: m[2].trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.heading !== null || current.lines.length > 0) {
    sections.push(current);
  }
  return sections.map((s) => ({
    heading: s.heading,
    body: s.lines.join("\n").trim(),
  }));
}

/**
 * Sliding-window chunk a long text.
 * Returns array of string chunks.
 */
function slidingChunks(text, chunkSize, overlap) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start += chunkSize - overlap;
  }
  return chunks;
}

/**
 * Compute sha256 hex, return first 8 chars.
 */
function contentHash(text) {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 8);
}

/**
 * Main export: harvest all .md files from vault_path, return normalized chunk records.
 *
 * @param {object} cfg  config.json contents
 * @returns {Promise<Array>}
 */
export async function harvest(cfg) {
  const vaultPath   = cfg.vault_path;
  const chunkSize   = cfg.chunk_size    ?? DEFAULT_CHUNK_SIZE;
  const overlap     = cfg.chunk_overlap ?? DEFAULT_CHUNK_OVERLAP;
  const minChars    = cfg.min_chunk_chars ?? DEFAULT_MIN_CHARS;

  if (!vaultPath) throw new Error("config.vault_path is required");

  const mdFiles = await glob("**/*.md", vaultPath);
  const records = [];

  for (const absPath of mdFiles) {
    let raw;
    try {
      raw = readFileSync(absPath, "utf8");
    } catch {
      continue; // skip unreadable files
    }

    const { body, frontmatter } = stripFrontmatter(raw);
    const fileName = basename(absPath, extname(absPath));
    const relPath  = relative(vaultPath, absPath).replace(/\\/g, "/");

    // date: frontmatter date field → file mtime (ISO)
    let date = frontmatter.date || frontmatter.created || "";
    if (!date || !/\d{4}-\d{2}-\d{2}/.test(date)) {
      try {
        date = statSync(absPath).mtime.toISOString().slice(0, 10);
      } catch {
        date = new Date().toISOString().slice(0, 10);
      }
    } else {
      // Normalize to YYYY-MM-DD
      const m = date.match(/(\d{4}-\d{2}-\d{2})/);
      date = m ? m[1] : date;
    }

    // tags from frontmatter
    const tagsRaw = frontmatter.tags || "";
    const tags    = tagsRaw
      .replace(/[\[\]]/g, "")
      .split(/[,\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    const sections = splitByHeadings(body);
    const hasHeadings = sections.some((s) => s.heading !== null);

    const emitChunk = (text, headingHint) => {
      const prefix = `${fileName}${tags.length ? " [" + tags.join(", ") + "]" : ""}${headingHint ? " — " + headingHint : ""}`;
      const full   = `${prefix}\n${text}`.trim();
      if (full.length < minChars) return;  // SR Directive: min_chunk_chars(50)
      const id   = `vault:${relPath}:${contentHash(full)}`;
      records.push({
        id,
        text: full,
        source: "vault",
        path: relPath,
        date,
        content_hash: contentHash(text), // raw text hash for delta (SR Directive 3)
      });
    };

    if (hasHeadings) {
      for (const sec of sections) {
        const sectionText = sec.body;
        if (!sectionText && !sec.heading) continue;
        const combined = sec.heading ? `${sec.heading}\n${sectionText}` : sectionText;

        if (combined.length <= chunkSize) {
          emitChunk(combined, sec.heading);
        } else {
          // Long section → sliding window
          for (const chunk of slidingChunks(combined, chunkSize, overlap)) {
            emitChunk(chunk, sec.heading);
          }
        }
      }
    } else {
      // No headings — pure sliding window over full body
      if (body.length <= chunkSize) {
        emitChunk(body, null);
      } else {
        for (const chunk of slidingChunks(body, chunkSize, overlap)) {
          emitChunk(chunk, null);
        }
      }
    }
  }

  return records;
}
