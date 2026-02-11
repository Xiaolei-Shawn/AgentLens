/**
 * Flush completed sessions to disk (S07).
 * Writes schema-conformant JSON. File naming: deterministic and collision-safe.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { validateSession } from "@al/schema";
import { getSessionsDir } from "./config.js";
import { toSession, type SessionState } from "./store.js";

function safeFilename(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Deterministic filename: {sessionId}_{started_at_epoch}.json
 * Collision-safe: same session id + same started_at => same file; different started_at => different file.
 */
export function sessionToBasename(state: SessionState): string {
  const epoch = new Date(state.started_at).getTime();
  return `${safeFilename(state.id)}_${epoch}.json`;
}

export function flushSession(state: SessionState, dir?: string): { path: string; error?: string } {
  const outDir = dir ?? getSessionsDir();
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const session = toSession(state);
  const result = validateSession(session);
  if (!result.success) {
    return { path: "", error: `Validation failed: ${JSON.stringify(result.errors)}` };
  }

  const basename = sessionToBasename(state);
  const path = join(outDir, basename);
  writeFileSync(path, JSON.stringify(session, null, 2), "utf-8");
  return { path };
}

export function getSessionFilePath(state: SessionState, dir?: string): string {
  const outDir = dir ?? getSessionsDir();
  return join(outDir, sessionToBasename(state));
}
