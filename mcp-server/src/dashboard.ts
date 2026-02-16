import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import type { CanonicalEvent } from "@al/schema/event-envelope";
import {
  getDashboardHost,
  getDashboardPort,
  getDashboardWebappDir,
  getSessionsDir,
  isDashboardEnabled,
} from "./config.js";

interface SessionFileSummary {
  key: string;
  file: string;
  absolute_path: string;
  session_id: string;
  started_at?: string;
  ended_at?: string;
  goal?: string;
  outcome?: "completed" | "partial" | "failed" | "aborted" | "unknown";
  event_count: number;
  size_bytes: number;
  updated_at: string;
}

interface SessionPayload {
  session_id: string;
  goal?: string;
  user_prompt?: string;
  started_at?: string;
  ended_at?: string;
  events: CanonicalEvent[];
}

function json(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function isCanonicalEvent(raw: unknown): raw is CanonicalEvent {
  if (!raw || typeof raw !== "object") return false;
  const event = raw as Partial<CanonicalEvent>;
  return (
    typeof event.id === "string" &&
    typeof event.session_id === "string" &&
    typeof event.seq === "number" &&
    typeof event.ts === "string" &&
    typeof event.kind === "string" &&
    !!event.actor &&
    typeof event.actor.type === "string" &&
    !!event.payload &&
    typeof event.payload === "object" &&
    typeof event.schema_version === "number"
  );
}

function parseSessionContent(content: string): SessionPayload {
  const text = content.trim();
  if (!text) throw new Error("Empty session file.");

  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        const events = parsed.filter(isCanonicalEvent);
        if (events.length !== parsed.length) throw new Error("Invalid event in JSON array.");
        return toSessionPayload(events);
      }
      if (parsed && typeof parsed === "object") {
        const obj = parsed as Partial<SessionPayload>;
        if (Array.isArray(obj.events) && obj.events.every(isCanonicalEvent)) {
          return {
            session_id: obj.session_id ?? obj.events[0]?.session_id ?? "unknown",
            goal: typeof obj.goal === "string" ? obj.goal : undefined,
            user_prompt: typeof obj.user_prompt === "string" ? obj.user_prompt : undefined,
            started_at: typeof obj.started_at === "string" ? obj.started_at : undefined,
            ended_at: typeof obj.ended_at === "string" ? obj.ended_at : undefined,
            events: [...obj.events].sort((a, b) => (a.seq === b.seq ? a.ts.localeCompare(b.ts) : a.seq - b.seq)),
          };
        }
      }
    } catch {
      // Fall back to JSONL parsing below.
    }
  }

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const events = lines.map((line, idx) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSONL line ${idx + 1}`);
    }
    if (!isCanonicalEvent(parsed)) {
      throw new Error(`Invalid canonical event at JSONL line ${idx + 1}`);
    }
    return parsed;
  });
  return toSessionPayload(events);
}

function toSessionPayload(events: CanonicalEvent[]): SessionPayload {
  const sorted = [...events].sort((a, b) => (a.seq === b.seq ? a.ts.localeCompare(b.ts) : a.seq - b.seq));
  const start = sorted.find((event) => event.kind === "session_start");
  const end = [...sorted].reverse().find((event) => event.kind === "session_end");
  const startPayload = (start?.payload ?? {}) as Record<string, unknown>;
  return {
    session_id: sorted[0]?.session_id ?? "unknown",
    goal: typeof startPayload.goal === "string" ? startPayload.goal : undefined,
    user_prompt: typeof startPayload.user_prompt === "string" ? startPayload.user_prompt : undefined,
    started_at: start?.ts ?? sorted[0]?.ts,
    ended_at: end?.ts,
    events: sorted,
  };
}

function readSessionFile(absolutePath: string): SessionPayload {
  const raw = readFileSync(absolutePath, "utf-8");
  return parseSessionContent(raw);
}

function deriveOutcome(events: CanonicalEvent[]): SessionFileSummary["outcome"] {
  const end = [...events].reverse().find((event) => event.kind === "session_end");
  const outcome = end?.payload?.outcome;
  return outcome === "completed" || outcome === "partial" || outcome === "failed" || outcome === "aborted"
    ? outcome
    : "unknown";
}

function listSessionFiles(): SessionFileSummary[] {
  const sessionsDir = resolve(getSessionsDir());
  if (!existsSync(sessionsDir)) return [];

  const files = readdirSync(sessionsDir).filter((file) => file.endsWith(".jsonl") || file.endsWith(".json"));
  const summaries: SessionFileSummary[] = [];

  for (const file of files) {
    const absolutePath = join(sessionsDir, file);
    const stats = statSync(absolutePath);
    if (!stats.isFile()) continue;

    try {
      const payload = readSessionFile(absolutePath);
      summaries.push({
        key: file,
        file,
        absolute_path: absolutePath,
        session_id: payload.session_id,
        started_at: payload.started_at,
        ended_at: payload.ended_at,
        goal: payload.goal,
        outcome: deriveOutcome(payload.events),
        event_count: payload.events.length,
        size_bytes: stats.size,
        updated_at: stats.mtime.toISOString(),
      });
    } catch {
      // Skip malformed files from API listing to keep dashboard stable.
    }
  }

  summaries.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return summaries;
}

function contentType(pathname: string): string {
  const ext = extname(pathname).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".ico") return "image/x-icon";
  return "application/octet-stream";
}

function serveMissingWebapp(res: ServerResponse): void {
  res.writeHead(503, { "content-type": "text/html; charset=utf-8" });
  res.end(
    [
      "<!doctype html>",
      "<html><body style='font-family:sans-serif;background:#020617;color:#e2e8f0;padding:24px'>",
      "<h1>AL Dashboard Not Built</h1>",
      "<p>Build the web app first:</p>",
      "<pre>cd /path/to/AL/webapp && npm run build</pre>",
      "</body></html>",
    ].join("")
  );
}

function safeJoin(root: string, requestPath: string): string | null {
  const normalizedPath = normalize(requestPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const joined = resolve(root, `.${normalizedPath}`);
  if (joined !== root && !joined.startsWith(`${root}/`)) return null;
  return joined;
}

function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string): boolean {
  if (!pathname.startsWith("/api/")) return false;
  if (req.method !== "GET") {
    json(res, 405, { error: "Method not allowed" });
    return true;
  }

  if (pathname === "/api/health") {
    json(res, 200, {
      ok: true,
      local_only: true,
      sessions_dir: resolve(getSessionsDir()),
      ts: new Date().toISOString(),
    });
    return true;
  }

  if (pathname === "/api/sessions") {
    json(res, 200, { sessions: listSessionFiles() });
    return true;
  }

  if (pathname.startsWith("/api/sessions/")) {
    const key = decodeURIComponent(pathname.slice("/api/sessions/".length));
    if (!key) {
      json(res, 400, { error: "Missing session key." });
      return true;
    }
    const summary = listSessionFiles().find((item) => item.key === key || item.session_id === key);
    if (!summary) {
      json(res, 404, { error: "Session not found." });
      return true;
    }

    try {
      const payload = readSessionFile(summary.absolute_path);
      json(res, 200, payload);
    } catch (error) {
      json(res, 500, {
        error: error instanceof Error ? error.message : "Failed to read session file.",
      });
    }
    return true;
  }

  json(res, 404, { error: "Unknown API endpoint." });
  return true;
}

function handleStatic(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  const webappDir = getDashboardWebappDir();

  if (handleApi(req, res, pathname)) return;

  if (!existsSync(webappDir)) {
    serveMissingWebapp(res);
    return;
  }

  const relative = pathname === "/" ? "/index.html" : pathname;
  const resolved = safeJoin(webappDir, relative);
  if (!resolved) {
    res.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }

  const hasExt = extname(relative).length > 0;
  const target = existsSync(resolved) ? resolved : hasExt ? null : join(webappDir, "index.html");
  if (!target || !existsSync(target)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const body = readFileSync(target);
  res.writeHead(200, {
    "content-type": contentType(target),
    "cache-control": target.endsWith("index.html") ? "no-cache" : "public, max-age=3600",
  });
  res.end(body);
}

export function startDashboardServer(): void {
  if (!isDashboardEnabled()) {
    process.stderr.write("AL dashboard disabled (AL_DASHBOARD_ENABLED=false)\n");
    return;
  }

  const host = getDashboardHost();
  const port = getDashboardPort();
  const server = createServer((req, res) => handleStatic(req, res));
  server.listen(port, host, () => {
    process.stderr.write(
      `AL dashboard listening at http://${host}:${port} (sessions: ${resolve(getSessionsDir())}, webapp: ${getDashboardWebappDir()})\n`
    );
  });
  server.on("error", (error) => {
    process.stderr.write(`AL dashboard failed: ${error instanceof Error ? error.message : String(error)}\n`);
  });
}
