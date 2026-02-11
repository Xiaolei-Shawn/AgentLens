/**
 * MCP server config from environment.
 */

import { resolve, sep } from "node:path";
import { existsSync, realpathSync } from "node:fs";

export function getSessionsDir(): string {
  return process.env.AL_SESSIONS_DIR ?? process.env.MCP_AL_SESSIONS_DIR ?? "./sessions";
}

export function isWatcherEnabled(): boolean {
  return process.env.AL_WATCHER_ENABLED === "1" || process.env.AL_WATCHER_ENABLED === "true";
}

export function getWatcherDir(): string {
  return process.env.AL_WATCHER_DIR ?? process.env.MCP_AL_WATCHER_DIR ?? "./watcher-events";
}

/** Workspace root for file_op: all paths are resolved and validated against this. */
export function getWorkspaceRoot(): string {
  const root = process.env.AL_WORKSPACE_ROOT ?? process.env.MCP_AL_WORKSPACE_ROOT ?? process.cwd();
  try {
    return realpathSync(resolve(root));
  } catch {
    return resolve(root);
  }
}

/** Resolve path relative to workspace; throw if it escapes workspace (path traversal). */
export function resolveWithinWorkspace(workspaceRoot: string, rawPath: string): string {
  const normalized = resolve(workspaceRoot, rawPath);
  const real = existsSync(normalized) ? realpathSync(normalized) : resolve(normalized);
  const prefix = workspaceRoot.endsWith(sep) ? workspaceRoot : workspaceRoot + sep;
  if (real !== workspaceRoot && !real.startsWith(prefix)) {
    throw new Error(`Path escapes workspace: ${rawPath}`);
  }
  return real;
}
