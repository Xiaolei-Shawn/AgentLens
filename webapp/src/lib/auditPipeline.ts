import type { CanonicalEvent } from "@xiaolei.shawn/schema/event-envelope";
import {
  type Suggestion,
} from "./actionRecommendationEngine";
import {
  deriveAssumptions as deriveAnalyzerAssumptions,
  deriveConfidence as deriveAnalyzerConfidence,
  deriveHotspots as deriveAnalyzerHotspots,
  deriveRecommendedActions as deriveAnalyzerRecommendedActions,
  deriveRisks as deriveAnalyzerRisks,
} from "./analyzer";

export type SessionOutcome = "completed" | "partial" | "failed" | "aborted" | "unknown";
type IntentStatus = "completed" | "partial" | "abandoned";
type BlastRadius = "small" | "medium" | "large";
type RiskLevel = "low" | "medium" | "high";
type RiskFactorKey =
  | "public_api_changed"
  | "schema_changed"
  | "dependency_changed"
  | "blast_radius_large"
  | "blast_radius_medium"
  | "high_risk_assumption"
  | "medium_risk_assumption"
  | "unknown_assumption"
  | "verification_missing"
  | "verification_failed"
  | "verification_partial"
  | "revision_high_churn"
  | "revision_create_delete"
  | "decision_hard_to_reverse"
  | "large_change_volume"
  | "failed_or_partial_outcome";

export interface SessionMetadata {
  session_id: string;
  goal: string;
  started_at?: string;
  ended_at?: string;
  outcome: SessionOutcome;
  repo?: string;
  branch?: string;
  token_usage?: TokenUsageSummary;
  schema_version: number;
}

export interface NormalizedIntent {
  id: string;
  title: string;
  description?: string;
  priority?: number;
  start_seq: number;
  end_seq: number;
  status: IntentStatus;
  event_ids: string[];
}

export interface NormalizedDecision {
  event_id: string;
  intent_id?: string;
  summary: string;
  rationale?: string;
  options?: string[];
  chosen_option?: string;
  reversibility?: "easy" | "medium" | "hard";
  ts: string;
}

export interface NormalizedAssumption {
  event_id: string;
  intent_id?: string;
  statement: string;
  validated: boolean | "unknown";
  risk?: "low" | "medium" | "high";
  ts: string;
}

export interface RevisionArtifact {
  id: string;
  intent_id?: string;
  type:
    | "repeat_file_edits"
    | "create_then_delete"
    | "large_change_after_recent_change"
    | "intent_superseded";
  file?: string;
  related_event_ids: string[];
  explanation: string;
  confidence: number;
}

export interface ImpactArtifact {
  id: string;
  intent_id?: string;
  files_touched: string[];
  modules_affected: string[];
  public_api_changed: boolean;
  dependency_added: boolean;
  schema_changed: boolean;
  lines_added: number;
  lines_removed: number;
  blast_radius: BlastRadius;
}

export interface RiskArtifact {
  id: string;
  intent_id?: string;
  level: RiskLevel;
  score: number;
  factors: Array<{ key: RiskFactorKey; score: number; reason: string }>;
  reasons: string[];
  mitigations: string[];
}

export interface VerificationArtifact {
  event_id: string;
  intent_id?: string;
  type: "test" | "lint" | "typecheck" | "manual";
  result: "pass" | "fail" | "unknown";
  details?: string;
  ts: string;
}

export interface ReviewHotspot {
  id: string;
  file: string;
  module?: string;
  score: number;
  edit_count: number;
  lines_changed: number;
  associated_decisions: number;
  associated_assumptions: number;
  criticality_hits: string[];
}

export interface SessionNormalized {
  metadata: SessionMetadata;
  intents: NormalizedIntent[];
  decisions: NormalizedDecision[];
  assumptions: NormalizedAssumption[];
  revisions: RevisionArtifact[];
  impacts: ImpactArtifact[];
  risks: RiskArtifact[];
  verifications: VerificationArtifact[];
  hotspots: ReviewHotspot[];
  raw_events: CanonicalEvent[];
}

export interface ReviewerIntentSummary {
  intent_id: string;
  title: string;
  status: IntentStatus;
  files_touched: number;
  risks: RiskLevel[];
}

export interface ReviewerVerificationSummary {
  pass: number;
  fail: number;
  unknown: number;
  coverage: "full" | "partial" | "none";
}

export interface TokenUsageSummary {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_usd?: number;
  by_category: Array<{ category: string; total_tokens: number }>;
  by_intent: Array<{ intent_id?: string; total_tokens: number }>;
}

export interface ReviewerView {
  goal: string;
  outcome: SessionOutcome;
  key_decisions: Array<{ summary: string; rationale?: string; intent_id?: string }>;
  high_risk_items: Array<{
    intent_id?: string;
    level: RiskLevel;
    score: number;
    reasons: string[];
    mitigations: string[];
  }>;
  hotspots: Array<{ file: string; score: number }>;
  intent_summaries: ReviewerIntentSummary[];
  verification_summary: ReviewerVerificationSummary;
  token_summary?: TokenUsageSummary;
  recommended_actions: Suggestion[];
  confidence_estimate: number;
}

export interface PipelineConfig {
  repeatedEditThreshold: number;
  largeChangeLineThreshold: number;
  recentChangeWindowMs: number;
  enableProInsights: boolean;
}

const defaultConfig: PipelineConfig = {
  repeatedEditThreshold: 3,
  largeChangeLineThreshold: 120,
  recentChangeWindowMs: 10 * 60 * 1000,
  enableProInsights: true,
};

interface IntentBoundary {
  intentId: string;
  eventIndex: number;
}

function toNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string" && v.trim() !== "") {
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toStringValue(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

function getPayload(event: CanonicalEvent): Record<string, unknown> {
  return event.payload ?? {};
}

function getIntentId(event: CanonicalEvent): string | undefined {
  const payloadIntent = toStringValue(getPayload(event).intent_id);
  return event.scope?.intent_id ?? payloadIntent;
}

function getFileTarget(event: CanonicalEvent): string | undefined {
  if (event.kind !== "file_op") return undefined;
  const payload = getPayload(event);
  return toStringValue(payload.target) ?? event.scope?.file;
}

function getModuleFromPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.length === 0 ? "root" : parts[0];
}

function getUsageFromEvent(event: CanonicalEvent): {
  model?: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_usd?: number;
} | null {
  const payload = getPayload(event);
  const usageRaw = payload.usage;
  const detailsRaw = payload.details;
  const nestedUsage =
    detailsRaw && typeof detailsRaw === "object"
      ? (detailsRaw as Record<string, unknown>).llm_usage
      : undefined;
  const usage =
    usageRaw && typeof usageRaw === "object"
      ? (usageRaw as Record<string, unknown>)
      : nestedUsage && typeof nestedUsage === "object"
        ? (nestedUsage as Record<string, unknown>)
        : null;
  if (!usage) return null;

  const prompt = toNumber(usage.prompt_tokens);
  const completion = toNumber(usage.completion_tokens);
  const totalRaw = toNumber(usage.total_tokens);
  const total = totalRaw > 0 ? totalRaw : prompt + completion;
  if (total <= 0 && prompt <= 0 && completion <= 0) return null;

  const estimatedCost = toNumber(usage.estimated_cost_usd);
  return {
    model: toStringValue(usage.model),
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
    estimated_cost_usd: estimatedCost > 0 ? estimatedCost : undefined,
  };
}

function deriveTokenUsageSummary(events: CanonicalEvent[]): TokenUsageSummary | undefined {
  let prompt = 0;
  let completion = 0;
  let total = 0;
  let cost = 0;
  let hasUsage = false;
  const categoryTotals = new Map<string, number>();
  const intentTotals = new Map<string, number>();

  for (const event of events) {
    const usage = getUsageFromEvent(event);
    if (!usage) continue;
    hasUsage = true;
    prompt += usage.prompt_tokens;
    completion += usage.completion_tokens;
    total += usage.total_tokens;
    if (usage.estimated_cost_usd != null) cost += usage.estimated_cost_usd;

    const payload = getPayload(event);
    const category =
      event.kind === "tool_call" || event.kind === "file_op"
        ? toStringValue(payload.category) ?? (event.kind === "file_op" ? "file" : "tool")
        : event.kind;
    categoryTotals.set(category, (categoryTotals.get(category) ?? 0) + usage.total_tokens);

    const intentId = getIntentId(event) ?? "session";
    intentTotals.set(intentId, (intentTotals.get(intentId) ?? 0) + usage.total_tokens);
  }

  if (!hasUsage) return undefined;

  const byCategory = [...categoryTotals.entries()]
    .map(([category, totalTokens]) => ({ category, total_tokens: totalTokens }))
    .sort((a, b) => b.total_tokens - a.total_tokens);
  const byIntent = [...intentTotals.entries()]
    .map(([intentId, totalTokens]) => ({
      intent_id: intentId === "session" ? undefined : intentId,
      total_tokens: totalTokens,
    }))
    .sort((a, b) => b.total_tokens - a.total_tokens);

  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: total,
    estimated_cost_usd: cost > 0 ? Number(cost.toFixed(6)) : undefined,
    by_category: byCategory,
    by_intent: byIntent,
  };
}

function parseOutcome(events: CanonicalEvent[]): SessionOutcome {
  const end = [...events].reverse().find((e) => e.kind === "session_end");
  if (!end) return "unknown";
  const raw = toStringValue(getPayload(end).outcome);
  return raw === "completed" || raw === "partial" || raw === "failed" || raw === "aborted"
    ? raw
    : "unknown";
}

function sortEvents(rawEvents: CanonicalEvent[]): CanonicalEvent[] {
  return [...rawEvents].sort((a, b) => {
    if (a.seq !== b.seq) return a.seq - b.seq;
    return a.ts.localeCompare(b.ts);
  });
}

function buildIntentBoundaries(events: CanonicalEvent[]): IntentBoundary[] {
  const boundaries: IntentBoundary[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.kind !== "intent") continue;
    const payload = getPayload(e);
    const intentId = getIntentId(e) ?? `intent_auto_${e.seq}`;
    boundaries.push({ intentId, eventIndex: i });
    if (!payload.intent_id) {
      payload.intent_id = intentId;
    }
  }
  return boundaries;
}

function assignIntentToEvent(
  event: CanonicalEvent,
  eventIndex: number,
  boundaries: IntentBoundary[],
  fallbackId: string
): string {
  const scoped = getIntentId(event);
  if (scoped) return scoped;
  let latest: IntentBoundary | undefined;
  for (const boundary of boundaries) {
    if (boundary.eventIndex <= eventIndex) latest = boundary;
    else break;
  }
  return latest?.intentId ?? fallbackId;
}

function computeIntentStatus(
  intentEvents: CanonicalEvent[],
  superseded: boolean,
  outcome: SessionOutcome
): IntentStatus {
  const hasWork = intentEvents.some((e) => e.kind === "file_op" || e.kind === "tool_call");
  const passVerification = intentEvents.some(
    (e) => e.kind === "verification" && toStringValue(getPayload(e).result) === "pass"
  );
  if (passVerification) return "completed";
  if (superseded && hasWork) return "abandoned";
  if (!hasWork) return outcome === "completed" ? "partial" : "abandoned";
  return "partial";
}

function deriveDecisions(events: CanonicalEvent[]): NormalizedDecision[] {
  return events
    .filter((e) => e.kind === "decision")
    .map((e) => {
      const payload = getPayload(e);
      return {
        event_id: e.id,
        intent_id: getIntentId(e),
        summary: toStringValue(payload.summary) ?? "Decision",
        rationale: toStringValue(payload.rationale),
        options: Array.isArray(payload.options) ? payload.options.map(String) : undefined,
        chosen_option: toStringValue(payload.chosen_option),
        reversibility:
          payload.reversibility === "easy" ||
          payload.reversibility === "medium" ||
          payload.reversibility === "hard"
            ? payload.reversibility
            : undefined,
        ts: e.ts,
      };
    });
}

function deriveAssumptions(events: CanonicalEvent[]): NormalizedAssumption[] {
  return deriveAnalyzerAssumptions(events);
}

function deriveVerifications(events: CanonicalEvent[]): VerificationArtifact[] {
  return events
    .filter((e) => e.kind === "verification")
    .map((e) => {
      const payload = getPayload(e);
      const type =
        payload.type === "test" ||
        payload.type === "lint" ||
        payload.type === "typecheck" ||
        payload.type === "manual"
          ? payload.type
          : "manual";
      const result =
        payload.result === "pass" || payload.result === "fail" || payload.result === "unknown"
          ? payload.result
          : "unknown";
      return {
        event_id: e.id,
        intent_id: getIntentId(e),
        type,
        result,
        details: toStringValue(payload.details),
        ts: e.ts,
      };
    });
}

function deriveRevisions(
  events: CanonicalEvent[],
  intents: NormalizedIntent[],
  cfg: PipelineConfig
): RevisionArtifact[] {
  const revisions: RevisionArtifact[] = [];
  const fileOps = events.filter((e) => e.kind === "file_op");
  const opsByFile = new Map<string, CanonicalEvent[]>();

  for (const op of fileOps) {
    const file = getFileTarget(op);
    if (!file) continue;
    const arr = opsByFile.get(file) ?? [];
    arr.push(op);
    opsByFile.set(file, arr);
  }

  for (const [file, ops] of opsByFile.entries()) {
    if (ops.length > cfg.repeatedEditThreshold) {
      revisions.push({
        id: `rev_repeat_${file}`,
        intent_id: getIntentId(ops[0]),
        type: "repeat_file_edits",
        file,
        related_event_ids: ops.map((e) => e.id),
        explanation: `${file} was modified ${ops.length} times (threshold ${cfg.repeatedEditThreshold}).`,
        confidence: 0.82,
      });
    }

    const created = ops.find((e) => toStringValue(getPayload(e).action) === "create");
    const deleted = ops.find((e) => toStringValue(getPayload(e).action) === "delete");
    if (created && deleted) {
      revisions.push({
        id: `rev_create_delete_${file}`,
        intent_id: getIntentId(deleted) ?? getIntentId(created),
        type: "create_then_delete",
        file,
        related_event_ids: [created.id, deleted.id],
        explanation: `${file} was created and later deleted in the same session.`,
        confidence: 0.92,
      });
    }

    for (let i = 1; i < ops.length; i++) {
      const prev = ops[i - 1];
      const curr = ops[i];
      const currPayload = getPayload(curr);
      const lines =
        toNumber(currPayload.lines_added) +
        toNumber(currPayload.lines_removed) +
        toNumber(currPayload.added) +
        toNumber(currPayload.removed);
      const dt = new Date(curr.ts).getTime() - new Date(prev.ts).getTime();
      if (lines >= cfg.largeChangeLineThreshold && dt >= 0 && dt <= cfg.recentChangeWindowMs) {
        revisions.push({
          id: `rev_large_quick_${file}_${curr.seq}`,
          intent_id: getIntentId(curr),
          type: "large_change_after_recent_change",
          file,
          related_event_ids: [prev.id, curr.id],
          explanation: `${file} had a large change (${lines} lines) shortly after an earlier change (${Math.round(
            dt / 1000
          )}s).`,
          confidence: 0.76,
        });
      }
    }
  }

  for (let i = 0; i < intents.length - 1; i++) {
    const current = intents[i];
    const next = intents[i + 1];
    if (current.status === "abandoned" || current.status === "partial") {
      revisions.push({
        id: `rev_supersede_${current.id}`,
        intent_id: current.id,
        type: "intent_superseded",
        related_event_ids: [...current.event_ids, ...next.event_ids].slice(0, 12),
        explanation: `Intent "${current.title}" was superseded by "${next.title}" before completion.`,
        confidence: 0.72,
      });
    }
  }

  return revisions;
}

function evaluateBlastRadius(data: {
  files: Set<string>;
  publicApi: boolean;
  dependency: boolean;
  schema: boolean;
}): BlastRadius {
  const fileCount = data.files.size;
  if (data.publicApi || data.schema || fileCount >= 10) return "large";
  if (data.dependency || fileCount >= 4) return "medium";
  return "small";
}

function deriveImpactForEvents(id: string, intentId: string | undefined, events: CanonicalEvent[]): ImpactArtifact {
  const files = new Set<string>();
  const modules = new Set<string>();
  let publicApi = false;
  let dependency = false;
  let schema = false;
  let linesAdded = 0;
  let linesRemoved = 0;

  for (const e of events) {
    if (e.kind !== "file_op") continue;
    const payload = getPayload(e);
    const file = getFileTarget(e);
    if (!file) continue;
    files.add(file);
    modules.add(getModuleFromPath(file));

    const lower = file.toLowerCase();
    if (
      lower.includes("/api/") ||
      lower.includes("/routes/") ||
      lower.includes("/controller") ||
      lower.endsWith("/index.ts")
    ) {
      publicApi = true;
    }
    if (
      lower.endsWith("/package.json") ||
      lower.endsWith("/pnpm-lock.yaml") ||
      lower.endsWith("/package-lock.json") ||
      lower.endsWith("/yarn.lock")
    ) {
      dependency = true;
    }
    if (
      lower.includes("/migrations/") ||
      lower.includes("/migration/") ||
      lower.endsWith(".sql") ||
      lower.includes("schema.prisma")
    ) {
      schema = true;
    }
    if (payload.dependency_added === true) dependency = true;

    linesAdded += toNumber(payload.lines_added) + toNumber(payload.added);
    linesRemoved += toNumber(payload.lines_removed) + toNumber(payload.removed);
  }

  const blastRadius = evaluateBlastRadius({
    files,
    publicApi,
    dependency,
    schema,
  });

  return {
    id,
    intent_id: intentId,
    files_touched: [...files],
    modules_affected: [...modules],
    public_api_changed: publicApi,
    dependency_added: dependency,
    schema_changed: schema,
    lines_added: linesAdded,
    lines_removed: linesRemoved,
    blast_radius: blastRadius,
  };
}

function deriveRisks(
  outcome: SessionOutcome,
  impacts: ImpactArtifact[],
  assumptions: NormalizedAssumption[],
  decisions: NormalizedDecision[],
  revisions: RevisionArtifact[],
  verifications: VerificationArtifact[]
): RiskArtifact[] {
  return deriveAnalyzerRisks(outcome, impacts, assumptions, decisions, revisions, verifications);
}

function deriveHotspots(
  events: CanonicalEvent[],
  decisions: NormalizedDecision[],
  assumptions: NormalizedAssumption[]
): ReviewHotspot[] {
  return deriveAnalyzerHotspots(events, decisions, assumptions);
}

function deriveVerificationSummary(verifications: VerificationArtifact[]): ReviewerVerificationSummary {
  const pass = verifications.filter((v) => v.result === "pass").length;
  const fail = verifications.filter((v) => v.result === "fail").length;
  const unknown = verifications.filter((v) => v.result === "unknown").length;
  const coverage: ReviewerVerificationSummary["coverage"] =
    verifications.length === 0 ? "none" : fail > 0 || unknown > 0 ? "partial" : "full";
  return { pass, fail, unknown, coverage };
}

export function normalizeSessionFromRawEvents(
  rawEvents: CanonicalEvent[],
  config: Partial<PipelineConfig> = {}
): SessionNormalized {
  const cfg: PipelineConfig = { ...defaultConfig, ...config };
  const events = sortEvents(rawEvents);
  const first = events[0];
  const payloadStart = events.find((e) => e.kind === "session_start");
  const startPayload = payloadStart ? getPayload(payloadStart) : {};
  const outcome = parseOutcome(events);
  const fallbackIntentId = "intent_fallback";
  const boundaries = buildIntentBoundaries(events);
  const eventsByIntent = new Map<string, CanonicalEvent[]>();

  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.kind === "session_start" || e.kind === "session_end") continue;
    const intentId = assignIntentToEvent(e, i, boundaries, fallbackIntentId);
    const list = eventsByIntent.get(intentId) ?? [];
    list.push(e);
    eventsByIntent.set(intentId, list);
  }

  const orderedIntentIds = [
    ...new Set([
      ...boundaries.map((b) => b.intentId),
      ...eventsByIntent.keys(),
    ]),
  ];

  const intents: NormalizedIntent[] = orderedIntentIds.map((intentId, idx) => {
    const intentEvents = eventsByIntent.get(intentId) ?? [];
    const intentEvent = intentEvents.find((e) => e.kind === "intent");
    const payload = intentEvent ? getPayload(intentEvent) : {};
    const startSeq = intentEvents[0]?.seq ?? boundaries[idx]?.eventIndex ?? 0;
    const endSeq = intentEvents[intentEvents.length - 1]?.seq ?? startSeq;
    const superseded = idx < orderedIntentIds.length - 1;
    return {
      id: intentId,
      title: toStringValue(payload.title) ?? (intentId === fallbackIntentId ? "Fallback intent" : intentId),
      description: toStringValue(payload.description),
      priority: toNumber(payload.priority) || undefined,
      start_seq: startSeq,
      end_seq: endSeq,
      status: computeIntentStatus(intentEvents, superseded, outcome),
      event_ids: intentEvents.map((e) => e.id),
    };
  });

  const decisions = deriveDecisions(events);
  const assumptions = cfg.enableProInsights ? deriveAssumptions(events) : [];
  const verifications = deriveVerifications(events);
  const revisions = deriveRevisions(events, intents, cfg);

  const impacts: ImpactArtifact[] = [];
  for (const intent of intents) {
    const intentEvents = (eventsByIntent.get(intent.id) ?? []).filter((e) => e.kind === "file_op");
    impacts.push(deriveImpactForEvents(`impact_${intent.id}`, intent.id, intentEvents));
  }
  impacts.push(deriveImpactForEvents("impact_session_total", undefined, events.filter((e) => e.kind === "file_op")));

  const risks = cfg.enableProInsights
    ? deriveRisks(outcome, impacts, assumptions, decisions, revisions, verifications)
    : [];
  const hotspots = cfg.enableProInsights ? deriveHotspots(events, decisions, assumptions) : [];
  const tokenUsage = deriveTokenUsageSummary(events);

  return {
    metadata: {
      session_id: first?.session_id ?? "unknown",
      goal: toStringValue(startPayload.goal) ?? "Unknown goal",
      started_at: payloadStart?.ts,
      ended_at: [...events].reverse().find((e) => e.kind === "session_end")?.ts,
      outcome,
      repo: toStringValue(startPayload.repo),
      branch: toStringValue(startPayload.branch),
      token_usage: tokenUsage,
      schema_version: first?.schema_version ?? 1,
    },
    intents,
    decisions,
    assumptions,
    revisions,
    impacts,
    risks,
    verifications,
    hotspots,
    raw_events: events,
  };
}

export function buildReviewerView(
  normalized: SessionNormalized,
  options: { enableProInsights?: boolean } = {}
): ReviewerView {
  const enableProInsights = options.enableProInsights ?? true;
  const verificationSummary = deriveVerificationSummary(normalized.verifications);
  const intentSummaries: ReviewerIntentSummary[] = normalized.intents.map((intent) => {
    const impact = normalized.impacts.find((i) => i.intent_id === intent.id);
    const risks = enableProInsights
      ? normalized.risks
          .filter((r) => r.intent_id === intent.id)
          .map((r) => r.level)
      : [];
    return {
      intent_id: intent.id,
      title: intent.title,
      status: intent.status,
      files_touched: impact?.files_touched.length ?? 0,
      risks,
    };
  });

  const highRiskItems = enableProInsights
    ? normalized.risks
        .filter((r) => r.level === "high")
        .sort((a, b) => b.score - a.score)
        .map((r) => ({
          intent_id: r.intent_id,
          level: r.level,
          score: r.score,
          reasons: r.reasons,
          mitigations: r.mitigations,
        }))
    : [];
  const recommendedActions = enableProInsights ? deriveAnalyzerRecommendedActions(normalized) : [];

  return {
    goal: normalized.metadata.goal,
    outcome: normalized.metadata.outcome,
    key_decisions: normalized.decisions.slice(0, 5).map((d) => ({
      summary: d.summary,
      rationale: d.rationale,
      intent_id: d.intent_id,
    })),
    high_risk_items: highRiskItems,
    hotspots: enableProInsights
      ? normalized.hotspots.slice(0, 8).map((h) => ({ file: h.file, score: h.score }))
      : [],
    intent_summaries: intentSummaries,
    verification_summary: verificationSummary,
    token_summary: normalized.metadata.token_usage,
    recommended_actions: recommendedActions,
    confidence_estimate: enableProInsights
      ? deriveAnalyzerConfidence(normalized, verificationSummary)
      : verificationSummary.coverage === "full"
        ? 0.8
        : verificationSummary.coverage === "partial"
          ? 0.6
          : 0.4,
  };
}

export interface PipelineResult {
  normalized: SessionNormalized;
  reviewer: ReviewerView;
}

export function runAuditPostProcessing(
  rawEvents: CanonicalEvent[],
  config?: Partial<PipelineConfig>
): PipelineResult {
  const normalized = normalizeSessionFromRawEvents(rawEvents, config);
  const reviewer = buildReviewerView(normalized, {
    enableProInsights: config?.enableProInsights ?? defaultConfig.enableProInsights,
  });
  return { normalized, reviewer };
}

export const EXAMPLE_RAW_EVENTS: CanonicalEvent[] = [
  {
    id: "e1",
    session_id: "sess_demo",
    seq: 1,
    ts: "2026-02-15T10:00:00.000Z",
    kind: "session_start",
    actor: { type: "agent" },
    payload: { goal: "Refactor audit pipeline", repo: "AL/webapp", branch: "codex/audit" },
    schema_version: 1,
  },
  {
    id: "e2",
    session_id: "sess_demo",
    seq: 2,
    ts: "2026-02-15T10:01:00.000Z",
    kind: "intent",
    actor: { type: "agent" },
    scope: { intent_id: "intent_a" },
    payload: { intent_id: "intent_a", title: "Build normalization layer", priority: 1 },
    schema_version: 1,
  },
  {
    id: "e3",
    session_id: "sess_demo",
    seq: 3,
    ts: "2026-02-15T10:02:00.000Z",
    kind: "file_op",
    actor: { type: "agent" },
    scope: { intent_id: "intent_a", file: "src/lib/auditPipeline.ts" },
    payload: {
      category: "file",
      action: "edit",
      target: "src/lib/auditPipeline.ts",
      lines_added: 220,
      lines_removed: 5,
    },
    schema_version: 1,
  },
  {
    id: "e4",
    session_id: "sess_demo",
    seq: 4,
    ts: "2026-02-15T10:03:00.000Z",
    kind: "decision",
    actor: { type: "agent" },
    scope: { intent_id: "intent_a" },
    payload: { summary: "Use rule-based scoring first", rationale: "Predictable reviewer UX" },
    schema_version: 1,
  },
  {
    id: "e5",
    session_id: "sess_demo",
    seq: 5,
    ts: "2026-02-15T10:04:00.000Z",
    kind: "verification",
    actor: { type: "agent" },
    scope: { intent_id: "intent_a" },
    payload: { type: "test", result: "pass", details: "npm run build" },
    schema_version: 1,
  },
  {
    id: "e6",
    session_id: "sess_demo",
    seq: 6,
    ts: "2026-02-15T10:05:00.000Z",
    kind: "session_end",
    actor: { type: "agent" },
    payload: { outcome: "completed", summary: "pipeline implemented" },
    schema_version: 1,
  },
];

export const EXAMPLE_TRANSFORMED = runAuditPostProcessing(EXAMPLE_RAW_EVENTS);
