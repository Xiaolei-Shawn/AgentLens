import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { flushSync } from "react-dom";
import type { Session } from "../types/session";
import { getSegments } from "../lib/segments";
import { getRevisionIndexForEvent } from "../lib/fileEvolution";
import { runAuditPostProcessing } from "../lib/auditPipeline";
import { PlanNodesPanel } from "./PlanNodesPanel";
import { ChangedFilesList } from "./ChangedFilesList";
import { SegmentDetailView } from "./SegmentDetailView";
import { FileEvolutionView } from "./FileEvolutionView";
import { TimelineStrip } from "./TimelineStrip";
import { PlaybackControls } from "./PlaybackControls";
import { FlowView } from "./FlowView";
import { NodeView } from "./NodeView";
import { ReviewerHighlights } from "./ReviewerHighlights";
import { ReviewerFocusPanel } from "./ReviewerFocusPanel";

import "./ReplayView.css";

const BASE_INTERVAL_MS = 2000;

interface ReplayViewProps {
  session: Session;
  onBack: () => void;
}

export function ReplayView({ session, onBack }: ReplayViewProps) {
  const segments = getSegments(session);
  const { normalized, reviewer } = useMemo(
    () => runAuditPostProcessing(session.events),
    [session.events]
  );

  const criticalEvents = useMemo(() => {
    const out: Array<{ index: number; severity: "high" | "medium"; reason: string }> = [];
    for (let i = 0; i < session.events.length; i++) {
      const e = session.events[i];
      if (e.kind === "decision") out.push({ index: i, severity: "medium", reason: "Decision point" });
      if (e.kind === "session_end") out.push({ index: i, severity: "medium", reason: "Session outcome" });
      if (e.kind === "assumption" && e.payload.risk === "high") {
        out.push({ index: i, severity: "high", reason: "High-risk assumption" });
      }
      if (e.kind === "verification") {
        const r = e.payload.result;
        if (r === "fail") out.push({ index: i, severity: "high", reason: "Verification failed" });
        else if (r === "unknown") out.push({ index: i, severity: "medium", reason: "Verification unknown" });
      }
      if (e.kind === "file_op") {
        const target =
          (typeof e.payload.target === "string" ? e.payload.target : "") ||
          (typeof e.scope?.file === "string" ? e.scope.file : "");
        const lower = target.toLowerCase();
        if (
          lower.includes("/api/") ||
          lower.includes("/routes/") ||
          lower.includes("/migrations/") ||
          lower.endsWith("package.json")
        ) {
          out.push({ index: i, severity: "high", reason: `High-impact file: ${target}` });
        }
      }
    }
    out.sort((a, b) => a.index - b.index);
    return out;
  }, [session.events]);
  const criticalIndices = useMemo(
    () => [...new Set(criticalEvents.map((e) => e.index))],
    [criticalEvents]
  );
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState<
    number | null
  >(segments.length > 0 ? 0 : null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedRevisionIndex, setSelectedRevisionIndex] = useState(0);
  const [viewMode, setViewMode] = useState<"timeline" | "pivot" | "reviewer">("reviewer");
  /** When in Pivot, show either flow (graph) or node (detail). Switched via "Open in Node/Flow View" buttons. */
  const [pivotSubView, setPivotSubView] = useState<"flow" | "node">("flow");
  const [flowViewFocusIndex, setFlowViewFocusIndex] = useState<
    number | null
  >(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2>(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isWorkflowView = viewMode === "pivot";
  const isReviewerView = viewMode === "reviewer";
  const playbackSpeed = speed;

  const eventCount = session.events.length;
  const atEnd = eventCount === 0 || currentIndex >= eventCount - 1;

  const stopPlayback = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // Keep selected plan node and detail view in sync with current event (playback or scrub)
  useEffect(() => {
    const segIdx = segments.findIndex((s) =>
      s.eventIndices.includes(currentIndex),
    );
    setSelectedSegmentIndex(segIdx >= 0 ? segIdx : null);
  }, [currentIndex, segments]);

  useEffect(() => {
    if (!isPlaying) return;
    if (atEnd) {
      stopPlayback();
      return;
    }
    const ms = BASE_INTERVAL_MS / playbackSpeed;
    intervalRef.current = setInterval(() => {
      setCurrentIndex((i) => {
        if (i >= eventCount - 1) {
          stopPlayback();
          return i;
        }
        return i + 1;
      });
    }, ms);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isPlaying, playbackSpeed, atEnd, eventCount, stopPlayback]);

  const handleSeek = useCallback(
    (index: number) => {
      setCurrentIndex(index);
      if (isPlaying) stopPlayback();
      const segIdx = segments.findIndex((s) => s.eventIndices.includes(index));
      if (segIdx >= 0) setSelectedSegmentIndex(segIdx);
    },
    [isPlaying, stopPlayback, segments],
  );

  const handleSelectSegment = useCallback(
    (index: number) => {
      setSelectedSegmentIndex(index);
      setSelectedFilePath(null);
      const seg = segments[index];
      if (seg) setCurrentIndex(seg.planStepIndex);
    },
    [segments],
  );

  const handleSelectFile = useCallback((path: string) => {
    setSelectedFilePath(path);
    setSelectedRevisionIndex(0);
  }, []);

  const handleOpenFileEvolution = useCallback(
    (path: string, eventIndex: number) => {
      setSelectedFilePath(path);
      setSelectedRevisionIndex(
        getRevisionIndexForEvent(session, path, eventIndex),
      );
    },
    [session],
  );

  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => stopPlayback(), [stopPlayback]);

  const selectedSegment =
    selectedSegmentIndex != null && segments[selectedSegmentIndex]
      ? segments[selectedSegmentIndex]
      : null;

  const withViewTransition = useCallback((fn: () => void) => {
    const doc = typeof document !== "undefined" ? document : null;
    if (doc && "startViewTransition" in doc) {
      (doc as Document & { startViewTransition: (cb: () => void | Promise<void>) => void })
        .startViewTransition(() => {
          flushSync(fn);
        });
    } else {
      fn();
    }
  }, []);

  return (
    <div
      className={`replay-view ${isWorkflowView ? "replay-view--workflow" : ""} ${isReviewerView ? "replay-view--reviewer" : ""}`}
    >
      <header className="replay-header">
        <button
          type="button"
          className="back-btn"
          onClick={onBack}
          aria-label="Load another session"
        >
          ← Back
        </button>
        <h1
          className={`replay-title ${isWorkflowView ? "replay-title--workflow" : ""}`}
        >
          {isWorkflowView ? (
            <>
              <span className="workflow-logo" aria-hidden>
                ◇
              </span>
              Workflow Visualizer
            </>
          ) : isReviewerView ? (
            "Reviewer Mode"
          ) : (
            session.title
          )}
        </h1>
        <p className="replay-meta">
          {session.id} · {eventCount} events
        </p>
        <div className="replay-view-toggle replay-view-toggle--all">
          <button
            type="button"
            className={viewMode === "timeline" ? "active" : ""}
            onClick={() => setViewMode("timeline")}
          >
            Timeline
          </button>
          <button
            type="button"
            className={viewMode === "reviewer" ? "active" : ""}
            onClick={() => setViewMode("reviewer")}
          >
            Reviewer
          </button>
          <button
            type="button"
            className={viewMode === "pivot" ? "active" : ""}
            onClick={() => setViewMode("pivot")}
          >
            Pivot
          </button>
        </div>
      </header>
      <div className="replay-layout">
        {viewMode === "timeline" && (
          <aside className="replay-sidebar">
            <PlanNodesPanel
              session={session}
              selectedSegmentIndex={selectedSegmentIndex}
              onSelectSegment={handleSelectSegment}
            />
            <ChangedFilesList
              session={session}
              selectedPath={selectedFilePath}
              onSelectFile={handleSelectFile}
            />
          </aside>
        )}
        <main className="replay-main">
          {isReviewerView && <ReviewerHighlights normalized={normalized} reviewer={reviewer} />}
          {isReviewerView && (
            <ReviewerFocusPanel
              session={session}
              normalized={normalized}
              reviewer={reviewer}
              currentIndex={currentIndex}
              onSeek={handleSeek}
              criticalEvents={criticalEvents}
            />
          )}
          {viewMode === "pivot" && pivotSubView === "flow" && (
            <FlowView
              session={session}
              currentIndex={currentIndex}
              onSeek={handleSeek}
              isPlaying={isPlaying}
              onPlay={handlePlay}
              onPause={handlePause}
              onOpenInNodeView={() =>
                withViewTransition(() => setPivotSubView("node"))
              }
              focusNodeIndex={flowViewFocusIndex}
              onFocusComplete={() => setFlowViewFocusIndex(null)}
            />
          )}
          {viewMode === "pivot" && pivotSubView === "node" && (
            <NodeView
              session={session}
              currentIndex={currentIndex}
              onSeek={handleSeek}
              onOpenInFlowView={() =>
                withViewTransition(() => {
                  setFlowViewFocusIndex(currentIndex);
                  setPivotSubView("flow");
                })
              }
            />
          )}
          {viewMode === "timeline" && (
            <>
              {selectedFilePath ? (
                <FileEvolutionView
                  session={session}
                  path={selectedFilePath}
                  revisionIndex={selectedRevisionIndex}
                  onRevisionChange={setSelectedRevisionIndex}
                />
              ) : selectedSegment ? (
                <SegmentDetailView
                  session={session}
                  segment={selectedSegment}
                  segmentIndex={selectedSegmentIndex ?? 0}
                  onOpenFileEvolution={handleOpenFileEvolution}
                />
              ) : (
                <div className="replay-placeholder">
                  <p>Select a plan step or a changed file on the left.</p>
                  {segments.length === 0 && (
                    <p className="replay-placeholder-note">
                      This session has no explicit intent boundaries. The UI can still
                      render lifecycle using fallback grouping.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </div>
      <footer className="replay-footer">
        {viewMode === "timeline" || viewMode === "reviewer" ? (
          <>
            <TimelineStrip
              eventCount={eventCount}
              currentIndex={currentIndex}
              onSeek={handleSeek}
              criticalIndices={criticalIndices}
            />
            <PlaybackControls
              isPlaying={isPlaying}
              speed={speed}
              onPlay={handlePlay}
              onPause={handlePause}
              onSpeedChange={setSpeed}
              disabled={eventCount === 0}
            />
          </>
        ) : null}
      </footer>
    </div>
  );
}
