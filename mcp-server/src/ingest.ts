import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getIngestFingerprintMaxWindowHours, getIngestFingerprintMinConfidence, getSessionsDir } from "./config.js";
import { adaptRawContent } from "./adapters/index.js";
import type { AdaptedEvent, AdaptedSession } from "./adapters/types.js";
import type { CanonicalEvent } from "./event-envelope.js";
import { readSessionEvents } from "./store.js";

function safeFilename(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** Exact key: same kind, ts, actor, scope, payload (for strict dedupe within same source). */
function dedupeKey(event: Pick<CanonicalEvent, "kind" | "ts" | "actor" | "scope" | "payload">): string {
  return JSON.stringify([
    event.kind,
    event.ts,
    event.actor.type,
    event.actor.id ?? "",
    event.scope ?? {},
    event.payload ?? {},
  ]);
}

/** Ts rounded to 2-minute bucket for semantic matching (MCP vs adapter may differ by seconds). */
function tsBucket(ts: string): string {
  const ms = new Date(ts).getTime();
  if (Number.isNaN(ms)) return ts;
  const bucket = Math.floor(ms / (2 * 60 * 1000)) * (2 * 60 * 1000);
  return new Date(bucket).toISOString();
}

/** Normalize text for semantic key: lowercase, collapse spaces, truncate. */
function semanticNorm(value: string | undefined, max = 400): string {
  if (!value || typeof value !== "string") return "";
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Semantic key for merge dedupe: same logical event from MCP vs adapter should match
 * so we keep one (prefer existing) and don't double-count for recommendations/risk.
 */
function semanticDedupeKey(event: CanonicalEvent): string {
  const kind = event.kind;
  const ts = tsBucket(event.ts);
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const scope = event.scope ?? {};

  if (kind === "session_start" || kind === "session_end") {
    return `${kind}`;
  }
  if (kind === "intent") {
    const desc = semanticNorm(String(payload.description ?? payload.title ?? ""));
    return `intent:${desc}`;
  }
  if (kind === "tool_call") {
    const action = semanticNorm(String(payload.action ?? ""), 80);
    const target = semanticNorm(String(payload.target ?? (payload.details as Record<string, unknown>)?.raw ?? ""), 200);
    return `tool_call:${event.actor.type}:${action}:${target}`;
  }
  if (kind === "artifact_created") {
    const artifactType = String(payload.artifact_type ?? "");
    const text = semanticNorm(String(payload.text ?? payload.summary ?? ""), 300);
    const intentId = scope.intent_id ?? "";
    return `artifact:${artifactType}:${intentId}:${text}`;
  }
  if (kind === "token_usage_checkpoint") {
    const intentId = scope.intent_id ?? "";
    return `token_usage:${ts}:${intentId}`;
  }
  // Other kinds: fall back to exact-like key but with ts bucket to allow minor ts drift
  return JSON.stringify([
    kind,
    ts,
    event.actor.type,
    event.actor.id ?? "",
    scope,
    payload,
  ]);
}

function toIso(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function toMs(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const ms = new Date(raw).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

function normalizeFingerprint(value: string | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);
}

function tokenSet(value: string): Set<string> {
  const words = value.split(" ").filter((w) => w.length > 2);
  return new Set(words);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const item of a) {
    if (b.has(item)) overlap += 1;
  }
  const union = a.size + b.size - overlap;
  return union <= 0 ? 0 : overlap / union;
}

function promptSimilarity(aRaw: string, bRaw: string): number {
  const a = normalizeFingerprint(aRaw);
  const b = normalizeFingerprint(bRaw);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length >= 18 && b.length >= 18 && (a.includes(b) || b.includes(a))) return 0.9;
  return jaccard(tokenSet(a), tokenSet(b));
}

function timeProximityScore(sourceMs: number | undefined, targetMs: number | undefined): number {
  if (!sourceMs || !targetMs) return 0;
  const hours = Math.abs(sourceMs - targetMs) / (1000 * 60 * 60);
  if (hours <= 0.5) return 1;
  if (hours <= 6) return 0.8;
  if (hours <= 24) return 0.5;
  if (hours <= 72) return 0.25;
  return 0;
}

function extractPromptFromAdapted(adapted: AdaptedSession): string | undefined {
  if (adapted.user_prompt && adapted.user_prompt.trim()) return adapted.user_prompt;
  const intent = adapted.events.find((event) => event.kind === "intent");
  if (!intent) return adapted.goal;
  const payload = (intent.payload ?? {}) as Record<string, unknown>;
  const description = typeof payload.description === "string" ? payload.description : undefined;
  const title = typeof payload.title === "string" ? payload.title : undefined;
  return description ?? title ?? adapted.goal;
}

interface SessionFingerprint {
  session_id: string;
  prompt?: string;
  started_at?: string;
  ended_at?: string;
  updated_at?: string;
}

function parseExistingSessionFingerprint(path: string, sessionId: string): SessionFingerprint | undefined {
  const raw = readFileSync(path, "utf-8").trim();
  if (!raw) return undefined;
  const lines = raw.split("\n").filter((line) => line.trim() !== "");
  let prompt: string | undefined;
  let sessionStartGoal: string | undefined;
  let startedAt: string | undefined;
  let endedAt: string | undefined;

  for (const line of lines) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;
    const event = parsed as Partial<CanonicalEvent>;
    if (!startedAt && typeof event.ts === "string") startedAt = event.ts;
    if (event.kind === "session_start") {
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      const userPrompt = typeof payload.user_prompt === "string" ? payload.user_prompt : undefined;
      const goal = typeof payload.goal === "string" ? payload.goal : undefined;
      if (userPrompt && userPrompt.trim() !== "") {
        prompt = userPrompt;
      } else {
        sessionStartGoal = goal;
        prompt = prompt ?? goal;
      }
      startedAt = typeof event.ts === "string" ? event.ts : startedAt;
    } else if (event.kind === "intent") {
      const payload = (event.payload ?? {}) as Record<string, unknown>;
      const description = typeof payload.description === "string" ? payload.description : undefined;
      const title = typeof payload.title === "string" ? payload.title : undefined;
      const intentText = description ?? title;
      if (intentText && (!prompt || prompt === sessionStartGoal)) {
        prompt = intentText;
      }
    } else if (event.kind === "session_end") {
      endedAt = typeof event.ts === "string" ? event.ts : endedAt;
    }
  }

  const stats = statSync(path);
  return {
    session_id: sessionId,
    prompt,
    started_at: startedAt,
    ended_at: endedAt,
    updated_at: stats.mtime.toISOString(),
  };
}

function loadSessionFingerprints(): SessionFingerprint[] {
  const dir = getSessionsDir();
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter((name) => name.endsWith(".jsonl") && !name.includes(".raw."));
  const out: SessionFingerprint[] = [];
  for (const file of files) {
    const sessionId = file.replace(/\.jsonl$/, "");
    const meta = parseExistingSessionFingerprint(join(dir, file), sessionId);
    if (meta) out.push(meta);
  }
  return out;
}

interface FingerprintMatch {
  session_id: string;
  confidence: number;
}

function findFingerprintSessionMatch(adapted: AdaptedSession): FingerprintMatch | undefined {
  const maxWindowHours = getIngestFingerprintMaxWindowHours();
  const prompt = extractPromptFromAdapted(adapted);
  const normalized = normalizeFingerprint(prompt);
  if (!normalized) return undefined;

  const sourceTs =
    toMs(adapted.started_at) ??
    toMs(adapted.events[0]?.ts) ??
    toMs(adapted.ended_at) ??
    Date.now();

  const candidates = loadSessionFingerprints();
  let best: FingerprintMatch | undefined;

  for (const candidate of candidates) {
    const candidatePrompt = normalizeFingerprint(candidate.prompt);
    if (!candidatePrompt) continue;
    const promptScore = promptSimilarity(normalized, candidatePrompt);
    if (promptScore < 0.52) continue;

    const candidateTs =
      toMs(candidate.ended_at) ?? toMs(candidate.started_at) ?? toMs(candidate.updated_at) ?? undefined;
    const timeScore = timeProximityScore(sourceTs, candidateTs);
    const distanceHours =
      sourceTs && candidateTs ? Math.abs(sourceTs - candidateTs) / (1000 * 60 * 60) : Number.POSITIVE_INFINITY;
    if (distanceHours > maxWindowHours) continue;

    const score = promptScore * 0.78 + timeScore * 0.22;
    if (!best || score > best.confidence) {
      best = { session_id: candidate.session_id, confidence: Number(score.toFixed(3)) };
    }
  }

  if (!best) return undefined;
  if (best.confidence < getIngestFingerprintMinConfidence()) return undefined;
  return best;
}

function buildCanonicalEvent(
  sessionId: string,
  seq: number,
  event: AdaptedEvent,
  fallbackTs: string
): CanonicalEvent {
  const ts = toIso(event.ts, fallbackTs);
  return {
    id: `${sessionId}:${seq}:${randomUUID().slice(0, 8)}`,
    session_id: sessionId,
    seq,
    ts,
    kind: event.kind,
    actor: event.actor,
    scope: event.scope,
    payload: event.payload,
    derived: event.derived,
    confidence: event.confidence,
    visibility: event.visibility,
    schema_version: 1,
  };
}

function writeEventsAppend(sessionId: string, events: CanonicalEvent[]): string {
  const outDir = getSessionsDir();
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const path = join(outDir, `${safeFilename(sessionId)}.jsonl`);
  const existing = existsSync(path) ? readFileSync(path, "utf-8").trim() : "";
  const append = events.map((e) => JSON.stringify(e)).join("\n");
  const body = [existing, append].filter(Boolean).join("\n") + "\n";
  writeFileSync(path, body, "utf-8");
  return path;
}

/** Write full session log with events sorted by ts then seq and seq reassigned 1..N. */
function writeSessionFull(sessionId: string, events: CanonicalEvent[]): string {
  const outDir = getSessionsDir();
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const path = join(outDir, `${safeFilename(sessionId)}.jsonl`);
  const sorted = [...events].sort((a, b) => {
    const t = a.ts.localeCompare(b.ts);
    if (t !== 0) return t;
    return (a.seq ?? 0) - (b.seq ?? 0);
  });
  let seq = 0;
  const normalized = sorted.map((e) => {
    seq += 1;
    return {
      ...e,
      session_id: sessionId,
      seq,
      id: `${sessionId}:${seq}:${randomUUID().slice(0, 8)}`,
    };
  });
  const body = normalized.map((e) => JSON.stringify(e)).join("\n") + "\n";
  writeFileSync(path, body, "utf-8");
  return path;
}

function writeRawSidecar(sessionId: string, source: string, raw: string): string {
  const outDir = getSessionsDir();
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const path = join(outDir, `${safeFilename(sessionId)}.${safeFilename(source)}.raw.jsonl`);
  writeFileSync(path, raw, "utf-8");
  return path;
}

interface SessionSelection {
  session_id: string;
  strategy: "explicit_merge" | "adapted_session_id" | "fingerprint_match" | "new_session";
  fingerprint_confidence?: number;
}

function chooseSessionId(adapted: AdaptedSession, mergeSessionId?: string): SessionSelection {
  if (mergeSessionId) {
    return {
      session_id: mergeSessionId,
      strategy: "explicit_merge",
    };
  }

  const adaptedSessionId = adapted.session_id?.trim();
  if (adaptedSessionId) {
    const existingPath = join(getSessionsDir(), `${safeFilename(adaptedSessionId)}.jsonl`);
    if (existsSync(existingPath)) {
      return {
        session_id: adaptedSessionId,
        strategy: "adapted_session_id",
      };
    }
  }

  const fingerprintMatch = findFingerprintSessionMatch(adapted);
  if (fingerprintMatch) {
    return {
      session_id: fingerprintMatch.session_id,
      strategy: "fingerprint_match",
      fingerprint_confidence: fingerprintMatch.confidence,
    };
  }

  if (adaptedSessionId) {
    return {
      session_id: adaptedSessionId,
      strategy: "new_session",
    };
  }

  return {
    session_id: `sess_${Date.now()}_${randomUUID().slice(0, 8)}`,
    strategy: "new_session",
  };
}

export interface IngestOptions {
  adapter?: string;
  merge_session_id?: string;
  dedupe?: boolean;
}

export interface IngestResult {
  session_id: string;
  adapter: string;
  inserted: number;
  skipped_duplicates: number;
  session_path: string;
  raw_path: string;
  merge_strategy: "explicit_merge" | "adapted_session_id" | "fingerprint_match" | "new_session";
  merge_confidence?: number;
}

export function ingestRawContent(raw: string, options: IngestOptions = {}): IngestResult {
  const adapted = adaptRawContent(raw, options.adapter ?? "auto");
  const sessionSelection = chooseSessionId(adapted, options.merge_session_id);
  const sessionId = sessionSelection.session_id;
  const existing = readSessionEvents(sessionId);
  const doDedupe = options.dedupe ?? true;
  const fallbackTs = new Date().toISOString();

  const isMerge = existing.length > 0;
  const existingSemanticKeys = new Set(existing.map((e) => semanticDedupeKey(e)));
  const existingExactKeys = new Set(existing.map((e) => dedupeKey(e)));

  let seq = existing.length > 0 ? Math.max(...existing.map((e) => e.seq)) : 0;
  let inserted = 0;
  let skipped = 0;
  const toInsert: CanonicalEvent[] = [];

  for (const event of adapted.events) {
    const candidate = buildCanonicalEvent(sessionId, seq + 1, event, fallbackTs);
    if (doDedupe) {
      if (isMerge && existingSemanticKeys.has(semanticDedupeKey(candidate))) {
        skipped += 1;
        continue;
      }
      if (!isMerge && existingExactKeys.has(dedupeKey(candidate))) {
        skipped += 1;
        continue;
      }
    }
    seq += 1;
    candidate.seq = seq;
    candidate.id = `${sessionId}:${seq}:${randomUUID().slice(0, 8)}`;
    toInsert.push(candidate);
    if (isMerge) existingSemanticKeys.add(semanticDedupeKey(candidate));
    else existingExactKeys.add(dedupeKey(candidate));
    inserted += 1;
  }

  let sessionPath: string;
  if (isMerge && toInsert.length > 0) {
    const combined = [...existing, ...toInsert];
    sessionPath = writeSessionFull(sessionId, combined);
  } else if (isMerge && toInsert.length === 0) {
    sessionPath = join(getSessionsDir(), `${safeFilename(sessionId)}.jsonl`);
  } else {
    sessionPath = writeEventsAppend(sessionId, toInsert);
  }

  const rawPath = writeRawSidecar(sessionId, adapted.source, raw);

  return {
    session_id: sessionId,
    adapter: adapted.source,
    inserted,
    skipped_duplicates: skipped,
    session_path: sessionPath,
    raw_path: rawPath,
    merge_strategy: sessionSelection.strategy,
    merge_confidence: sessionSelection.fingerprint_confidence,
  };
}

export function ingestRawFile(filePath: string, options: IngestOptions = {}): IngestResult {
  const raw = readFileSync(filePath, "utf-8");
  return ingestRawContent(raw, options);
}
