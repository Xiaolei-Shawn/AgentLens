import type { Session, SessionEvent } from "../types/session";
import { getFilePathFromFileOp, isFileOpEvent } from "../types/session";

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readAction(event: SessionEvent): "create" | "edit" | "delete" | undefined {
  if (!isFileOpEvent(event)) return undefined;
  const action = event.payload?.action;
  if (action === "create" || action === "edit" || action === "delete") return action;
  return undefined;
}

function readDetailsObject(event: SessionEvent): Record<string, unknown> {
  if (!isFileOpEvent(event)) return {};
  const details = event.payload?.details;
  return details && typeof details === "object" ? (details as Record<string, unknown>) : {};
}

function readOldContent(event: SessionEvent): string | undefined {
  const details = readDetailsObject(event);
  return readString(details.old_content) ?? readString(event.payload?.old_content);
}

function readNewContent(event: SessionEvent): string | undefined {
  const details = readDetailsObject(event);
  return readString(details.new_content) ?? readString(event.payload?.new_content) ?? readString(event.payload?.content);
}

export function getChangedFiles(session: Session): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const event of session.events) {
    if (!isFileOpEvent(event)) continue;
    const path = getFilePathFromFileOp(event);
    if (!path) continue;
    if (!seen.has(path)) {
      seen.add(path);
      order.push(path);
    }
  }
  return order;
}

export type RevisionType = "create" | "edit" | "delete";

export interface FileRevision {
  eventIndex: number;
  type: RevisionType;
  content: string | undefined;
  oldContent?: string;
  at?: string;
}

export function getRevisionsForFile(session: Session, path: string): FileRevision[] {
  const revisions: FileRevision[] = [];
  let content: string | undefined;
  for (let i = 0; i < session.events.length; i++) {
    const event = session.events[i];
    if (!isFileOpEvent(event)) continue;
    const eventPath = getFilePathFromFileOp(event);
    if (eventPath !== path) continue;
    const action = readAction(event);
    if (!action) continue;

    if (action === "create") {
      content = readNewContent(event) ?? "";
      revisions.push({ eventIndex: i, type: "create", content, at: event.ts });
      continue;
    }

    if (action === "edit") {
      const oldContent = readOldContent(event) ?? content;
      content = readNewContent(event) ?? content ?? "";
      revisions.push({ eventIndex: i, type: "edit", content, oldContent, at: event.ts });
      continue;
    }

    const oldContent = readOldContent(event) ?? content;
    revisions.push({ eventIndex: i, type: "delete", content: undefined, oldContent, at: event.ts });
    content = undefined;
  }
  return revisions;
}

export function getRevisionIndexForEvent(session: Session, path: string, eventIndex: number): number {
  const revisions = getRevisionsForFile(session, path);
  for (let r = 0; r < revisions.length; r++) {
    if (revisions[r].eventIndex >= eventIndex) return r;
  }
  return Math.max(0, revisions.length - 1);
}

