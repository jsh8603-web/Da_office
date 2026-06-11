/**
 * src/sources/glob-util.mjs — minimal recursive glob helper
 * Returns absolute paths matching a simple glob pattern (** / *.ext only).
 * No external dependency (Node.js built-ins only).
 */

import { readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * Recursively walk dir and collect files matching ext filter.
 * @param {string} dir
 * @param {string} ext  — e.g. ".md"
 * @param {string[]} acc
 */
function walkDir(dir, ext, acc) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".")) continue; // skip hidden dirs/files
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      walkDir(full, ext, acc);
    } else if (e.isFile() && e.name.endsWith(ext)) {
      acc.push(full);
    }
  }
}

/**
 * Minimal glob: supports "**\/*.ext" pattern.
 * @param {string} pattern  — e.g. "**\/*.md"
 * @param {string} root
 * @returns {Promise<string[]>}
 */
export async function glob(pattern, root) {
  const extMatch = pattern.match(/\*\.(\w+)$/);
  if (!extMatch) throw new Error(`glob: unsupported pattern "${pattern}" — only **/*.ext supported`);
  const ext = "." + extMatch[1];
  const results = [];
  walkDir(root, ext, results);
  return results;
}
