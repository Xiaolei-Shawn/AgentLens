import { isPlanStepEvent } from "../types/session";
import type { Session, SessionEvent } from "../types/session";

export interface Segment {
  /** The plan_step event that anchors this segment */
  planStep: SessionEvent & { type: "plan_step" };
  /** Index of the plan_step in session.events */
  planStepIndex: number;
  /** All event indices in this segment (from this plan_step up to, but not including, next plan_step) */
  eventIndices: number[];
}

/**
 * Group events into segments by plan_step. Each segment runs from one plan_step
 * (inclusive) to the next plan_step (exclusive) or end of events.
 */
export function getSegments(session: Session): Segment[] {
  const events = session.events;
  const planStepIndices = events
    .map((e, i) => (isPlanStepEvent(e) ? i : -1))
    .filter((i) => i >= 0);

  if (planStepIndices.length === 0) return [];

  return planStepIndices.map((planStepIndex, i) => {
    const nextPlan = planStepIndices[i + 1];
    const end = nextPlan ?? events.length;
    const eventIndices: number[] = [];
    for (let j = planStepIndex; j < end; j++) eventIndices.push(j);
    return {
      planStep: events[planStepIndex] as SessionEvent & { type: "plan_step" },
      planStepIndex,
      eventIndices,
    };
  });
}
