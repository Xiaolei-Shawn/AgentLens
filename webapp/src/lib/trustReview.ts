import type {
  OutboundMatrixRow as SchemaTrustOutboundRow,
  SafetyModeId,
  SafetyModeResult as SchemaTrustSafetyModeResult,
  TrustEvidenceRef,
  TrustEvidenceSource,
  TrustFinding as SchemaTrustFinding,
  TrustSeverity,
  TrustSummary,
  TransparencyDiff as SchemaInlineTransparencyDiff,
} from "@xiaolei.shawn/schema/trust-review";

export type TrustState = "loading" | "ready" | "empty" | "degraded" | "error";
export type TrustDiffKind = "prompt" | "tool" | "memory" | "system" | "summary" | "other";
export type { TrustEvidenceRef, TrustEvidenceSource, TrustSeverity, TrustSummary };

export interface TrustOutboundRow extends SchemaTrustOutboundRow {
  source?: TrustEvidenceSource;
  sources?: TrustEvidenceSource[];
}

export interface TrustFinding extends SchemaTrustFinding {
  source?: TrustEvidenceSource;
  sources?: TrustEvidenceSource[];
}

export interface TrustSafetyModeResult extends Omit<SchemaTrustSafetyModeResult, "mode_id"> {
  mode_id: SchemaTrustSafetyModeResult["mode_id"] | string;
}

export interface TrustTransparencyDiff {
  id: string;
  kind: TrustDiffKind;
  title: string;
  before?: string;
  after?: string;
  note?: string;
  event_ids: string[];
  evidence_sources?: TrustEvidenceSource[];
  evidence_refs?: TrustEvidenceRef[];
}

export interface TrustDegradedState {
  insufficient_signals: boolean;
  reasons: string[];
}

export interface TrustReviewResponse {
  session_id: string;
  summary: TrustSummary;
  outbound_matrix: TrustOutboundRow[];
  control_surface: TrustFinding[];
  transparency_findings: TrustFinding[];
  safety_modes?: TrustSafetyModeResult[];
  transparency_diffs?: TrustTransparencyDiff[];
  degraded?: TrustDegradedState;
  evidence_index?: Record<string, string[]>;
}

export class TrustApiError extends Error {
  status: number;
  payload: Record<string, unknown> | null;

  constructor(message: string, status: number, payload: Record<string, unknown> | null = null) {
    super(message);
    this.name = "TrustApiError";
    this.status = status;
    this.payload = payload;
  }
}

const API_BASE =
  (import.meta.env.VITE_AUDIT_API_BASE as string | undefined)?.trim() ?? "";

async function readJsonLike(response: Response): Promise<Record<string, unknown>> {
  const raw = await response.text();
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return { error: `Non-JSON response (${response.status}).` };
  }
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Trust response missing required field: ${field}`);
  }
  return value;
}

function assertArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Trust response missing required array: ${field}`);
  }
  return value;
}

function normalizeEvidenceSource(value: unknown): TrustEvidenceSource | undefined {
  if (value !== "canonical" && value !== "forensic") {
    return undefined;
  }
  return value;
}

function normalizeEvidenceSources(value: unknown): TrustEvidenceSource[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const sources = value.map(normalizeEvidenceSource).filter((item): item is TrustEvidenceSource => Boolean(item));
  return sources.length > 0 ? [...new Set(sources)] : undefined;
}

function normalizeEvidenceRef(value: unknown, path: string): TrustEvidenceRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Trust response contains an invalid evidence ref at ${path}`);
  }
  const item = value as Record<string, unknown>;
  const source = normalizeEvidenceSource(item.source);
  if (!source) {
    throw new Error(`Trust response contains an invalid evidence source at ${path}.source`);
  }
  return {
    ref_id: assertString(item.ref_id, `${path}.ref_id`),
    source,
    label: assertString(item.label, `${path}.label`),
    attachment_id: typeof item.attachment_id === "string" ? item.attachment_id : undefined,
    attachment_kind: typeof item.attachment_kind === "string" ? item.attachment_kind : undefined,
    source_label: typeof item.source_label === "string" ? item.source_label : undefined,
  };
}

function normalizeEvidenceRefs(value: unknown, path: string): TrustEvidenceRef[] | undefined {
  if (value == null) return undefined;
  const refs = assertArray(value, path).map((entry, index) => normalizeEvidenceRef(entry, `${path}[${index}]`));
  return refs.length > 0 ? refs : undefined;
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function parseTrustReviewResponse(payload: Record<string, unknown>): TrustReviewResponse {
  const summary = payload.summary;
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    throw new Error("Trust response missing required field: summary");
  }

  const summaryObj = summary as Record<string, unknown>;
  const normalizedTransparencyFindings = assertArray(payload.transparency_findings, "transparency_findings").map((finding, index) =>
    normalizeFinding(finding, `transparency_findings[${index}]`)
  );

  const response: TrustReviewResponse = {
    session_id: assertString(payload.session_id, "session_id"),
    summary: {
      verdict: (assertString(summaryObj.verdict, "summary.verdict") as TrustSeverity),
      score: typeof summaryObj.score === "number" ? summaryObj.score : Number(summaryObj.score ?? 0),
      reasons: assertArray(summaryObj.reasons, "summary.reasons").map((reason, index) => {
        if (typeof reason !== "string") {
          throw new Error(`Trust response contains a non-string reason at summary.reasons[${index}]`);
        }
        return reason;
      }),
    },
    outbound_matrix: assertArray(payload.outbound_matrix, "outbound_matrix").map((row, index) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new Error(`Trust response contains an invalid outbound row at outbound_matrix[${index}]`);
      }
      const item = row as Record<string, unknown>;
      const evidenceSources =
        normalizeEvidenceSources(item.evidence_sources) ??
        normalizeEvidenceSources(item.sources) ??
        normalizeEvidenceSources(item.source ? [item.source] : undefined) ??
        normalizeEvidenceSources(item.evidence_source ? [item.evidence_source] : undefined);
      return {
        endpoint: assertString(item.endpoint, `outbound_matrix[${index}].endpoint`),
        endpoint_type: assertString(item.endpoint_type, `outbound_matrix[${index}].endpoint_type`) as TrustOutboundRow["endpoint_type"],
        data_classes: assertArray(item.data_classes, `outbound_matrix[${index}].data_classes`).map((value, classIndex) => {
          if (typeof value !== "string") {
            throw new Error(`Trust response contains a non-string data class at outbound_matrix[${index}].data_classes[${classIndex}]`);
          }
          return value;
          }),
        content_visibility: assertString(item.content_visibility, `outbound_matrix[${index}].content_visibility`) as TrustOutboundRow["content_visibility"],
        user_visible: Boolean(item.user_visible),
        risk_level: assertString(item.risk_level, `outbound_matrix[${index}].risk_level`) as TrustSeverity,
        event_ids: assertArray(item.event_ids, `outbound_matrix[${index}].event_ids`).map((value, eventIndex) => {
          if (typeof value !== "string") {
            throw new Error(`Trust response contains a non-string event id at outbound_matrix[${index}].event_ids[${eventIndex}]`);
          }
          return value;
        }),
        evidence_sources: evidenceSources,
        evidence_refs: normalizeEvidenceRefs(item.evidence_refs, `outbound_matrix[${index}].evidence_refs`),
        source: evidenceSources?.[0],
        sources: evidenceSources,
      };
    }),
    control_surface: assertArray(payload.control_surface, "control_surface").map((finding, index) => normalizeFinding(finding, `control_surface[${index}]`)),
    transparency_findings: normalizedTransparencyFindings,
    safety_modes: normalizeSafetyModes(
      payload.safety_modes ?? payload.safety_mode_results ?? payload.mode_results ?? payload.modes,
    ),
    transparency_diffs:
      normalizeTransparencyDiffs(
      payload.transparency_diffs ??
        payload.transparency_diff ??
        payload.diffs ??
        payload.change_log ??
        payload.change_logs,
      ) ??
      deriveTransparencyDiffsFromFindings(normalizedTransparencyFindings),
    degraded: normalizeDegraded(payload.degraded),
    evidence_index: normalizeEvidenceIndex(payload.evidence_index),
  };

  return response;
}

function normalizeFinding(value: unknown, path: string): TrustFinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Trust response contains an invalid finding at ${path}`);
  }
  const item = value as Record<string, unknown>;
  const evidenceSources =
    normalizeEvidenceSources(item.evidence_sources) ??
    normalizeEvidenceSources(item.sources) ??
    normalizeEvidenceSources(item.source ? [item.source] : undefined) ??
    normalizeEvidenceSources(item.evidence_source ? [item.evidence_source] : undefined);
  return {
    id: assertString(item.id, `${path}.id`),
    category: assertString(item.category, `${path}.category`) as TrustFinding["category"],
    severity: assertString(item.severity, `${path}.severity`) as TrustSeverity,
    title: assertString(item.title, `${path}.title`),
    summary: assertString(item.summary, `${path}.summary`),
    event_ids: assertArray(item.event_ids, `${path}.event_ids`).map((eventId, index) => {
      if (typeof eventId !== "string") {
        throw new Error(`Trust response contains a non-string event id at ${path}.event_ids[${index}]`);
      }
      return eventId;
    }),
    evidence_sources: evidenceSources,
    evidence_refs: normalizeEvidenceRefs(item.evidence_refs, `${path}.evidence_refs`),
    mode_ids: Array.isArray(item.mode_ids)
      ? item.mode_ids
          .map((value) => normalizeSafetyModeId(value))
          .filter((value): value is SafetyModeId => Boolean(value))
      : undefined,
    failure_reason_codes: Array.isArray(item.failure_reason_codes)
      ? item.failure_reason_codes.filter((value): value is string => typeof value === "string")
      : undefined,
    transparency_diff: normalizeInlineTransparencyDiff(item.transparency_diff) as TrustFinding["transparency_diff"],
    source: evidenceSources?.[0],
    sources: evidenceSources,
  };
}

function normalizeSafetyMode(value: unknown, path: string): TrustSafetyModeResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Trust response contains an invalid safety mode at ${path}`);
  }
  const item = value as Record<string, unknown>;
  const evidenceSources =
    normalizeEvidenceSources(item.evidence_sources) ??
    normalizeEvidenceSources(item.sources) ??
    normalizeEvidenceSources(item.source ? [item.source] : undefined) ??
    normalizeEvidenceSources(item.evidence_source ? [item.evidence_source] : undefined);
  return {
    mode_id: assertString(item.mode_id ?? item.id, `${path}.mode_id`),
    status:
      (toOptionalString(item.status) as TrustSafetyModeResult["status"] | undefined) ??
      (Boolean(item.passed) ? "pass" : "fail"),
    title: assertString(item.title ?? item.mode_id ?? item.id, `${path}.title`),
    summary:
      toOptionalString(item.summary) ??
      toOptionalString(item.reason) ??
      toOptionalString(item.description) ??
      "No summary returned.",
    event_ids: assertArray(item.event_ids, `${path}.event_ids`).map((eventId, index) => {
      if (typeof eventId !== "string") {
        throw new Error(`Trust response contains a non-string event id at ${path}.event_ids[${index}]`);
      }
      return eventId;
    }),
    failure_reason_codes: Array.isArray(item.failure_reason_codes)
      ? item.failure_reason_codes.filter((value): value is string => typeof value === "string")
      : assertArray(item.reasons ?? [], `${path}.failure_reason_codes`).filter((value): value is string => typeof value === "string"),
    evidence_sources: evidenceSources,
    evidence_refs: normalizeEvidenceRefs(item.evidence_refs, `${path}.evidence_refs`),
  };
}

function normalizeSafetyModes(value: unknown): TrustSafetyModeResult[] | undefined {
  if (value == null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error("Trust response contains an invalid safety_modes block");
  }
  const modes = value.map((item, index) => normalizeSafetyMode(item, `safety_modes[${index}]`));
  return modes.length > 0 ? modes : undefined;
}

function normalizeTransparencyDiff(value: unknown, path: string): TrustTransparencyDiff {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Trust response contains an invalid transparency diff at ${path}`);
  }
  const item = value as Record<string, unknown>;
  const evidenceSources =
    normalizeEvidenceSources(item.evidence_sources) ??
    normalizeEvidenceSources(item.sources) ??
    normalizeEvidenceSources(item.source ? [item.source] : undefined) ??
    normalizeEvidenceSources(item.evidence_source ? [item.evidence_source] : undefined);
  const before =
    toOptionalString(item.before) ??
    toOptionalString(item.before_text) ??
    toOptionalString(item.before_value) ??
    toOptionalString(item.before_excerpt);
  const after =
    toOptionalString(item.after) ??
    toOptionalString(item.after_text) ??
    toOptionalString(item.after_value) ??
    toOptionalString(item.after_excerpt);
  const note =
    toOptionalString(item.note) ??
    toOptionalString(item.summary) ??
    toOptionalString(item.reason);
  const kindValue = toOptionalString(item.kind) ?? toOptionalString(item.type) ?? "other";
  const kind =
    kindValue === "prompt" ||
    kindValue === "tool" ||
    kindValue === "memory" ||
    kindValue === "system" ||
    kindValue === "summary"
      ? kindValue
      : "other";
  return {
    id: assertString(item.id, `${path}.id`),
    kind,
    title: assertString(item.title, `${path}.title`),
    before,
    after,
    note,
    event_ids: assertArray(item.event_ids, `${path}.event_ids`).map((eventId, index) => {
      if (typeof eventId !== "string") {
        throw new Error(`Trust response contains a non-string event id at ${path}.event_ids[${index}]`);
      }
      return eventId;
    }),
    evidence_sources: evidenceSources,
    evidence_refs: normalizeEvidenceRefs(item.evidence_refs, `${path}.evidence_refs`),
  };
}

function normalizeTransparencyDiffs(value: unknown): TrustTransparencyDiff[] | undefined {
  if (value == null) return undefined;

  const pushMany = (input: unknown, path: string, target: TrustTransparencyDiff[]) => {
    if (!Array.isArray(input)) {
      throw new Error(`Trust response contains an invalid transparency diff block at ${path}`);
    }
    input.forEach((item, index) => target.push(normalizeTransparencyDiff(item, `${path}[${index}]`)));
  };

  const diffs: TrustTransparencyDiff[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => diffs.push(normalizeTransparencyDiff(item, `transparency_diffs[${index}]`)));
    return diffs.length > 0 ? diffs : undefined;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Trust response contains an invalid transparency_diffs block");
  }

  const item = value as Record<string, unknown>;
  const arrays = [
    item.diffs,
    item.changes,
    item.items,
  ];
  for (const entry of arrays) {
    if (Array.isArray(entry)) {
      pushMany(entry, "transparency_diffs.items", diffs);
    }
  }

  const sectionKinds: TrustDiffKind[] = ["prompt", "tool", "memory", "system", "summary", "other"];
  let sawSection = false;
  for (const kind of sectionKinds) {
    const section = item[kind];
    if (Array.isArray(section)) {
      sawSection = true;
      section.forEach((entry, index) => {
        const normalized = normalizeTransparencyDiff(entry, `transparency_diffs.${kind}[${index}]`);
        diffs.push({
          ...normalized,
          kind: normalized.kind === "other" ? kind : normalized.kind,
        });
      });
    }
  }
  if (sawSection) {
    return diffs.length > 0 ? diffs : undefined;
  }

  if (item.id && typeof item.id === "string") {
    diffs.push(normalizeTransparencyDiff(item, "transparency_diffs"));
    return diffs.length > 0 ? diffs : undefined;
  }

  return undefined;
}

function normalizeInlineTransparencyDiff(value: unknown): SchemaInlineTransparencyDiff | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const item = value as Record<string, unknown>;
  return {
    diff_type: normalizeInlineDiffType(item.diff_type),
    before: toOptionalString(item.before),
    after: toOptionalString(item.after),
    before_excerpt: toOptionalString(item.before_excerpt),
    after_excerpt: toOptionalString(item.after_excerpt),
    before_hash: toOptionalString(item.before_hash),
    after_hash: toOptionalString(item.after_hash),
  };
}

function normalizeSafetyModeId(value: unknown): SafetyModeId | undefined {
  if (
    value === "local_only" ||
    value === "no_telemetry" ||
    value === "no_remote_policy" ||
    value === "no_silent_background_work" ||
    value === "transparent_prompting"
  ) {
    return value;
  }
  return undefined;
}

function normalizeInlineDiffType(value: unknown): SchemaInlineTransparencyDiff["diff_type"] {
  switch (value) {
    case "prompt_transform":
    case "memory_injection":
    case "summary_rewrite":
    case "tool_injection":
    case "identity_masking":
      return value;
    default:
      return "unknown";
  }
}

function mapDiffKind(value: string | undefined): TrustDiffKind {
  switch (value) {
    case "prompt_transform":
      return "prompt";
    case "tool_injection":
      return "tool";
    case "memory_injection":
      return "memory";
    case "identity_masking":
      return "system";
    case "summary_rewrite":
      return "summary";
    default:
      return "other";
  }
}

function deriveTransparencyDiffsFromFindings(findings: TrustFinding[]): TrustTransparencyDiff[] | undefined {
  const diffs = findings
    .filter((finding) => finding.transparency_diff)
    .map((finding) => {
      const diff = finding.transparency_diff!;
      return {
        id: finding.id,
        kind: mapDiffKind(diff.diff_type),
        title: finding.title,
        before: diff.before ?? diff.before_excerpt,
        after: diff.after ?? diff.after_excerpt,
        note: finding.summary,
        event_ids: finding.event_ids,
        evidence_sources: finding.evidence_sources,
        evidence_refs: finding.evidence_refs,
      } satisfies TrustTransparencyDiff;
    });
  return diffs.length > 0 ? diffs : undefined;
}

function normalizeDegraded(value: unknown): TrustDegradedState | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Trust response contains an invalid degraded block");
  }
  const item = value as Record<string, unknown>;
  const reasons = assertArray(item.reasons, "degraded.reasons").map((reason, index) => {
    if (typeof reason !== "string") {
      throw new Error(`Trust response contains a non-string degraded reason at degraded.reasons[${index}]`);
    }
    return reason;
  });
  return {
    insufficient_signals: Boolean(item.insufficient_signals),
    reasons,
  };
}

function normalizeEvidenceIndex(value: unknown): Record<string, string[]> | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Trust response contains an invalid evidence_index block");
  }
  const normalized: Record<string, string[]> = {};
  for (const [key, ids] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(ids)) {
      throw new Error(`Trust response contains a non-array evidence index entry for ${key}`);
    }
    normalized[key] = ids.map((id, index) => {
      if (typeof id !== "string") {
        throw new Error(`Trust response contains a non-string event id at evidence_index.${key}[${index}]`);
      }
      return id;
    });
  }
  return normalized;
}

export async function fetchTrustReview(
  sessionId: string,
  options?: { signal?: AbortSignal },
): Promise<TrustReviewResponse> {
  const response = await fetch(
    `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/trust`,
    {
      method: "GET",
      signal: options?.signal,
    },
  );

  const payload = await readJsonLike(response);
  if (!response.ok) {
    throw new TrustApiError(
      typeof payload.error === "string"
        ? payload.error
        : `Trust analysis request failed (${response.status}).`,
      response.status,
      payload,
    );
  }

  return parseTrustReviewResponse(payload);
}

export function getEventIndexById(eventIds: { id: string }[], eventId: string): number | null {
  const index = eventIds.findIndex((event) => event.id === eventId);
  return index >= 0 ? index : null;
}
