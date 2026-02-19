import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import type { CanonicalEvent } from "./event-envelope.js";
import {
  getDashboardHost,
  getDashboardPort,
  getDashboardWebappDir,
  getSessionsDir,
  isDashboardEnabled,
} from "./config.js";
import { exportSessionJson } from "./store.js";
import { handleGatewayAct, handleGatewayBeginRun, handleGatewayEndRun } from "./tools.js";

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

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON body.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function parseToolResult(result: unknown): { ok: boolean; payload: unknown; error?: string } {
  if (!result || typeof result !== "object") {
    return { ok: false, payload: null, error: "Invalid tool response." };
  }
  const tool = result as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
  const text = tool.content?.[0]?.text;
  if (tool.isError) {
    return { ok: false, payload: null, error: text ?? "Tool failed." };
  }
  if (!text) return { ok: true, payload: {} };
  try {
    return { ok: true, payload: JSON.parse(text) };
  } catch {
    return { ok: true, payload: { message: text } };
  }
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

async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  if (!pathname.startsWith("/api/")) return false;

  if (pathname === "/api/health") {
    if (req.method !== "GET") {
      json(res, 405, { error: "Method not allowed" });
      return true;
    }
    json(res, 200, {
      ok: true,
      local_only: true,
      sessions_dir: resolve(getSessionsDir()),
      ts: new Date().toISOString(),
    });
    return true;
  }

  if (pathname === "/api/sessions") {
    if (req.method !== "GET") {
      json(res, 405, { error: "Method not allowed" });
      return true;
    }
    json(res, 200, { sessions: listSessionFiles() });
    return true;
  }

  if (pathname === "/api/gateway/begin") {
    if (req.method !== "POST") {
      json(res, 405, { error: "Method not allowed" });
      return true;
    }
    try {
      const body = await readJsonBody(req);
      const parsed = parseToolResult(await handleGatewayBeginRun(body as never));
      if (!parsed.ok) {
        json(res, 400, { error: parsed.error });
        return true;
      }
      json(res, 200, parsed.payload);
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (pathname === "/api/gateway/act") {
    if (req.method !== "POST") {
      json(res, 405, { error: "Method not allowed" });
      return true;
    }
    try {
      const body = await readJsonBody(req);
      const parsed = parseToolResult(await handleGatewayAct(body as never));
      if (!parsed.ok) {
        json(res, 400, { error: parsed.error });
        return true;
      }
      json(res, 200, parsed.payload);
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (pathname === "/api/gateway/end") {
    if (req.method !== "POST") {
      json(res, 405, { error: "Method not allowed" });
      return true;
    }
    try {
      const body = await readJsonBody(req);
      const parsed = parseToolResult(await handleGatewayEndRun(body as never));
      if (!parsed.ok) {
        json(res, 400, { error: parsed.error });
        return true;
      }
      json(res, 200, parsed.payload);
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (pathname.startsWith("/api/sessions/")) {
    if (req.method !== "GET") {
      json(res, 405, { error: "Method not allowed" });
      return true;
    }
    const key = decodeURIComponent(pathname.slice("/api/sessions/".length));
    if (!key) {
      json(res, 400, { error: "Missing session key." });
      return true;
    }

    if (key.endsWith("/export")) {
      const rawKey = key.slice(0, -"/export".length);
      const summary = listSessionFiles().find((item) => item.key === rawKey || item.session_id === rawKey);
      if (!summary) {
        json(res, 404, { error: "Session not found." });
        return true;
      }
      try {
        const exported = exportSessionJson(summary.session_id);
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "content-disposition": `attachment; filename="${summary.session_id}.session.json"`,
        });
        res.end(exported);
      } catch (error) {
        json(res, 500, {
          error: error instanceof Error ? error.message : "Failed to export session.",
        });
      }
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

  handleApi(req, res, pathname)
    .then((handled) => {
    if (handled) return;

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
    })
    .catch((error) => {
      json(res, 500, {
        error: error instanceof Error ? error.message : "Unhandled server error.",
      });
    });
}

export function startDashboardServer(): { host: string; port: number } | null {
  if (!isDashboardEnabled()) {
    process.stderr.write("AL dashboard disabled (AL_DASHBOARD_ENABLED=false)\n");
    return null;
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
  return { host, port };
}
