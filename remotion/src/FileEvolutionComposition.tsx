/**
 * S29: File evolution composition — session + file path, revisions with frame-based segments.
 */

import React from "react";
import { useCurrentFrame, useVideoConfig, AbsoluteFill } from "remotion";
import type { Session } from "./types/session";
import { isFileCreateEvent, isFileEditEvent, isFileDeleteEvent } from "./types/session";

const FPS = 30;
const FRAMES_PER_REVISION = 60;

interface FileRevision {
  eventIndex: number;
  type: "create" | "edit" | "delete";
  content: string | undefined;
  oldContent?: string;
}

export function getRevisionsForFile(session: Session, path: string): FileRevision[] {
  const revisions: FileRevision[] = [];
  let content: string | undefined;
  for (let i = 0; i < session.events.length; i++) {
    const event = session.events[i]!;
    if (isFileCreateEvent(event) && event.path === path) {
      content = event.content;
      revisions.push({ eventIndex: i, type: "create", content });
    } else if (isFileEditEvent(event) && event.path === path) {
      const oldContent = event.old_content ?? content;
      content = event.new_content;
      revisions.push({ eventIndex: i, type: "edit", content, oldContent });
    } else if (isFileDeleteEvent(event) && event.path === path) {
      revisions.push({
        eventIndex: i,
        type: "delete",
        content: undefined,
        oldContent: event.old_content ?? content,
      });
      content = undefined;
    }
  }
  return revisions;
}

export interface FileEvolutionProps {
  session: Session;
  filePath: string;
}

export const FileEvolutionComposition: React.FC<FileEvolutionProps> = ({
  session,
  filePath,
}) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const revisions = React.useMemo(
    () => getRevisionsForFile(session, filePath),
    [session, filePath]
  );

  if (revisions.length === 0) {
    return (
      <AbsoluteFill style={{ background: "#1a1a1a", color: "#eee", padding: 24 }}>
        <p>No revisions for {filePath}</p>
      </AbsoluteFill>
    );
  }

  const framesPerRev = Math.max(1, Math.floor(durationInFrames / revisions.length));
  const revisionIndex = Math.min(
    Math.floor(frame / framesPerRev),
    revisions.length - 1
  );
  const revision = revisions[revisionIndex]!;
  const progressInSegment = (frame % framesPerRev) / framesPerRev;

  return (
    <AbsoluteFill
      style={{
        background: "#1a1a1a",
        color: "#eee",
        fontFamily: "system-ui, monospace",
        padding: 24,
      }}
    >
      <header style={{ marginBottom: 16, borderBottom: "1px solid #333", paddingBottom: 8 }}>
        <h1 style={{ margin: 0, fontSize: 18 }}>{filePath}</h1>
        <p style={{ margin: "4px 0 0 0", fontSize: 12, color: "#888" }}>
          Revision {revisionIndex + 1} / {revisions.length} ({revision.type})
        </p>
      </header>
      <div style={{ display: "flex", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ fontSize: 11, color: "#888", margin: "0 0 8px 0" }}>Content</h3>
          <pre
            style={{
              margin: 0,
              padding: 12,
              background: "#222",
              borderRadius: 6,
              fontSize: 12,
              overflow: "auto",
              whiteSpace: "pre",
              opacity: 0.9 + progressInSegment * 0.1,
            }}
          >
            {revision.type === "delete"
              ? "(deleted)"
              : revision.content ?? "(no content)"}
          </pre>
        </div>
        {revision.oldContent != null && revision.content != null && revision.type === "edit" && (
          <div style={{ flex: 1 }}>
            <h3 style={{ fontSize: 11, color: "#888", margin: "0 0 8px 0" }}>Previous</h3>
            <pre
              style={{
                margin: 0,
                padding: 12,
                background: "#222",
                borderRadius: 6,
                fontSize: 12,
                overflow: "auto",
                whiteSpace: "pre",
                opacity: 1 - progressInSegment * 0.3,
              }}
            >
              {revision.oldContent}
            </pre>
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

export const defaultFileEvolutionProps: FileEvolutionProps = {
  session: { id: "", started_at: "", title: "", user_message: "", events: [] },
  filePath: "src/example.ts",
};
