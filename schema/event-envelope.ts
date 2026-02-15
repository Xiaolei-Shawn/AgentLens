export type ActorType = "agent" | "user" | "system" | "tool";

export interface CanonicalEvent {
  id: string;
  session_id: string;
  seq: number;
  ts: string;
  kind: string;
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
  visibility?: "raw" | "review" | "debug";
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

