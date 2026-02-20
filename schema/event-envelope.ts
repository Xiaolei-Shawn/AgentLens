export type ActorType = "agent" | "user" | "system" | "tool";
export type EventVisibility = "raw" | "review" | "debug";
export type EventKind =
  | "session_start"
  | "intent"
  | "file_op"
  | "tool_call"
  | "decision"
  | "assumption"
  | "verification"
  | "session_end"
  | "artifact_created"
  | "intent_transition"
  | "risk_signal"
  | "verification_run"
  | "diff_summary"
  | "decision_link"
  | "assumption_lifecycle"
  | "blocker"
  | "token_usage_checkpoint"
  | "session_quality"
  | "replay_bookmark"
  | "hotspot";

export interface CanonicalEvent {
  id: string;
  session_id: string;
  seq: number;
  ts: string;
  kind: EventKind;
  actor: {
    type: ActorType;
    id?: string;
  };
  scope?: {
    intent_id?: string;
    file?: string;
    module?: string;
  };
  payload: Record<string, unknown>;
  derived?: boolean;
  confidence?: number;
  visibility?: EventVisibility;
  schema_version: number;
}

export const EVENT_SCHEMA_VERSION = 1;

export interface SessionLogFile {
  session_id: string;
  goal: string;
  user_prompt?: string;
  repo?: string;
  branch?: string;
  started_at: string;
  ended_at?: string;
  events: CanonicalEvent[];
}
