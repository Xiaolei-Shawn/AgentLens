import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { getSessionsDir } from "./config.js";
import { adaptRawContent } from "./adapters/index.js";
import type { AdaptedEvent, AdaptedSession } from "./adapters/types.js";
import type { CanonicalEvent } from "./event-envelope.js";
import { readSessionEvents } from "./store.js";

function safeFilename(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_");
}

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

function toIso(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
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

function writeRawSidecar(sessionId: string, source: string, raw: string): string {
  const outDir = getSessionsDir();
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const path = join(outDir, `${safeFilename(sessionId)}.${safeFilename(source)}.raw.jsonl`);
  writeFileSync(path, raw, "utf-8");
  return path;
}

function chooseSessionId(adapted: AdaptedSession, mergeSessionId?: string): string {
  if (mergeSessionId) return mergeSessionId;
  if (adapted.session_id && adapted.session_id.trim() !== "") return adapted.session_id;
  return `sess_${Date.now()}_${randomUUID().slice(0, 8)}`;
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
}

export function ingestRawContent(raw: string, options: IngestOptions = {}): IngestResult {
  const adapted = adaptRawContent(raw, options.adapter ?? "auto");
  const sessionId = chooseSessionId(adapted, options.merge_session_id);
  const existing = readSessionEvents(sessionId);
  const existingKeys = new Set(existing.map((e) => dedupeKey(e)));
  const doDedupe = options.dedupe ?? true;

  let seq = existing.length > 0 ? Math.max(...existing.map((e) => e.seq)) : 0;
  let inserted = 0;
  let skipped = 0;
  const toInsert: CanonicalEvent[] = [];
  const fallbackTs = new Date().toISOString();

  for (const event of adapted.events) {
    const candidate = buildCanonicalEvent(sessionId, seq + 1, event, fallbackTs);
    const key = dedupeKey(candidate);
    if (doDedupe && existingKeys.has(key)) {
      skipped += 1;
      continue;
    }
    seq += 1;
    candidate.seq = seq;
    candidate.id = `${sessionId}:${seq}:${randomUUID().slice(0, 8)}`;
    toInsert.push(candidate);
    existingKeys.add(key);
    inserted += 1;
  }

  const sessionPath = writeEventsAppend(sessionId, toInsert);
  const rawPath = writeRawSidecar(sessionId, adapted.source, raw);

  return {
    session_id: sessionId,
    adapter: adapted.source,
    inserted,
    skipped_duplicates: skipped,
    session_path: sessionPath,
    raw_path: rawPath,
  };
}

export function ingestRawFile(filePath: string, options: IngestOptions = {}): IngestResult {
  const raw = readFileSync(filePath, "utf-8");
  return ingestRawContent(raw, options);
}
