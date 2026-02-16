/**
 * MCP server config from environment.
 */

import { dirname, resolve, sep } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function getSessionsDir(): string {
  return process.env.AL_SESSIONS_DIR ?? process.env.MCP_AL_SESSIONS_DIR ?? "./sessions";
}

export function isDashboardEnabled(): boolean {
  const raw = process.env.AL_DASHBOARD_ENABLED ?? process.env.MCP_AL_DASHBOARD_ENABLED;
  if (raw === undefined) return true;
  return raw === "1" || raw === "true";
}

export function getDashboardHost(): string {
  return process.env.AL_DASHBOARD_HOST ?? process.env.MCP_AL_DASHBOARD_HOST ?? "127.0.0.1";
}

export function getDashboardPort(): number {
  const raw = process.env.AL_DASHBOARD_PORT ?? process.env.MCP_AL_DASHBOARD_PORT;
  if (!raw) return 4317;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid AL_DASHBOARD_PORT: ${raw}`);
  }
  return parsed;
}

export function getDashboardWebappDir(): string {
  const explicit = process.env.AL_DASHBOARD_WEBAPP_DIR ?? process.env.MCP_AL_DASHBOARD_WEBAPP_DIR;
  if (explicit) return resolve(explicit);

  const moduleDir = dirname(fileURLToPath(import.meta.url));
  // dist/config.js -> ../.. lands in mcp-server root
  const serverRoot = resolve(moduleDir, "..");
  return resolve(serverRoot, "../webapp/dist");
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
