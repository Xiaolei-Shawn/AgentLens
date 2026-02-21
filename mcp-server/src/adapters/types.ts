import type { ActorType, CanonicalPayload, EventKind, EventVisibility } from "../event-envelope.js";

export interface AdaptedEvent {
  kind: EventKind;
  ts?: string;
  actor: {
    type: ActorType;
    id?: string;
  };
  scope?: {
    intent_id?: string;
    file?: string;
    module?: string;
  };
  payload: CanonicalPayload;
  derived?: boolean;
  confidence?: number;
  visibility?: EventVisibility;
}

export interface AdaptedSession {
  session_id?: string;
  goal?: string;
  user_prompt?: string;
  repo?: string;
  branch?: string;
  started_at?: string;
  ended_at?: string;
  source: string;
  events: AdaptedEvent[];
}

export interface RawAdapter {
  name: string;
  canAdapt(content: string): boolean;
  adapt(content: string): AdaptedSession;
}
