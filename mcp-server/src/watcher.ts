/**
 * Fallback folder watcher ingestion (S09).
 * Reads event fragments from a configured folder, merges into sessions, flushes on completion.
 * Enable/disable via AL_WATCHER_ENABLED.
 */

import { watch, readFileSync, unlinkSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { SessionEvent } from "@al/schema/session-schema";
import { getWatcherDir } from "./config.js";
import { ensureSession, appendEvent, markCompleted, getSession } from "./store.js";
import { flushSession, getSessionFilePath } from "./flush.js";

export interface EventFragment {
  session_id: string;
  started_at?: string;
  title?: string;
  user_message?: string;
  events: SessionEvent[];
}

function hasSessionEndMarker(events: { type?: string }[]): boolean {
  return events.some((e) => (e as { type?: string }).type === "session_end");
}

// session_end is not in our schema yet - it's the logical "end". We have deliverable as last often.
// Story says "record_session_end" so we need a session_end event type. Check schema again.
// Schema has: session_start, plan_step, file_edit, file_create, file_delete, deliverable, tool_call.
// So "session end" might be signaled by a special event. MVP-Stories say "record_session_end" as a tool.
// So when we flush we do it on record_session_end - that could add an event type "session_end" or we
// just flush when the tool is called without adding an event. For the watcher, a fragment could
// include a "session_end" marker. I'll add a convention: fragment with events that include
// { type: "session_end" } triggers flush. We need to add session_end to the schema for this.
// Actually re-read S07: "Flush mechanism on record_session_end and explicit flush command."
// So record_session_end is a tool that ends the session and triggers flush. The schema doesn't
// require a session_end event in the JSON - we can flush when the tool is called. For the watcher,
// we need a way to signal "end". Options: (1) Add session_end to schema (optional event),
// (2) Use a special filename like "session_id.end" or (3) Fragment with empty events and a flag.
// I'll use a special event type "session_end" in the fragment only (watcher-specific). When we
// see it we flush and don't append it to the session events (since schema doesn't have it).
// So: fragment events can include { type: "session_end" }; we don't add that to the session,
// we just flush and mark completed.
const SESSION_END = "session_end";

function processFragmentFile(filePath: string): void {
  try {
    const raw = readFileSync(filePath, "utf-8");
    const data = JSON.parse(raw) as EventFragment;
    const { session_id, started_at, title, user_message, events } = data;
    if (!session_id || !Array.isArray(events)) {
      return;
    }
    const state = ensureSession(
      session_id,
      started_at ?? new Date().toISOString(),
      title ?? "",
      user_message ?? ""
    );
    let shouldFlush = hasSessionEndMarker(events);
    for (const e of events) {
      if ((e as { type?: string }).type === SESSION_END) continue;
      appendEvent(session_id, e as SessionEvent);
    }
    if (shouldFlush) {
      markCompleted(session_id);
      const s = getSession(session_id);
      if (s) flushSession(s);
    }
    unlinkSync(filePath);
  } catch {
    // leave file for retry or manual inspection
  }
}

export function startWatcher(): () => void {
  const dir = getWatcherDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  try {
    const existing = readdirSync(dir);
    for (const name of existing) {
      if (name.endsWith(".json")) processFragmentFile(join(dir, name));
    }
  } catch {
    // dir may not exist yet
  }

  try {
    const w = watch(dir, { persistent: false }, (event, filename) => {
      if (event === "rename" && filename && filename.endsWith(".json")) {
        processFragmentFile(join(dir, filename));
      }
    });
    return () => w.close();
  } catch {
    return () => {};
  }
}
