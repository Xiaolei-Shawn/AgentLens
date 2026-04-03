import type { CanonicalEvent } from "./event-envelope.js";
import type { ForensicSignal } from "../../schema/dist/forensic-inputs.js";
import type {
  OutboundContentVisibility,
  OutboundEndpointType,
  OutboundMatrixRow,
  SafetyModeId,
  SafetyModeResult,
  TrustEvidenceRef,
  TrustEvidenceSource,
  TrustAnalysisResult,
  TrustFinding,
  TrustVerdict,
  TransparencyDiff,
} from "../../schema/dist/trust-review.js";

type EvidenceIndex = Map<string, Set<string>>;

interface EvidenceEvent {
  id: string;
  source?: "forensic";
  provenance?: Partial<ForensicSignal["provenance"]>;
}

interface TrustEventInput extends CanonicalEvent, EvidenceEvent {
  source?: "forensic";
  provenance?: Partial<ForensicSignal["provenance"]>;
}

interface OutboundCandidate {
  endpoint: string;
  endpoint_type: OutboundEndpointType;
  content_visibility: OutboundContentVisibility;
  data_classes: string[];
  user_visible: boolean;
  event_id: string;
  source: TrustEvidenceSource;
  evidence_ref: TrustEvidenceRef;
  provenance?: Partial<ForensicSignal["provenance"]>;
}

interface TrustFindingDraft extends TrustFinding {}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return undefined;
}

function toString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => toString(item)).filter((item): item is string => Boolean(item));
}

function eventSource(event: EvidenceEvent): TrustEvidenceSource {
  return event.source === "forensic" ? "forensic" : "canonical";
}

function eventProvenance(event: EvidenceEvent): Partial<ForensicSignal["provenance"]> | undefined {
  return event.source === "forensic" ? event.provenance : undefined;
}

function payload(event: TrustEventInput): Record<string, unknown> {
  return (event.payload ?? {}) as Record<string, unknown>;
}

function addEvidence(index: EvidenceIndex, event: EvidenceEvent, label: string): void {
  const eventId = event.id;
  if (!index.has(eventId)) {
    index.set(eventId, new Set<string>());
  }
  const bucket = index.get(eventId);
  bucket?.add(label);
  bucket?.add(`source:${eventSource(event)}`);
  const provenance = eventProvenance(event);
  if (provenance?.attachment_id) {
    bucket?.add(`attachment:${provenance.attachment_id}`);
  }
  if (provenance?.attachment_kind) {
    bucket?.add(`attachment_kind:${provenance.attachment_kind}`);
  }
}

function buildEvidenceRef(event: EvidenceEvent, label: string): TrustEvidenceRef {
  const provenance = eventProvenance(event);
  return {
    ref_id: event.id,
    source: eventSource(event),
    label,
    attachment_id: provenance?.attachment_id,
    attachment_kind: provenance?.attachment_kind,
    source_label: provenance?.source_label,
  };
}

function inferEndpointType(hint: string): OutboundEndpointType {
  const value = hint.toLowerCase();
  if (value.includes("telemetry") || value.includes("analytics")) return "telemetry";
  if (value.includes("sentry") || value.includes("error")) return "error_reporting";
  if (value.includes("policy") || value.includes("feature") || value.includes("update")) return "policy";
  if (value.includes("memory") || value.includes("sync") || value.includes("storage")) return "storage";
  if (
    value.includes("api") ||
    value.includes("model") ||
    value.includes("anthropic") ||
    value.includes("openai") ||
    value.includes("gemini") ||
    value.includes("llm")
  ) {
    return "model_api";
  }
  return "unknown";
}

function inferContentVisibility(dataClasses: string[], explicit?: string): OutboundContentVisibility {
  const normalized = explicit?.toLowerCase();
  if (normalized === "full" || normalized === "summary" || normalized === "metadata_only" || normalized === "unknown") {
    return normalized;
  }
  if (dataClasses.some((item) => ["prompt", "file_content", "memory", "diff", "screenshot"].includes(item))) {
    return "full";
  }
  if (dataClasses.some((item) => ["usage", "metadata", "session_metadata"].includes(item))) {
    return "metadata_only";
  }
  return "unknown";
}

function inferDataClasses(event: TrustEventInput): string[] {
  const p = payload(event);
  const classes = new Set<string>();
  const explicit = toStringArray(p.data_classes);
  for (const item of explicit) classes.add(item);

  if (event.kind === "network_egress") {
    if (p.usage && typeof p.usage === "object") classes.add("usage");
    if (Array.isArray(p.files)) classes.add("file_content");
    if (Array.isArray(p.paths)) classes.add("file_path");
    if (Array.isArray(p.memory)) classes.add("memory");
    if (Array.isArray(p.diff)) classes.add("diff");
  }

  if (event.kind === "tool_call") {
    const details = p.details && typeof p.details === "object" ? (p.details as Record<string, unknown>) : {};
    if (typeof details.prompt === "string") classes.add("prompt");
    if (typeof details.file_content === "string") classes.add("file_content");
    if (typeof details.memory === "string") classes.add("memory");
    if (typeof details.diff === "string") classes.add("diff");
    if (typeof details.screenshot === "string") classes.add("screenshot");
  }

  if (event.kind === "memory_op") {
    classes.add("memory");
  }

  return [...classes];
}

function getOutboundCandidate(event: TrustEventInput): OutboundCandidate | null {
  const p = payload(event);
  if (event.kind === "network_egress") {
    const endpoint = toString(p.endpoint) ?? toString(p.url) ?? toString(p.target);
    if (!endpoint) return null;
    const dataClasses = inferDataClasses(event);
    return {
      endpoint,
      endpoint_type: inferEndpointType(toString(p.endpoint_type) ?? endpoint),
      content_visibility: inferContentVisibility(dataClasses, toString(p.content_visibility)),
      data_classes: dataClasses,
      user_visible: toBoolean(p.user_visible) ?? true,
      event_id: event.id,
      source: eventSource(event),
      evidence_ref: buildEvidenceRef(event, `outbound:${toString(p.endpoint_type) ?? endpoint}`),
      provenance: eventProvenance(event),
    };
  }

  if (event.kind !== "tool_call" && event.kind !== "artifact_created") return null;

  const details = p.details && typeof p.details === "object" ? (p.details as Record<string, unknown>) : {};
  const endpoints = [
    toString(p.endpoint),
    toString(p.url),
    toString(p.target),
    toString(details.endpoint),
    toString(details.url),
    toString(details.target),
    toString(details.host),
    toString(details.uri),
  ].filter((item): item is string => Boolean(item));

  const endpoint = endpoints.find((value) => /https?:\/\//i.test(value) || value.includes("."));
  if (!endpoint) return null;

  const endpointTypeHint =
    toString(p.endpoint_type) ??
    toString(details.endpoint_type) ??
    toString(p.category) ??
    toString(p.action) ??
    endpoint;

  const dataClasses = inferDataClasses(event);
  return {
    endpoint,
    endpoint_type: inferEndpointType(endpointTypeHint),
    content_visibility: inferContentVisibility(dataClasses, toString(p.content_visibility) ?? toString(details.content_visibility)),
    data_classes: dataClasses,
    user_visible: true,
    event_id: event.id,
    source: eventSource(event),
    evidence_ref: buildEvidenceRef(event, `outbound:${endpointTypeHint}`),
    provenance: eventProvenance(event),
  };
}

function mergeOutboundRows(candidates: OutboundCandidate[], evidenceIndex: EvidenceIndex): OutboundMatrixRow[] {
  const rows = new Map<string, OutboundMatrixRow>();

  for (const candidate of candidates) {
    const key = [candidate.endpoint, candidate.endpoint_type, candidate.content_visibility].join("|");
    const existing = rows.get(key);
    if (!existing) {
      rows.set(key, {
        endpoint: candidate.endpoint,
        endpoint_type: candidate.endpoint_type,
        data_classes: [...candidate.data_classes],
        content_visibility: candidate.content_visibility,
        user_visible: candidate.user_visible,
        event_ids: [candidate.event_id],
        risk_level: outboundRisk(candidate),
        evidence_sources: [candidate.source],
        evidence_refs: [candidate.evidence_ref],
      });
      addEvidence(
        evidenceIndex,
        { id: candidate.event_id, source: candidate.source === "forensic" ? "forensic" : undefined, provenance: candidate.provenance },
        `outbound:${candidate.endpoint_type}:${candidate.endpoint}`
      );
      continue;
    }

    existing.data_classes = [...new Set([...existing.data_classes, ...candidate.data_classes])];
    existing.event_ids.push(candidate.event_id);
    existing.user_visible = existing.user_visible && candidate.user_visible;
    existing.risk_level = higherVerdict(existing.risk_level, outboundRisk(candidate));
    existing.evidence_sources = [...new Set([...(existing.evidence_sources ?? []), candidate.source])];
    existing.evidence_refs = dedupeEvidenceRefs([...(existing.evidence_refs ?? []), candidate.evidence_ref]);
    addEvidence(
      evidenceIndex,
      { id: candidate.event_id, source: candidate.source === "forensic" ? "forensic" : undefined, provenance: candidate.provenance },
      `outbound:${candidate.endpoint_type}:${candidate.endpoint}`
    );
  }

  return [...rows.values()].sort((a, b) =>
    a.endpoint === b.endpoint ? a.endpoint_type.localeCompare(b.endpoint_type) : a.endpoint.localeCompare(b.endpoint)
  );
}

function outboundRisk(candidate: OutboundCandidate): TrustVerdict {
  if (candidate.endpoint_type === "unknown") return "high";
  if (candidate.endpoint_type === "policy") return candidate.content_visibility === "metadata_only" ? "medium" : "high";
  if (candidate.endpoint_type === "model_api") {
    return candidate.data_classes.some((item) => ["prompt", "file_content", "memory", "diff"].includes(item))
      ? "high"
      : "medium";
  }
  if (candidate.endpoint_type === "telemetry" || candidate.endpoint_type === "error_reporting") {
    return candidate.content_visibility === "metadata_only" ? "low" : "medium";
  }
  if (candidate.endpoint_type === "storage") {
    return candidate.data_classes.some((item) => ["memory", "file_content"].includes(item)) ? "medium" : "low";
  }
  return "medium";
}

function higherVerdict(a: TrustVerdict, b: TrustVerdict): TrustVerdict {
  const rank: Record<TrustVerdict, number> = { low: 0, medium: 1, high: 2 };
  return rank[b] > rank[a] ? b : a;
}

function dedupeEvidenceRefs(refs: TrustEvidenceRef[]): TrustEvidenceRef[] {
  const byKey = new Map<string, TrustEvidenceRef>();
  for (const ref of refs) {
    const key = [ref.ref_id, ref.source, ref.label, ref.attachment_id ?? "", ref.attachment_kind ?? "", ref.source_label ?? ""].join("|");
    if (!byKey.has(key)) byKey.set(key, ref);
  }
  return [...byKey.values()];
}

function toExcerpt(value: unknown): string | undefined {
  const text = toString(value);
  if (!text) return undefined;
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function toTransparencyDiffType(transformType: string): TransparencyDiff["diff_type"] {
  if (transformType === "system_injection") return "identity_masking";
  if (transformType === "tool_injection") return "tool_injection";
  if (transformType === "summary_rewrite") return "summary_rewrite";
  if (transformType === "prompt_transform") return "prompt_transform";
  if (transformType === "memory_injection") return "memory_injection";
  return "unknown";
}

function buildTransparencyDiff(event: TrustEventInput): TransparencyDiff | undefined {
  const p = payload(event);
  const before = toString(p.before) ?? toString(p.before_text) ?? toString(p.previous) ?? toString(p.original);
  const after = toString(p.after) ?? toString(p.after_text) ?? toString(p.current) ?? toString(p.transformed);
  const beforeHash = toString(p.before_hash) ?? toString(p.previous_hash);
  const afterHash = toString(p.after_hash) ?? toString(p.current_hash);
  const beforeExcerpt = toExcerpt(p.before_excerpt ?? p.before_preview ?? before);
  const afterExcerpt = toExcerpt(p.after_excerpt ?? p.after_preview ?? after);
  const transformType = toString(p.transform_type) ?? "unknown";
  if (!before && !after && !beforeExcerpt && !afterExcerpt && !beforeHash && !afterHash) {
    return {
      diff_type: toTransparencyDiffType(transformType),
    };
  }
  return {
    diff_type: toTransparencyDiffType(transformType),
    before,
    after,
    before_excerpt: beforeExcerpt,
    after_excerpt: afterExcerpt,
    before_hash: beforeHash,
    after_hash: afterHash,
  };
}

function listEventIdsFromRefs(refs: TrustEvidenceRef[]): string[] {
  return [...new Set(refs.map((ref) => ref.ref_id))];
}

function makeSafetyEvidenceRefs(
  modeId: SafetyModeId,
  refs: TrustEvidenceRef[],
  fallbackEventIds: string[] = []
): TrustEvidenceRef[] {
  if (refs.length > 0) return dedupeEvidenceRefs(refs);
  return fallbackEventIds.map((eventId) => ({ ref_id: eventId, source: "canonical", label: `mode:${modeId}` }));
}

function deriveControlSurfaceFindings(events: TrustEventInput[], evidenceIndex: EvidenceIndex): TrustFindingDraft[] {
  const findings: TrustFindingDraft[] = [];

  for (const event of events) {
    const p = payload(event);
    if (event.kind === "policy_change") {
      const source = toString(p.source) ?? "unknown";
      const severity: TrustVerdict =
        source === "remote_policy" || source === "auto_update" || p.user_notified === false || p.severity === "high"
          ? "high"
          : source === "feature_flag" || source === "env_override"
            ? "medium"
            : "low";
      const finding: TrustFindingDraft = {
        id: `control:${event.id}`,
        category: "control_surface",
        severity,
        title: "Policy change detected",
        summary: `Policy source ${source} modified session behavior for key ${toString(p.key) ?? "unknown"}.`,
        event_ids: [event.id],
        evidence_sources: [eventSource(event)],
        evidence_refs: [buildEvidenceRef(event, "policy_change")],
        mode_ids: ["no_remote_policy", "local_only"],
        failure_reason_codes: [
          source === "remote_policy" ? "remote_policy" : undefined,
          source === "auto_update" ? "auto_update" : undefined,
          p.user_notified === false ? "silent_policy_change" : undefined,
        ].filter((item): item is string => Boolean(item)),
      };
      findings.push(finding);
      addEvidence(evidenceIndex, event, `finding:${finding.id}`);
      continue;
    }

    if (event.kind === "capability_snapshot") {
      const tools = Array.isArray(p.tools) ? (p.tools as Array<Record<string, unknown>>) : [];
      const remoteSkillEnabled = toBoolean(p.remote_skill_enabled) === true;
      const policyManaged = toBoolean(p.policy_managed) === true;
      const networkEnabled = toBoolean(p.network_enabled) === true;
      if (remoteSkillEnabled || policyManaged || networkEnabled) {
        const finding: TrustFindingDraft = {
          id: `control:${event.id}`,
          category: "control_surface",
          severity: remoteSkillEnabled || policyManaged ? "high" : "medium",
          title: "Managed capabilities were enabled",
          summary: [
            policyManaged ? "Policy-managed controls were active." : null,
            remoteSkillEnabled ? "Remote skill loading was enabled." : null,
            networkEnabled ? "Network access was enabled." : null,
            tools.length > 0 ? `${tools.length} capability entries were advertised.` : null,
          ]
            .filter(Boolean)
            .join(" "),
          event_ids: [event.id],
          evidence_sources: [eventSource(event)],
          evidence_refs: [buildEvidenceRef(event, "capability_snapshot")],
          mode_ids: ["no_remote_policy", "local_only"],
          failure_reason_codes: [
            remoteSkillEnabled ? "remote_skill_loading_enabled" : undefined,
            policyManaged ? "policy_managed_controls_enabled" : undefined,
            networkEnabled ? "network_enabled" : undefined,
          ].filter((item): item is string => Boolean(item)),
        };
        findings.push(finding);
        addEvidence(evidenceIndex, event, `finding:${finding.id}`);
      }
      continue;
    }

    if (event.kind === "memory_op" && toBoolean(p.remote_sync) === true) {
      const finding: TrustFindingDraft = {
        id: `control:${event.id}`,
        category: "control_surface",
        severity: "high",
        title: "Remote memory sync detected",
        summary: `Memory store ${toString(p.store) ?? "unknown"} synced to a remote target.`,
        event_ids: [event.id],
        evidence_sources: [eventSource(event)],
        evidence_refs: [buildEvidenceRef(event, "memory_op")],
        mode_ids: ["local_only", "transparent_prompting"],
        failure_reason_codes: ["remote_memory_sync"],
      };
      findings.push(finding);
      addEvidence(evidenceIndex, event, `finding:${finding.id}`);
      continue;
    }

    if (event.kind === "background_activity" && toString(p.visibility) === "silent") {
      const finding: TrustFindingDraft = {
        id: `control:${event.id}`,
        category: "control_surface",
        severity: "medium",
        title: "Silent background activity detected",
        summary: `Background worker ${toString(p.worker_type) ?? "unknown"} ran without foreground visibility.`,
        event_ids: [event.id],
        evidence_sources: [eventSource(event)],
        evidence_refs: [buildEvidenceRef(event, "background_activity")],
        mode_ids: ["no_silent_background_work", "transparent_prompting", "local_only"],
        failure_reason_codes: ["silent_background_activity"],
      };
      findings.push(finding);
      addEvidence(evidenceIndex, event, `finding:${finding.id}`);
    }

    if (event.kind === "remote_code_load") {
      const finding: TrustFindingDraft = {
        id: `control:${event.id}`,
        category: "control_surface",
        severity: "high",
        title: "Remote code or skill load detected",
        summary: `Remote code source ${toString(p.source) ?? "unknown"} loaded ${toString(p.uri) ?? "unknown"}.`,
        event_ids: [event.id],
        evidence_sources: [eventSource(event)],
        evidence_refs: [buildEvidenceRef(event, "remote_code_load")],
        mode_ids: ["local_only", "no_remote_policy"],
        failure_reason_codes: ["remote_code_load_detected"],
      };
      findings.push(finding);
      addEvidence(evidenceIndex, event, `finding:${finding.id}`);
    }
  }

  return mergeFindings(findings);
}

function deriveTransparencyFindings(events: TrustEventInput[], evidenceIndex: EvidenceIndex): TrustFindingDraft[] {
  const findings: TrustFindingDraft[] = [];

  for (const event of events) {
    const p = payload(event);
    if (event.kind === "prompt_transform") {
      const opaque = toBoolean(p.opaque) === true;
      const transformType = toString(p.transform_type) ?? "unknown";
      const failureReasonCodes = [
        opaque ? "opaque_prompt_transform" : undefined,
        transformType === "system_injection" ? "system_prompt_injection" : undefined,
        transformType === "tool_injection" ? "tool_prompt_injection" : undefined,
        transformType === "summary_rewrite" ? "summary_rewrite" : undefined,
      ].filter((item): item is string => Boolean(item));
      const finding: TrustFindingDraft = {
        id: `transparency:${event.id}`,
        category: "transparency",
        severity: opaque || transformType === "system_injection" || transformType === "tool_injection" ? "high" : "medium",
        title: "Prompt transform detected",
        summary: `Prompt transform of type ${transformType} was applied${opaque ? " opaquely" : ""}.`,
        event_ids: [event.id],
        evidence_sources: [eventSource(event)],
        evidence_refs: [buildEvidenceRef(event, "prompt_transform")],
        mode_ids: ["transparent_prompting"],
        failure_reason_codes: failureReasonCodes,
        transparency_diff: buildTransparencyDiff(event),
      };
      findings.push(finding);
      addEvidence(evidenceIndex, event, `finding:${finding.id}`);
      continue;
    }

    if (event.kind === "memory_op" && toString(p.op) === "inject") {
      const failureReasonCodes = [
        "memory_context_injection",
        toBoolean(p.remote_sync) === true ? "remote_memory_sync" : undefined,
      ].filter((item): item is string => Boolean(item));
      const finding: TrustFindingDraft = {
        id: `transparency:${event.id}`,
        category: "transparency",
        severity: toBoolean(p.remote_sync) === true ? "high" : "medium",
        title: "Memory was injected into session context",
        summary: `Memory store ${toString(p.store) ?? "unknown"} injected data classes ${(toStringArray(p.data_classes).join(", ") || "unknown")}.`,
        event_ids: [event.id],
        evidence_sources: [eventSource(event)],
        evidence_refs: [buildEvidenceRef(event, "memory_op")],
        mode_ids: ["transparent_prompting"],
        failure_reason_codes: failureReasonCodes,
        transparency_diff: {
          diff_type: "memory_injection",
          before_excerpt: toExcerpt(p.before_excerpt ?? p.before),
          after_excerpt: toExcerpt(p.after_excerpt ?? p.after ?? p.data_classes),
          before_hash: toString(p.before_hash),
          after_hash: toString(p.after_hash),
        },
      };
      findings.push(finding);
      addEvidence(evidenceIndex, event, `finding:${finding.id}`);
      continue;
    }

    if (event.kind === "background_activity" && toString(p.visibility) === "silent" && toBoolean(p.reads_session_history) === true) {
      const failureReasonCodes = ["silent_session_history_scan", "background_visibility_hidden"];
      const finding: TrustFindingDraft = {
        id: `transparency:${event.id}`,
        category: "transparency",
        severity: "high",
        title: "Silent session-history scan detected",
        summary: `Background worker ${toString(p.worker_type) ?? "unknown"} read session history without user-visible execution.`,
        event_ids: [event.id],
        evidence_sources: [eventSource(event)],
        evidence_refs: [buildEvidenceRef(event, "background_activity")],
        mode_ids: ["transparent_prompting", "no_silent_background_work"],
        failure_reason_codes: failureReasonCodes,
      };
      findings.push(finding);
      addEvidence(evidenceIndex, event, `finding:${finding.id}`);
    }
  }

  return mergeFindings(findings);
}

function mergeFindings(findings: TrustFindingDraft[]): TrustFindingDraft[] {
  const byKey = new Map<string, TrustFindingDraft>();
  for (const finding of findings) {
    const existing = byKey.get(finding.id);
    if (!existing) {
      byKey.set(finding.id, {
        ...finding,
        event_ids: [...finding.event_ids],
        evidence_sources: [...(finding.evidence_sources ?? [])],
        evidence_refs: [...(finding.evidence_refs ?? [])],
        mode_ids: [...(finding.mode_ids ?? [])],
        failure_reason_codes: [...(finding.failure_reason_codes ?? [])],
      });
      continue;
    }
    existing.severity = higherVerdict(existing.severity, finding.severity);
    existing.summary = existing.summary === finding.summary ? existing.summary : `${existing.summary} ${finding.summary}`.trim();
    existing.event_ids = [...new Set([...existing.event_ids, ...finding.event_ids])];
    existing.evidence_sources = [...new Set([...(existing.evidence_sources ?? []), ...(finding.evidence_sources ?? [])])];
    existing.evidence_refs = dedupeEvidenceRefs([...(existing.evidence_refs ?? []), ...(finding.evidence_refs ?? [])]);
    existing.mode_ids = [...new Set([...(existing.mode_ids ?? []), ...(finding.mode_ids ?? [])])];
    existing.failure_reason_codes = [...new Set([...(existing.failure_reason_codes ?? []), ...(finding.failure_reason_codes ?? [])])];
    if (!existing.transparency_diff && finding.transparency_diff) {
      existing.transparency_diff = finding.transparency_diff;
    }
  }
  return [...byKey.values()];
}

function collectEvidenceRefsFromRows(rows: OutboundMatrixRow[]): TrustEvidenceRef[] {
  return rows.flatMap((row) => row.evidence_refs ?? []);
}

function collectEvidenceRefsFromFindings(findings: TrustFinding[]): TrustEvidenceRef[] {
  return findings.flatMap((finding) => finding.evidence_refs ?? []);
}

function collectEventIdsFromFindings(findings: TrustFinding[]): string[] {
  return [...new Set(findings.flatMap((finding) => finding.event_ids))];
}

function hasFindingCode(findings: TrustFinding[], code: string): boolean {
  return findings.some((finding) => finding.failure_reason_codes?.includes(code));
}

function hasTransparencyTransform(findings: TrustFinding[]): boolean {
  return findings.some((finding) => finding.category === "transparency" && finding.mode_ids?.includes("transparent_prompting"));
}

function deriveSafetyModes(
  events: TrustEventInput[],
  outboundMatrix: OutboundMatrixRow[],
  controlSurface: TrustFindingDraft[],
  transparencyFindings: TrustFindingDraft[]
): SafetyModeResult[] {
  const telemetryConfiguredEventIds = events
    .filter((event) => {
      const p = payload(event);
      return (
        (event.kind === "capability_snapshot" && toBoolean(p.telemetry_enabled) === true) ||
        (event.kind === "policy_change" &&
          toString(p.key) === "telemetry.enabled" &&
          (toBoolean(p.new_value) === true || toString(p.new_value) === "true"))
      );
    })
    .map((event) => event.id);

  const remotePolicyEventIds = events
    .filter((event) => {
      const p = payload(event);
      return (
        (event.kind === "policy_change" && ["remote_policy", "auto_update"].includes(toString(p.source) ?? "")) ||
        (event.kind === "capability_snapshot" && toBoolean(p.policy_managed) === true)
      );
    })
    .map((event) => event.id);

  const modeEvidenceRefs = {
    local_only: [
      ...collectEvidenceRefsFromRows(
        outboundMatrix.filter((row) => row.endpoint_type !== "storage" || row.content_visibility !== "metadata_only")
      ),
      ...collectEvidenceRefsFromFindings(
        [...controlSurface, ...transparencyFindings].filter((finding) =>
          finding.failure_reason_codes?.some((code) =>
            [
              "remote_policy",
              "auto_update",
              "remote_memory_sync",
              "remote_code_load",
              "remote_control_surface_present",
              "silent_background_activity",
              "silent_session_history_scan",
            ].includes(code)
          )
        )
      ),
    ],
    no_telemetry: collectEvidenceRefsFromRows(outboundMatrix.filter((row) => row.endpoint_type === "telemetry")),
    no_remote_policy: collectEvidenceRefsFromFindings(
      controlSurface.filter((finding) =>
        finding.failure_reason_codes?.some((code) =>
          ["remote_policy", "auto_update", "policy_managed", "policy_managed_controls_enabled"].includes(code)
        )
      )
    ),
    no_silent_background_work: collectEvidenceRefsFromFindings(
      [...controlSurface, ...transparencyFindings].filter((finding) =>
        finding.failure_reason_codes?.some((code) => ["silent_background_activity", "silent_session_history_scan"].includes(code))
      )
    ),
    transparent_prompting: collectEvidenceRefsFromFindings(
      transparencyFindings.filter((finding) =>
        finding.mode_ids?.includes("transparent_prompting") &&
        (finding.failure_reason_codes?.length ?? 0) > 0
      )
    ),
  };

  const modeEventIds = {
    local_only: [
      ...outboundMatrix.filter((row) => row.endpoint_type !== "storage" || row.content_visibility !== "metadata_only").flatMap((row) => row.event_ids),
      ...telemetryConfiguredEventIds,
      ...remotePolicyEventIds,
      ...collectEventIdsFromFindings(
        [...controlSurface, ...transparencyFindings].filter((finding) =>
          finding.failure_reason_codes?.some((code) =>
            [
              "remote_policy",
              "auto_update",
              "remote_memory_sync",
              "remote_code_load",
              "remote_control_surface_present",
              "policy_managed_controls_enabled",
              "telemetry_enabled_configured",
              "silent_background_activity",
              "silent_session_history_scan",
            ].includes(code)
          )
        )
      ),
    ],
    no_telemetry: [
      ...new Set([...outboundMatrix.filter((row) => row.endpoint_type === "telemetry").flatMap((row) => row.event_ids), ...telemetryConfiguredEventIds]),
    ],
    no_remote_policy: [
      ...new Set([
        ...remotePolicyEventIds,
        ...collectEventIdsFromFindings(
          controlSurface.filter((finding) =>
            finding.failure_reason_codes?.some((code) =>
              ["remote_policy", "auto_update", "policy_managed", "policy_managed_controls_enabled"].includes(code)
            )
          )
        ),
      ]),
    ],
    no_silent_background_work: collectEventIdsFromFindings(
      [...controlSurface, ...transparencyFindings].filter((finding) =>
        finding.failure_reason_codes?.some((code) => ["silent_background_activity", "silent_session_history_scan"].includes(code))
      )
    ),
    transparent_prompting: collectEventIdsFromFindings(
      transparencyFindings.filter((finding) =>
        finding.mode_ids?.includes("transparent_prompting") &&
        (finding.failure_reason_codes?.length ?? 0) > 0
      )
    ),
  };

  const results: SafetyModeResult[] = [
    {
      mode_id: "local_only",
      status: modeEventIds.local_only.length === 0 ? "pass" : "fail",
      title: "Local-only execution",
      summary:
        modeEventIds.local_only.length === 0
          ? "No non-local outbound or remote-control evidence was detected."
          : "Non-local activity was detected in the session.",
      event_ids: [...new Set(modeEventIds.local_only)],
      failure_reason_codes: [
        outboundMatrix.some((row) => row.endpoint_type !== "storage" && row.event_ids.length > 0)
          ? "non_local_outbound_detected"
          : undefined,
        remotePolicyEventIds.length > 0 ? "remote_policy" : undefined,
        hasFindingCode([...controlSurface, ...transparencyFindings], "remote_memory_sync") ? "remote_memory_sync_detected" : undefined,
        hasFindingCode([...controlSurface, ...transparencyFindings], "remote_code_load") ? "remote_code_load_detected" : undefined,
        hasFindingCode([...controlSurface, ...transparencyFindings], "silent_background_activity")
          ? "silent_background_activity"
          : undefined,
        hasFindingCode([...controlSurface, ...transparencyFindings], "silent_background_activity")
          ? "silent_background_activity_detected"
          : undefined,
        telemetryConfiguredEventIds.length > 0 ? "telemetry_enabled_configured" : undefined,
      ].filter((item): item is string => Boolean(item)),
      evidence_sources: [...new Set(modeEvidenceRefs.local_only.map((ref) => ref.source))],
      evidence_refs: makeSafetyEvidenceRefs("local_only", modeEvidenceRefs.local_only, modeEventIds.local_only),
    },
    {
      mode_id: "no_telemetry",
      status: modeEventIds.no_telemetry.length === 0 ? "pass" : "fail",
      title: "No telemetry",
      summary:
        modeEventIds.no_telemetry.length === 0
          ? "No telemetry endpoints were observed."
          : "Telemetry endpoints were observed.",
      event_ids: [...new Set(modeEventIds.no_telemetry)],
      failure_reason_codes: [
        outboundMatrix.some((row) => row.endpoint_type === "telemetry") ? "telemetry_endpoint_detected" : undefined,
        telemetryConfiguredEventIds.length > 0 ? "telemetry_enabled_configured" : undefined,
      ].filter((item): item is string => Boolean(item)),
      evidence_sources: [...new Set(modeEvidenceRefs.no_telemetry.map((ref) => ref.source))],
      evidence_refs: makeSafetyEvidenceRefs("no_telemetry", modeEvidenceRefs.no_telemetry, modeEventIds.no_telemetry),
    },
    {
      mode_id: "no_remote_policy",
      status: modeEventIds.no_remote_policy.length === 0 ? "pass" : "fail",
      title: "No remote policy control",
      summary:
        modeEventIds.no_remote_policy.length === 0
          ? "No remote policy-managed behavior was detected."
          : "Remote policy control was detected.",
      event_ids: [...new Set(modeEventIds.no_remote_policy)],
      failure_reason_codes: [
        ...new Set(
          controlSurface
            .filter((finding) =>
              finding.failure_reason_codes?.some((code) =>
                ["remote_policy", "auto_update", "policy_managed", "policy_managed_controls_enabled"].includes(code)
              )
            )
            .flatMap((finding) => finding.failure_reason_codes ?? [])
        ),
      ],
      evidence_sources: [...new Set(modeEvidenceRefs.no_remote_policy.map((ref) => ref.source))],
      evidence_refs: makeSafetyEvidenceRefs("no_remote_policy", modeEvidenceRefs.no_remote_policy, modeEventIds.no_remote_policy),
    },
    {
      mode_id: "no_silent_background_work",
      status: modeEventIds.no_silent_background_work.length === 0 ? "pass" : "fail",
      title: "No silent background work",
      summary:
        modeEventIds.no_silent_background_work.length === 0
          ? "No silent background activity was detected."
          : "Silent background activity was detected.",
      event_ids: [...new Set(modeEventIds.no_silent_background_work)],
      failure_reason_codes: [
        ...new Set(
          [...controlSurface, ...transparencyFindings]
            .filter((finding) =>
              finding.failure_reason_codes?.some((code) => ["silent_background_activity", "silent_session_history_scan"].includes(code))
            )
            .flatMap((finding) => finding.failure_reason_codes ?? [])
        ),
      ],
      evidence_sources: [...new Set(modeEvidenceRefs.no_silent_background_work.map((ref) => ref.source))],
      evidence_refs: makeSafetyEvidenceRefs(
        "no_silent_background_work",
        modeEvidenceRefs.no_silent_background_work,
        modeEventIds.no_silent_background_work
      ),
    },
    {
      mode_id: "transparent_prompting",
      status: modeEventIds.transparent_prompting.length === 0 ? "pass" : "fail",
      title: "Transparent prompting",
      summary:
        modeEventIds.transparent_prompting.length === 0
          ? "No opaque prompt transforms or hidden context injections were detected."
          : "Prompt context was transformed without full transparency.",
      event_ids: [...new Set(modeEventIds.transparent_prompting)],
      failure_reason_codes:
        modeEventIds.transparent_prompting.length > 0
          ? [
              ...new Set(
                transparencyFindings
                  .filter((finding) => finding.mode_ids?.includes("transparent_prompting"))
                  .flatMap((finding) => finding.failure_reason_codes ?? [])
              ),
            ]
          : [],
      evidence_sources: [...new Set(modeEvidenceRefs.transparent_prompting.map((ref) => ref.source))],
      evidence_refs: makeSafetyEvidenceRefs("transparent_prompting", modeEvidenceRefs.transparent_prompting, modeEventIds.transparent_prompting),
    },
  ];

  return results;
}

function deriveTrustSummary(
  outboundMatrix: OutboundMatrixRow[],
  controlSurface: TrustFindingDraft[],
  transparencyFindings: TrustFindingDraft[],
  safetyModes: SafetyModeResult[]
): TrustAnalysisResult["summary"] {
  const reasons: string[] = [];
  const rawScore =
    outboundMatrix.reduce((sum, row) => sum + (row.risk_level === "high" ? 28 : row.risk_level === "medium" ? 14 : 5), 0) +
    controlSurface.reduce((sum, finding) => sum + (finding.severity === "high" ? 25 : finding.severity === "medium" ? 12 : 4), 0) +
    transparencyFindings.reduce((sum, finding) => sum + (finding.severity === "high" ? 25 : finding.severity === "medium" ? 12 : 4), 0);

  if (outboundMatrix.length > 0) {
    reasons.push(`${outboundMatrix.length} outbound endpoint(s) observed.`);
  }
  if (controlSurface.length > 0) {
    reasons.push(`${controlSurface.length} control surface finding(s) observed.`);
  }
  if (transparencyFindings.length > 0) {
    reasons.push(`${transparencyFindings.length} transparency finding(s) observed.`);
  }
  const failedModes = safetyModes.filter((mode) => mode.status === "fail");
  if (failedModes.length > 0) {
    reasons.push(`${failedModes.length} safety mode(s) failed.`);
  }
  if (reasons.length === 0) {
    reasons.push("No trust-specific signals were detected in the canonical events.");
  }

  const score = Math.min(100, rawScore);
  const verdict: TrustVerdict = score >= 60 ? "high" : score >= 25 ? "medium" : "low";
  return { verdict, score, reasons };
}

function finalizeEvidenceIndex(index: EvidenceIndex): Record<string, string[]> {
  const output: Record<string, string[]> = {};
  for (const [eventId, labels] of index.entries()) {
    output[eventId] = [...labels].sort();
  }
  return output;
}

function normalizeTrustEvents(eventsRaw: TrustEventInput[]): TrustEventInput[] {
  const events = [...eventsRaw].map((event) => ({ ...event }));
  events.sort((a, b) => {
    const tsCmp = a.ts.localeCompare(b.ts);
    if (tsCmp !== 0) return tsCmp;
    const sourceCmp = eventSource(a).localeCompare(eventSource(b));
    if (sourceCmp !== 0) return sourceCmp;
    const seqCmp = (a.seq ?? 0) - (b.seq ?? 0);
    if (seqCmp !== 0) return seqCmp;
    return a.id.localeCompare(b.id);
  });
  return events.map((event, index) => ({
    ...event,
    seq: index + 1,
    schema_version: event.schema_version ?? 1,
  }));
}

export function analyzeTrust(eventsRaw: TrustEventInput[]): TrustAnalysisResult {
  const events = normalizeTrustEvents(eventsRaw);
  const evidenceIndex: EvidenceIndex = new Map();
  const outboundCandidates = events.flatMap((event) => {
    const candidate = getOutboundCandidate(event);
    if (!candidate) return [];
    addEvidence(evidenceIndex, event, `candidate:${candidate.endpoint_type}:${candidate.endpoint}`);
    return [candidate];
  });

  const outboundMatrix = mergeOutboundRows(outboundCandidates, evidenceIndex);
  const controlSurface = deriveControlSurfaceFindings(events, evidenceIndex);
  const transparencyFindings = deriveTransparencyFindings(events, evidenceIndex);
  const safetyModes = deriveSafetyModes(events, outboundMatrix, controlSurface, transparencyFindings);
  const summary = deriveTrustSummary(outboundMatrix, controlSurface, transparencyFindings, safetyModes);

  for (const row of outboundMatrix) {
    for (const ref of row.evidence_refs ?? []) {
      addEvidence(
        evidenceIndex,
        {
          id: ref.ref_id,
          source: ref.source === "forensic" ? "forensic" : undefined,
          provenance:
            ref.source === "forensic"
              ? {
                  attachment_id: ref.attachment_id,
                  attachment_kind: ref.attachment_kind,
                  source_label: ref.source_label,
                } as Partial<ForensicSignal["provenance"]>
              : undefined,
        },
        `outbound_row:${row.endpoint_type}`
      );
    }
  }
  for (const finding of [...controlSurface, ...transparencyFindings]) {
    for (const ref of finding.evidence_refs ?? []) {
      addEvidence(
        evidenceIndex,
        {
          id: ref.ref_id,
          source: ref.source === "forensic" ? "forensic" : undefined,
          provenance:
            ref.source === "forensic"
              ? {
                  attachment_id: ref.attachment_id,
                  attachment_kind: ref.attachment_kind,
                  source_label: ref.source_label,
                } as Partial<ForensicSignal["provenance"]>
              : undefined,
        },
        `finding:${finding.category}:${finding.id}`
      );
    }
  }

  return {
    session_id: events[0]?.session_id ?? "unknown",
    summary,
    outbound_matrix: outboundMatrix,
    control_surface: controlSurface,
    transparency_findings: transparencyFindings,
    safety_modes: safetyModes,
    evidence_index: finalizeEvidenceIndex(evidenceIndex),
  };
}
