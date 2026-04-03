import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { getSessionsDir } from "./config.js";
import type {
  ForensicAttachmentInput,
  ForensicAttachmentKind,
  ForensicAttachmentRecord,
  ForensicAttachmentSummary,
  ForensicSessionRecord,
  ForensicSessionSummary,
  ForensicSignal,
} from "../../schema/dist/forensic-inputs.js";
import type { OutboundEndpointType, TrustEventKind } from "../../schema/dist/trust-review.js";

type ForensicSource = "api" | "file_import" | "manual";

let writeQueue: Promise<void> = Promise.resolve();

function withWriteLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

interface AttachmentSummaryDraft {
  attachment_id: string;
  kind: ForensicAttachmentKind;
  source_label?: string;
  received_at: string;
  parsed_at: string;
  raw_format: "json";
  signal_count: number;
  signal_kinds: TrustEventKind[];
}

interface NormalizedAttachment {
  record: ForensicAttachmentRecord;
  summary: AttachmentSummaryDraft;
}

function sanitizeFileName(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return undefined;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => toString(item)).filter((item): item is string => Boolean(item));
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function coerceJsonInput(input: unknown): unknown {
  if (typeof input !== "string") return input;
  const text = input.trim();
  if (!text) return input;
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      return JSON.parse(text);
    } catch {
      return input;
    }
  }
  return input;
}

function getForensicDir(): string {
  return join(resolve(getSessionsDir()), "forensics");
}

function getForensicPath(sessionId: string): string {
  return join(getForensicDir(), `${sanitizeFileName(sessionId)}.json`);
}

function ensureForensicDir(): void {
  const dir = getForensicDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readForensicSessionRecord(sessionId: string): ForensicSessionRecord {
  const path = getForensicPath(sessionId);
  if (!existsSync(path)) {
    return {
      session_id: sessionId,
      updated_at: new Date().toISOString(),
      attachments: [],
    };
  }

  const raw = readFileSync(path, "utf-8").trim();
  if (!raw) {
    return {
      session_id: sessionId,
      updated_at: new Date().toISOString(),
      attachments: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      session_id: sessionId,
      updated_at: new Date().toISOString(),
      attachments: [],
    };
  }

  const session = isPlainObject(parsed) ? (parsed as Partial<ForensicSessionRecord>) : {};
  const attachments = Array.isArray(session.attachments)
    ? (session.attachments.filter(isNormalizedAttachmentRecord) as ForensicAttachmentRecord[])
    : [];

  return {
    session_id: typeof session.session_id === "string" && session.session_id.trim() !== "" ? session.session_id : sessionId,
    updated_at: typeof session.updated_at === "string" && session.updated_at.trim() !== "" ? session.updated_at : new Date().toISOString(),
    attachments,
  };
}

function writeForensicSessionRecord(record: ForensicSessionRecord): void {
  ensureForensicDir();
  const path = getForensicPath(record.session_id);
  const body = JSON.stringify(record, null, 2) + "\n";
  writeFileSync(path, body, "utf-8");
}

function isForensicAttachmentKind(value: unknown): value is ForensicAttachmentKind {
  return value === "config_snapshot" || value === "env_snapshot" || value === "proxy_trace";
}

function isNormalizedAttachmentRecord(value: unknown): value is ForensicAttachmentRecord {
  if (!isPlainObject(value)) return false;
  return (
    typeof value.attachment_id === "string" &&
    typeof value.session_id === "string" &&
    isForensicAttachmentKind(value.kind) &&
    typeof value.received_at === "string" &&
    typeof value.parsed_at === "string" &&
    value.raw_format === "json" &&
    Array.isArray(value.signals)
  );
}

function collectPlainObjects(value: unknown, seen = new Set<unknown>()): Record<string, unknown>[] {
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectPlainObjects(item, seen));
  }

  const record = value as Record<string, unknown>;
  const results: Record<string, unknown>[] = [record];
  for (const nested of Object.values(record)) {
    results.push(...collectPlainObjects(nested, seen));
  }
  return results;
}

function pickObject(root: Record<string, unknown>, keys: string[]): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = root[key];
    if (isPlainObject(value)) return value;
  }
  return undefined;
}

function readBooleanFromSources(sources: Array<Record<string, unknown> | undefined>, keys: string[]): boolean | undefined {
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const value = source[key];
      const bool = toBoolean(value);
      if (bool !== undefined) return bool;
    }
  }
  return undefined;
}

function readStringArrayFromSources(sources: Array<Record<string, unknown> | undefined>, keys: string[]): string[] {
  for (const source of sources) {
    if (!source) continue;
    for (const key of keys) {
      const value = toStringArray(source[key]);
      if (value.length > 0) return value;
    }
  }
  return [];
}

function createSignal(
  sessionId: string,
  attachment: Pick<ForensicAttachmentRecord, "attachment_id" | "kind" | "source_label">,
  seq: number,
  kind: TrustEventKind,
  payload: Record<string, unknown>,
  source: ForensicSource,
  confidence = 0.9,
  visibility: "debug" = "debug"
): ForensicSignal {
  return {
    id: `forensic:${attachment.attachment_id}:${seq}`,
    session_id: sessionId,
    seq,
    ts: new Date().toISOString(),
    kind,
    actor: { type: "system", id: "forensic-parser" },
    scope: { task_id: attachment.attachment_id },
    payload,
    derived: true,
    confidence,
    visibility,
    schema_version: 1,
    source: "forensic",
    provenance: {
      attachment_id: attachment.attachment_id,
      attachment_kind: attachment.kind,
      source_label: attachment.source_label,
      source,
    },
  };
}

function buildAttachmentSummary(record: ForensicAttachmentRecord): AttachmentSummaryDraft {
  const kinds = [...new Set(record.signals.map((signal: ForensicSignal) => signal.kind))].sort();
  return {
    attachment_id: record.attachment_id,
    kind: record.kind,
    source_label: record.source_label,
    received_at: record.received_at,
    parsed_at: record.parsed_at,
    raw_format: "json",
    signal_count: record.signals.length,
    signal_kinds: kinds,
  };
}

function normalizeConfigSnapshot(sessionId: string, input: ForensicAttachmentInput, source: ForensicSource): NormalizedAttachment {
  const receivedAt = new Date().toISOString();
  const parsedAt = new Date().toISOString();
  const attachment_id = `for_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const raw = coerceJsonInput(input.data);
  const roots = collectPlainObjects(raw);
  const root = roots.find((candidate) => Object.keys(candidate).length > 0) ?? (isPlainObject(raw) ? raw : {});
  const configSection = pickObject(root, ["config", "settings", "snapshot", "state"]);
  const policySection = pickObject(root, ["policy", "policies", "remote_policy"]);
  const telemetrySection = pickObject(root, ["telemetry"]);
  const networkSection = pickObject(root, ["network"]);
  const memorySection = pickObject(root, ["memory"]);
  const capabilitiesSection = pickObject(root, ["capabilities"]);
  const runtimeSection = pickObject(root, ["runtime"]);
  const featuresSection = pickObject(root, ["features", "feature_flags", "flags"]);

  const featureFlags = readStringArrayFromSources([featuresSection, configSection, root], ["enabled_features", "feature_flags", "flags"]);
  const configuredEndpoints = readStringArrayFromSources([networkSection, telemetrySection, policySection, root], ["endpoints", "targets", "urls"]);
  const policyManaged = readBooleanFromSources([policySection, root], ["policy_managed", "managed", "remote_policy_enabled"]) ?? false;
  const remoteSkillEnabled =
    readBooleanFromSources([capabilitiesSection, runtimeSection, root], ["remote_skill_enabled", "remote_skill", "skill_loading_enabled"]) ??
    false;
  const networkEnabled = readBooleanFromSources([networkSection, root], ["network_enabled"]) ?? configuredEndpoints.length > 0;
  const telemetryEnabled = readBooleanFromSources([telemetrySection, root], ["telemetry_enabled", "enabled"]) ?? undefined;
  const backgroundEnabled =
    readBooleanFromSources([runtimeSection, capabilitiesSection, root], ["background_worker_enabled", "background_enabled"]) ?? false;
  const silentBackground = readBooleanFromSources([runtimeSection, root], ["silent_background", "silent", "hidden"]) ?? false;
  const memoryRemoteSync = readBooleanFromSources([memorySection, root], ["remote_sync", "sync_enabled", "shared_memory_enabled"]) ?? false;
  const readsSessionHistory = readBooleanFromSources([runtimeSection, root], ["reads_session_history", "session_history_enabled"]) ?? false;

  const signals: ForensicSignal[] = [];
  let seq = 1;
  signals.push(
    createSignal(
      sessionId,
      { attachment_id, kind: input.kind, source_label: input.source_label },
      seq++,
      "capability_snapshot",
      {
        source: "config_snapshot",
        network_enabled: networkEnabled,
        policy_managed: policyManaged,
        remote_skill_enabled: remoteSkillEnabled,
        background_worker_enabled: backgroundEnabled,
        telemetry_enabled: telemetryEnabled,
        feature_flags_enabled: featureFlags,
        configured_endpoints: configuredEndpoints,
      },
      source
    )
  );

  if (policyManaged || telemetryEnabled === false || featureFlags.length > 0) {
    signals.push(
      createSignal(
        sessionId,
        { attachment_id, kind: input.kind, source_label: input.source_label },
        seq++,
        "policy_change",
        {
          source: "config_snapshot",
          key: policyManaged ? "policy.managed" : telemetryEnabled === false ? "telemetry.enabled" : "feature_flags",
          old_value: undefined,
          new_value: policyManaged ? true : telemetryEnabled === false ? false : featureFlags,
          user_notified: false,
          hot_reloaded: true,
          severity: policyManaged || telemetryEnabled === false ? "high" : "medium",
        },
        source
      )
    );
  }

  if (memoryRemoteSync) {
    signals.push(
      createSignal(
        sessionId,
        { attachment_id, kind: input.kind, source_label: input.source_label },
        seq++,
        "memory_op",
        {
          source: "config_snapshot",
          op: "sync",
          store: "team_memory",
          remote_sync: true,
          reads_session_history: readsSessionHistory,
        },
        source
      )
    );
  }

  if (backgroundEnabled || silentBackground || readsSessionHistory) {
    signals.push(
      createSignal(
        sessionId,
        { attachment_id, kind: input.kind, source_label: input.source_label },
        seq++,
        "background_activity",
        {
          source: "config_snapshot",
          worker_type: silentBackground ? "daemon" : "subagent",
          action: "spawn",
          visibility: silentBackground ? "silent" : "background",
          reads_session_history: readsSessionHistory,
          shares_api_credentials: policyManaged || remoteSkillEnabled,
        },
        source
      )
    );
  }

  if (signals.length === 0) {
    throw new Error("No usable forensic signals were derived from the config snapshot.");
  }

  return {
    record: {
      attachment_id,
      session_id: sessionId,
      kind: input.kind,
      source_label: input.source_label,
      data: raw,
      received_at: receivedAt,
      parsed_at: parsedAt,
      raw_format: "json",
      raw,
      signals,
    },
    summary: buildAttachmentSummary({
      attachment_id,
      session_id: sessionId,
      kind: input.kind,
      source_label: input.source_label,
      data: raw,
      received_at: receivedAt,
      parsed_at: parsedAt,
      raw_format: "json",
      raw,
      signals,
    }),
  };
}

function normalizeEnvSnapshot(sessionId: string, input: ForensicAttachmentInput, source: ForensicSource): NormalizedAttachment {
  const receivedAt = new Date().toISOString();
  const parsedAt = new Date().toISOString();
  const attachment_id = `for_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const raw = coerceJsonInput(input.data);
  const envRoot = isPlainObject(raw) && isPlainObject(raw.env) ? raw.env : isPlainObject(raw) && isPlainObject(raw.variables) ? raw.variables : isPlainObject(raw) ? raw : {};
  const normalizedEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(envRoot)) {
    const normalizedKey = key.trim().toUpperCase();
    if (!normalizedKey) continue;
    const stringValue = toString(value);
    if (stringValue !== undefined) {
      normalizedEnv[normalizedKey] = stringValue;
      continue;
    }
    const boolValue = toBoolean(value);
    if (boolValue !== undefined) {
      normalizedEnv[normalizedKey] = boolValue ? "true" : "false";
    }
  }

  const proxyKeys = Object.keys(normalizedEnv).filter((key) => /(^|_)(HTTP|HTTPS|ALL)_PROXY$/.test(key));
  const endpointKeys = Object.keys(normalizedEnv).filter((key) => /(BASE_URL|API_BASE|ENDPOINT|MODEL_URL|POLICY_URL)$/.test(key));
  const credentialKeys = Object.keys(normalizedEnv).filter((key) => /(_API_KEY|_TOKEN|_SECRET|_PASSWORD|_ACCESS_KEY)$/.test(key));
  const policyKeys = Object.keys(normalizedEnv).filter((key) => /(TELEMETRY|POLICY|FEATURE_FLAG|AUTO_UPDATE|REMOTE_SKILL|BACKGROUND|MEMORY|WATCHER)/.test(key));

  const telemetryDisabled =
    toBoolean(normalizedEnv.TELEMETRY_DISABLED) ??
    toBoolean(normalizedEnv.AL_TELEMETRY_DISABLED) ??
    toBoolean(normalizedEnv.MCP_TELEMETRY_DISABLED) ??
    false;
  const policyManaged =
    policyKeys.length > 0 ||
    toBoolean(normalizedEnv.AL_POLICY_MANAGED) === true ||
    toBoolean(normalizedEnv.MCP_POLICY_MANAGED) === true ||
    proxyKeys.length > 0;
  const remoteSkillEnabled =
    toBoolean(normalizedEnv.REMOTE_SKILL_ENABLED) === true ||
    toBoolean(normalizedEnv.AL_REMOTE_SKILL_ENABLED) === true;
  const backgroundEnabled =
    toBoolean(normalizedEnv.BACKGROUND_WORKER_ENABLED) === true ||
    toBoolean(normalizedEnv.AL_BACKGROUND_WORKER_ENABLED) === true ||
    toBoolean(normalizedEnv.WATCHER_ENABLED) === true ||
    toBoolean(normalizedEnv.AL_WATCHER_ENABLED) === true;
  const networkEnabled = proxyKeys.length > 0 || endpointKeys.length > 0 || credentialKeys.length > 0;

  const signals: ForensicSignal[] = [];
  let seq = 1;
  signals.push(
    createSignal(
      sessionId,
      { attachment_id, kind: input.kind, source_label: input.source_label },
      seq++,
      "capability_snapshot",
      {
        source: "env_snapshot",
        network_enabled: networkEnabled,
        policy_managed: policyManaged,
        remote_skill_enabled: remoteSkillEnabled,
        background_worker_enabled: backgroundEnabled,
        env_keys: Object.keys(normalizedEnv).sort(),
        configured_endpoints: endpointKeys.map((key) => normalizedEnv[key]).filter((value): value is string => Boolean(value)),
        credential_keys: credentialKeys,
      },
      source
    )
  );

  if (telemetryDisabled || policyKeys.length > 0 || proxyKeys.length > 0) {
    signals.push(
      createSignal(
        sessionId,
        { attachment_id, kind: input.kind, source_label: input.source_label },
        seq++,
        "policy_change",
        {
          source: "env_snapshot",
          key: telemetryDisabled ? "TELEMETRY_DISABLED" : policyKeys[0] ?? "proxy",
          old_value: undefined,
          new_value: telemetryDisabled ? true : policyKeys,
          user_notified: false,
          hot_reloaded: true,
          severity: telemetryDisabled || proxyKeys.length > 0 ? "high" : "medium",
          redacted_keys: [...new Set([...proxyKeys, ...endpointKeys, ...credentialKeys])],
        },
        source
      )
    );
  }

  if (backgroundEnabled) {
    signals.push(
      createSignal(
        sessionId,
        { attachment_id, kind: input.kind, source_label: input.source_label },
        seq++,
        "background_activity",
        {
          source: "env_snapshot",
          worker_type: "watcher",
          action: "spawn",
          visibility: "background",
          reads_session_history: false,
          shares_api_credentials: credentialKeys.length > 0,
        },
        source
      )
    );
  }

  if (signals.length === 0) {
    throw new Error("No usable forensic signals were derived from the env snapshot.");
  }

  return {
    record: {
      attachment_id,
      session_id: sessionId,
      kind: input.kind,
      source_label: input.source_label,
      data: raw,
      received_at: receivedAt,
      parsed_at: parsedAt,
      raw_format: "json",
      raw,
      signals,
    },
    summary: buildAttachmentSummary({
      attachment_id,
      session_id: sessionId,
      kind: input.kind,
      source_label: input.source_label,
      data: raw,
      received_at: receivedAt,
      parsed_at: parsedAt,
      raw_format: "json",
      raw,
      signals,
    }),
  };
}

function extractTraceEntries(raw: unknown): Record<string, unknown>[] {
  if (!isPlainObject(raw)) return [];
  const root = raw as Record<string, unknown>;
  const log = isPlainObject(root.log) ? root.log : undefined;
  const entries =
    (log && Array.isArray(log.entries) ? log.entries : undefined) ??
    (Array.isArray(root.entries) ? root.entries : undefined) ??
    (Array.isArray(root.requests) ? root.requests : undefined);
  if (!Array.isArray(entries)) return [];
  return entries.filter(isPlainObject);
}

function extractRequestLike(entry: Record<string, unknown>): Record<string, unknown> {
  const request = isPlainObject(entry.request) ? entry.request : entry;
  const postData = isPlainObject(request.postData) ? request.postData : undefined;
  return {
    ...request,
    postData: postData ?? request.postData,
    response: isPlainObject(entry.response) ? entry.response : undefined,
    startedDateTime: toString(entry.startedDateTime) ?? toString(request.startedDateTime),
    source_label: toString(entry.source_label) ?? toString(entry.sourceLabel) ?? toString(entry.source),
    user_visible: entry.user_visible,
    visibility: entry.visibility,
  };
}

function inferEndpointTypeFromUrl(url: string): OutboundEndpointType {
  const value = url.toLowerCase();
  if (value.includes("telemetry") || value.includes("analytics")) return "telemetry";
  if (value.includes("sentry") || value.includes("error")) return "error_reporting";
  if (value.includes("policy") || value.includes("feature") || value.includes("update")) return "policy";
  if (value.includes("memory") || value.includes("sync") || value.includes("storage")) return "storage";
  if (value.includes("api") || value.includes("model") || value.includes("anthropic") || value.includes("openai") || value.includes("gemini") || value.includes("llm")) {
    return "model_api";
  }
  return "unknown";
}

function inferContentVisibility(dataClasses: string[], explicit?: string): "full" | "summary" | "metadata_only" | "unknown" {
  const normalized = explicit?.toLowerCase();
  if (normalized === "full" || normalized === "summary" || normalized === "metadata_only" || normalized === "unknown") {
    return normalized;
  }
  if (dataClasses.some((item) => ["prompt", "file_content", "memory", "diff", "screenshot"].includes(item))) return "full";
  if (dataClasses.some((item) => ["usage", "metadata", "session_metadata"].includes(item))) return "metadata_only";
  if (dataClasses.length > 0) return "summary";
  return "unknown";
}

function addDataClass(classes: Set<string>, value: unknown): void {
  const text = toString(value)?.toLowerCase();
  if (!text) return;
  if (text.includes("prompt") || text.includes("messages") || text.includes("input")) classes.add("prompt");
  if (text.includes("file") || text.includes("path") || text.includes("content")) classes.add("file_content");
  if (text.includes("memory")) classes.add("memory");
  if (text.includes("diff")) classes.add("diff");
  if (text.includes("screenshot") || text.includes("image")) classes.add("screenshot");
  if (text.includes("usage") || text.includes("token")) classes.add("usage");
  if (text.includes("metadata")) classes.add("metadata");
}

function collectDataClasses(value: unknown, classes = new Set<string>(), depth = 0): Set<string> {
  if (!value || depth > 5) return classes;
  if (typeof value === "string") {
    addDataClass(classes, value);
    if (value.trim().startsWith("{") || value.trim().startsWith("[")) {
      try {
        collectDataClasses(JSON.parse(value), classes, depth + 1);
      } catch {
        // Ignore parse failures and fall back to keyword checks.
      }
    }
    return classes;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectDataClasses(item, classes, depth + 1);
    return classes;
  }
  if (!isPlainObject(value)) return classes;

  for (const [key, nested] of Object.entries(value)) {
    addDataClass(classes, key);
    addDataClass(classes, nested);
    collectDataClasses(nested, classes, depth + 1);
  }
  return classes;
}

function normalizeProxyTrace(sessionId: string, input: ForensicAttachmentInput, source: ForensicSource): NormalizedAttachment {
  const receivedAt = new Date().toISOString();
  const parsedAt = new Date().toISOString();
  const attachment_id = `for_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const raw = coerceJsonInput(input.data);
  const entries = extractTraceEntries(raw);
  const signals: ForensicSignal[] = [];
  let seq = 1;

  for (const entry of entries) {
    const request = extractRequestLike(entry);
    const endpoint = toString(request.url) ?? toString(request.endpoint) ?? toString(request.uri);
    if (!endpoint) continue;

    const requestBody = request.postData && isPlainObject(request.postData) ? request.postData.text ?? request.postData.json ?? request.postData.body : undefined;
    const payloadCandidates = [requestBody, request.body, request.payload, request.data];
    const dataClasses = [...new Set(payloadCandidates.flatMap((candidate) => [...collectDataClasses(candidate)]))].sort();
    const method = toString(request.method) ?? "GET";
    const status = isPlainObject(request.response)
      ? toNumber(request.response.status) ?? toNumber(request.response.statusCode)
      : undefined;
    const bytesOut = toNumber(request.requestBodySize) ?? toNumber(request.bodySize) ?? toNumber(entry.requestBodySize);
    const bytesIn = isPlainObject(request.response)
      ? toNumber(request.response.bodySize) ?? toNumber(request.response.contentSize)
      : undefined;
    const userVisible = toBoolean(request.user_visible) ?? toBoolean(request.visible) ?? toBoolean(entry.user_visible) ?? true;
    const visibility = inferContentVisibility(dataClasses, toString(request.visibility));

    signals.push(
      createSignal(
        sessionId,
        { attachment_id, kind: input.kind, source_label: input.source_label },
        seq++,
        "network_egress",
        {
          source: "proxy_trace",
          endpoint,
          endpoint_type: inferEndpointTypeFromUrl(endpoint),
          method,
          status,
          data_classes: dataClasses,
          content_visibility: visibility,
          user_visible: userVisible,
          transport: endpoint.startsWith("https://") ? "https" : endpoint.startsWith("ws://") || endpoint.startsWith("wss://") ? "ws" : "unknown",
          bytes_out: bytesOut,
          bytes_in: bytesIn,
        },
        source,
        0.95
      )
    );
  }

  if (signals.length === 0) {
    throw new Error("No usable forensic signals were derived from the proxy trace.");
  }

  return {
    record: {
      attachment_id,
      session_id: sessionId,
      kind: input.kind,
      source_label: input.source_label,
      data: raw,
      received_at: receivedAt,
      parsed_at: parsedAt,
      raw_format: "json",
      raw,
      signals,
    },
    summary: buildAttachmentSummary({
      attachment_id,
      session_id: sessionId,
      kind: input.kind,
      source_label: input.source_label,
      data: raw,
      received_at: receivedAt,
      parsed_at: parsedAt,
      raw_format: "json",
      raw,
      signals,
    }),
  };
}

function normalizeAttachment(sessionId: string, input: ForensicAttachmentInput, source: ForensicSource): NormalizedAttachment {
  if (input.kind === "config_snapshot") return normalizeConfigSnapshot(sessionId, input, source);
  if (input.kind === "env_snapshot") return normalizeEnvSnapshot(sessionId, input, source);
  if (input.kind === "proxy_trace") return normalizeProxyTrace(sessionId, input, source);
  throw new Error(`Unsupported forensic attachment kind: ${String(input.kind)}`);
}

function summarizeSessionRecord(record: ForensicSessionRecord): ForensicSessionSummary {
  const attachments = record.attachments.map((attachment: ForensicAttachmentRecord) => buildAttachmentSummary(attachment));
  return {
    session_id: record.session_id,
    updated_at: record.updated_at,
    attachment_count: attachments.length,
    signal_count: record.attachments.reduce((sum: number, attachment: ForensicAttachmentRecord) => sum + attachment.signals.length, 0),
    attachments,
  };
}

function rebaseForensicSignals(attachments: ForensicAttachmentRecord[]): ForensicSignal[] {
  const signals: ForensicSignal[] = [];
  let seq = 1;
  for (const attachment of attachments) {
    for (const signal of attachment.signals) {
      signals.push({
        ...signal,
        seq,
      });
      seq += 1;
    }
  }
  return signals;
}

export function attachForensicInputsToSession(
  sessionId: string,
  inputs: ForensicAttachmentInput[],
  source: ForensicSource = "api"
): Promise<ForensicSessionSummary> {
  if (inputs.length === 0) {
    throw new Error("No forensic inputs provided.");
  }

  const normalizedAttachments = inputs.map((input) => normalizeAttachment(sessionId, input, source).record);

  return withWriteLock(() => {
    const existing = readForensicSessionRecord(sessionId).attachments;
    const dedupedExisting = existing.filter((item) => !normalizedAttachments.some((attachment) => attachment.attachment_id === item.attachment_id));
    const record = {
      session_id: sessionId,
      updated_at: new Date().toISOString(),
      attachments: [...dedupedExisting, ...normalizedAttachments],
    };
    writeForensicSessionRecord(record);
    return summarizeSessionRecord(record);
  });
}

export function getForensicSessionSummary(sessionId: string): ForensicSessionSummary {
  return summarizeSessionRecord(readForensicSessionRecord(sessionId));
}

export function getForensicSignalsForSession(sessionId: string): ForensicSignal[] {
  const record = readForensicSessionRecord(sessionId);
  return rebaseForensicSignals(record.attachments);
}

export function getForensicAttachmentsForSession(sessionId: string): ForensicAttachmentRecord[] {
  return readForensicSessionRecord(sessionId).attachments;
}

export function normalizeForensicAttachmentInputs(body: Record<string, unknown>): ForensicAttachmentInput[] {
  const rawAttachments: unknown[] =
    Array.isArray(body.attachments) ? body.attachments :
    Array.isArray(body.inputs) ? body.inputs :
    body.attachment && isPlainObject(body.attachment) ? [body.attachment] :
    isPlainObject(body) && "kind" in body ? [body] :
    [];

  return rawAttachments.flatMap((item: unknown) => {
    if (!isPlainObject(item)) return [];
    const kind = item.kind;
    if (!isForensicAttachmentKind(kind)) return [];
    const sourceLabel = toString(item.source_label) ?? toString(item.sourceLabel) ?? toString(item.label);
    const data =
      Object.prototype.hasOwnProperty.call(item, "data")
        ? item.data
        : Object.prototype.hasOwnProperty.call(item, "payload")
          ? item.payload
          : Object.prototype.hasOwnProperty.call(item, "raw")
            ? item.raw
            : undefined;
    if (data === undefined) return [];
    return [
      {
        kind,
        source_label: sourceLabel,
        data,
      },
    ];
  });
}

export function attachForensicAttachmentsFromBody(
  sessionId: string,
  body: Record<string, unknown>,
  source: ForensicSource = "api"
): Promise<ForensicSessionSummary> {
  const inputs = normalizeForensicAttachmentInputs(body);
  if (inputs.length === 0) {
    throw new Error("No valid forensic inputs were provided.");
  }
  return attachForensicInputsToSession(sessionId, inputs, source);
}
