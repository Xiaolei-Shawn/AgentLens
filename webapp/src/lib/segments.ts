import type { Session, SessionEvent } from "../types/session";
import { getPayloadString, isIntentEvent } from "../types/session";

export interface Segment {
  /** The intent event that anchors this segment, or synthetic fallback */
  planStep: SessionEvent;
  /** Index of the intent/synthetic anchor in session.events */
  planStepIndex: number;
  /** All event indices in this segment (from anchor up to next anchor/end) */
  eventIndices: number[];
}

function createSyntheticIntentAnchor(session: Session): SessionEvent {
  const first = session.events[0];
  return {
    id: `${session.id}:synthetic:intent`,
    session_id: session.id,
    seq: first?.seq ?? 1,
    ts: first?.ts ?? new Date().toISOString(),
    kind: "intent",
    actor: { type: "system" },
    payload: {
      intent_id: "intent_fallback",
      title: "Session lifecycle",
      description: "Auto-grouped segment when explicit intents are missing",
    },
    schema_version: first?.schema_version ?? 1,
    derived: true,
    visibility: "review",
    confidence: 0.7,
  };
}

export function getSegmentTitle(segment: Segment, index: number): string {
  if (isIntentEvent(segment.planStep)) {
    return (
      getPayloadString(segment.planStep, "title") ??
      getPayloadString(segment.planStep, "description") ??
      `Intent ${index + 1}`
    );
  }
  return `Lifecycle ${index + 1}`;
}

export function getSegments(session: Session): Segment[] {
  const events = session.events;
  if (events.length === 0) return [];

  const intentIndices = events
    .map((e, i) => (isIntentEvent(e) ? i : -1))
    .filter((i) => i >= 0);

  if (intentIndices.length === 0) {
    return [
      {
        planStep: createSyntheticIntentAnchor(session),
        planStepIndex: 0,
        eventIndices: events.map((_, i) => i),
      },
    ];
  }

  return intentIndices.map((anchorIndex, i) => {
    const nextAnchor = intentIndices[i + 1];
    const end = nextAnchor ?? events.length;
    const eventIndices: number[] = [];
    for (let j = anchorIndex; j < end; j++) eventIndices.push(j);
    return {
      planStep: events[anchorIndex],
      planStepIndex: anchorIndex,
      eventIndices,
    };
  });
}

