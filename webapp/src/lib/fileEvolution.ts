/**
 * S18: Changed-files derivation.
 * S19: Revision builder for a selected file.
 */

import {
  isFileCreateEvent,
  isFileEditEvent,
  isFileDeleteEvent,
} from "../types/session";
import type { Session } from "../types/session";

/** Unique file paths that appear in file_create, file_edit, or file_delete (order of first appearance). */
export function getChangedFiles(session: Session): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const event of session.events) {
    if (
      isFileCreateEvent(event) ||
      isFileEditEvent(event) ||
      isFileDeleteEvent(event)
    ) {
      if (!seen.has(event.path)) {
        seen.add(event.path);
        order.push(event.path);
      }
    }
  }
  return order;
}

export type RevisionType = "create" | "edit" | "delete";

export interface FileRevision {
  eventIndex: number;
  type: RevisionType;
  /** Content after this revision (undefined if deleted). */
  content: string | undefined;
  /** For edit: previous content. For delete: last content. */
  oldContent?: string;
  at?: string;
}

/**
 * Ordered revisions for one file from the session event stream.
 * Each revision corresponds to one file_create, file_edit, or file_delete event for that path.
 */
export function getRevisionsForFile(session: Session, path: string): FileRevision[] {
  const revisions: FileRevision[] = [];
  let content: string | undefined;
  for (let i = 0; i < session.events.length; i++) {
    const event = session.events[i];
    if (isFileCreateEvent(event) && event.path === path) {
      content = event.content;
      revisions.push({
        eventIndex: i,
        type: "create",
        content,
        at: event.at,
      });
    } else if (isFileEditEvent(event) && event.path === path) {
      const oldContent = event.old_content ?? content;
      content = event.new_content;
      revisions.push({
        eventIndex: i,
        type: "edit",
        content,
        oldContent,
        at: event.at,
      });
    } else if (isFileDeleteEvent(event) && event.path === path) {
      const oldContent = event.old_content ?? content;
      revisions.push({
        eventIndex: i,
        type: "delete",
        content: undefined,
        oldContent,
        at: event.at,
      });
      content = undefined;
    }
  }
  return revisions;
}

/** Find revision index that corresponds to (or immediately follows) this event index for the file. */
export function getRevisionIndexForEvent(
  session: Session,
  path: string,
  eventIndex: number
): number {
  const revisions = getRevisionsForFile(session, path);
  for (let r = 0; r < revisions.length; r++) {
    if (revisions[r].eventIndex >= eventIndex) return r;
  }
  return Math.max(0, revisions.length - 1);
}
