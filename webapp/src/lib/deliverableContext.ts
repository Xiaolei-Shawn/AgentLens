import type { Session, SessionEvent } from "../types/session";
import type { DeliverableItem } from "./deliverables";
import { deriveContextPath } from "./contextPath";

export interface DecisionForDeliverable {
  eventIndex: number;
  summary: string;
}

export interface VerificationForDeliverable {
  eventIndex: number;
  type: string;
  result: string;
  details?: string;
}

/**
 * Decisions that led to this deliverable (via context path: decision → outcome for this file).
 */
export function getDecisionsForDeliverable(
  session: Session,
  deliverable: DeliverableItem
): DecisionForDeliverable[] {
  const path = deliverable.path;
  const model = deriveContextPath(session.events);
  const outcomeNodesForFile = model.byType.outcome.filter((n) => {
    const ev = session.events[n.eventIndex];
    if (!ev || ev.kind !== "file_op") return false;
    const target =
      typeof (ev.payload as Record<string, unknown>)?.target === "string"
        ? (ev.payload as Record<string, unknown>).target
        : ev.scope?.file;
    return target === path;
  });
  const outcomeIds = new Set(outcomeNodesForFile.map((n) => n.id));
  const decisionIdsLinkedToFile = new Set(
    model.links
      .filter((l) => outcomeIds.has(l.to) && l.reason.includes("file change"))
      .map((l) => l.from)
  );
  const decisions: DecisionForDeliverable[] = [];
  for (const node of model.byType.decision) {
    if (!decisionIdsLinkedToFile.has(node.id)) continue;
    const ev = session.events[node.eventIndex];
    if (!ev) continue;
    const raw = (ev.payload as Record<string, unknown>)?.summary;
    const summary = typeof raw === "string" ? raw : "Decision";
    decisions.push({ eventIndex: node.eventIndex, summary });
  }
  decisions.sort((a, b) => a.eventIndex - b.eventIndex);
  return decisions;
}

/**
 * Verifications that relate to this deliverable (same intent or same file scope).
 */
export function getVerificationsForDeliverable(
  session: Session,
  deliverable: DeliverableItem
): VerificationForDeliverable[] {
  const intentIds = new Set(deliverable.intent_contributions.map((c) => c.intent_id));
  const path = deliverable.path;
  const out: VerificationForDeliverable[] = [];
  for (let i = 0; i < session.events.length; i++) {
    const e = session.events[i];
    if (e.kind !== "verification") continue;
    const scopeFile = (e as SessionEvent).scope?.file;
    const scopeIntent = (e as SessionEvent).scope?.intent_id;
    const match =
      scopeFile === path || (scopeIntent && intentIds.has(scopeIntent));
    if (!match) continue;
    const payload = e.payload as Record<string, unknown>;
    out.push({
      eventIndex: i,
      type: typeof payload.type === "string" ? payload.type : "check",
      result: typeof payload.result === "string" ? payload.result : "unknown",
      details: typeof payload.details === "string" ? payload.details : undefined,
    });
  }
  return out;
}
