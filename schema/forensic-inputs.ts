import type { CanonicalEvent } from "./event-envelope.js";
import type { TrustEventKind } from "./trust-review.js";

export type ForensicAttachmentKind = "config_snapshot" | "env_snapshot" | "proxy_trace";
export type ForensicAttachmentSource = "api" | "file_import" | "manual";
export type ForensicSignalSource = "forensic";

export interface ForensicAttachmentInput {
  kind: ForensicAttachmentKind;
  source_label?: string;
  data: unknown;
}

export interface ForensicSignalProvenance {
  attachment_id: string;
  attachment_kind: ForensicAttachmentKind;
  source_label?: string;
  source?: ForensicAttachmentSource;
}

export interface ForensicSignal extends CanonicalEvent {
  kind: TrustEventKind;
  source: ForensicSignalSource;
  provenance: ForensicSignalProvenance;
}

export interface ForensicAttachmentRecord extends ForensicAttachmentInput {
  attachment_id: string;
  session_id: string;
  received_at: string;
  parsed_at: string;
  raw_format: "json";
  raw: unknown;
  signals: ForensicSignal[];
}

export interface ForensicAttachmentSummary {
  attachment_id: string;
  kind: ForensicAttachmentKind;
  source_label?: string;
  received_at: string;
  parsed_at: string;
  raw_format: "json";
  signal_count: number;
  signal_kinds: TrustEventKind[];
}

export interface ForensicSessionRecord {
  session_id: string;
  updated_at: string;
  attachments: ForensicAttachmentRecord[];
}

export interface ForensicSessionSummary {
  session_id: string;
  updated_at: string;
  attachment_count: number;
  signal_count: number;
  attachments: ForensicAttachmentSummary[];
}
