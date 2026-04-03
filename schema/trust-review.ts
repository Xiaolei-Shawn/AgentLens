import type { EventKind } from "./event-envelope.js";

export type TrustVerdict = "low" | "medium" | "high";
export type TrustSeverity = TrustVerdict;
export type TrustFindingCategory = "outbound" | "control_surface" | "transparency";
export type TrustEvidenceSource = "canonical" | "forensic";
export type SafetyModeId =
  | "local_only"
  | "no_telemetry"
  | "no_remote_policy"
  | "no_silent_background_work"
  | "transparent_prompting";
export type SafetyModeStatus = "pass" | "fail";
export type OutboundEndpointType = "model_api" | "telemetry" | "error_reporting" | "policy" | "storage" | "unknown";
export type OutboundContentVisibility = "full" | "summary" | "metadata_only" | "unknown";
export type TrustEventKind = Extract<
  EventKind,
  | "network_egress"
  | "policy_change"
  | "background_activity"
  | "memory_op"
  | "prompt_transform"
  | "remote_code_load"
  | "capability_snapshot"
>;

export interface TrustEvidenceRef {
  ref_id: string;
  source: TrustEvidenceSource;
  label: string;
  attachment_id?: string;
  attachment_kind?: string;
  source_label?: string;
}

export interface TransparencyDiff {
  diff_type:
    | "prompt_transform"
    | "memory_injection"
    | "summary_rewrite"
    | "tool_injection"
    | "identity_masking"
    | "unknown";
  before?: string;
  after?: string;
  before_excerpt?: string;
  after_excerpt?: string;
  before_hash?: string;
  after_hash?: string;
}

export interface TrustSummary {
  verdict: TrustVerdict;
  score: number;
  reasons: string[];
}

export interface OutboundMatrixRow {
  endpoint: string;
  endpoint_type: OutboundEndpointType;
  data_classes: string[];
  content_visibility: OutboundContentVisibility;
  user_visible: boolean;
  event_ids: string[];
  risk_level: TrustVerdict;
  evidence_sources?: TrustEvidenceSource[];
  evidence_refs?: TrustEvidenceRef[];
}

export interface TrustFinding {
  id: string;
  category: TrustFindingCategory;
  severity: TrustSeverity;
  title: string;
  summary: string;
  event_ids: string[];
  evidence_sources?: TrustEvidenceSource[];
  evidence_refs?: TrustEvidenceRef[];
  mode_ids?: SafetyModeId[];
  failure_reason_codes?: string[];
  transparency_diff?: TransparencyDiff;
}

export interface SafetyModeResult {
  mode_id: SafetyModeId;
  status: SafetyModeStatus;
  title: string;
  summary: string;
  event_ids: string[];
  failure_reason_codes: string[];
  evidence_sources?: TrustEvidenceSource[];
  evidence_refs?: TrustEvidenceRef[];
}

export interface TrustAnalysisResult {
  session_id: string;
  summary: TrustSummary;
  outbound_matrix: OutboundMatrixRow[];
  control_surface: TrustFinding[];
  transparency_findings: TrustFinding[];
  safety_modes: SafetyModeResult[];
  evidence_index: Record<string, string[]>;
}
