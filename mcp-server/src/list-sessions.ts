/**
 * Session discovery API (S08). Returns ids, paths, timestamps, newest-first.
 */

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { getSessionsDir } from "./config.js";

export interface SessionEntry {
  id: string;
  path: string;
  modifiedAt: string; // ISO
  startedAt: string;  // from filename if parseable
}

/**
 * List session files from the configured directory. Newest-first by mtime.
 * Returns empty array if directory is missing or empty (graceful).
 */
export function listSessions(dir?: string): SessionEntry[] {
  const outDir = dir ?? getSessionsDir();
  try {
    const names = readdirSync(outDir);
    const entries: SessionEntry[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const path = join(outDir, name);
      try {
        const stat = statSync(path);
        if (!stat.isFile()) continue;
        // Filename: {id}_{epoch}.json -> id is everything before last _
        const base = name.slice(0, -5);
        const lastUnderscore = base.lastIndexOf("_");
        const id = lastUnderscore >= 0 ? base.slice(0, lastUnderscore) : base;
        const epochStr = lastUnderscore >= 0 ? base.slice(lastUnderscore + 1) : "";
        const startedAt = epochStr && /^\d+$/.test(epochStr)
          ? new Date(parseInt(epochStr, 10)).toISOString()
          : new Date(stat.mtime).toISOString();
        entries.push({
          id,
          path,
          modifiedAt: new Date(stat.mtime).toISOString(),
          startedAt,
        });
      } catch {
        // skip unreadable files
      }
    }
    entries.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
    return entries;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
