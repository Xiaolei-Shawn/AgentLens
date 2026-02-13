import { useState, useCallback, useRef, useEffect } from "react";
import { flushSync } from "react-dom";
import type { Session } from "../types/session";
import { getSegments } from "../lib/segments";
import { getRevisionIndexForEvent } from "../lib/fileEvolution";
import { PlanNodesPanel } from "./PlanNodesPanel";
import { ChangedFilesList } from "./ChangedFilesList";
import { SegmentDetailView } from "./SegmentDetailView";
import { FileEvolutionView } from "./FileEvolutionView";
import { TimelineStrip } from "./TimelineStrip";
import { PlaybackControls } from "./PlaybackControls";
import { FlowView } from "./FlowView";
import { NodeView } from "./NodeView";
import { WorkflowPlaybackBar } from "./WorkflowPlaybackBar";
import { getEventShortLabel } from "../lib/workflowHelpers";

import "./ReplayView.css";

const BASE_INTERVAL_MS = 2000;

interface ReplayViewProps {
  session: Session;
  onBack: () => void;
}

export function ReplayView({ session, onBack }: ReplayViewProps) {
  const segments = getSegments(session);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState<
    number | null
  >(segments.length > 0 ? 0 : null);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedRevisionIndex, setSelectedRevisionIndex] = useState(0);
  const [viewMode, setViewMode] = useState<"timeline" | "pivot">("timeline");
  /** When in Pivot, show either flow (graph) or node (detail). Switched via "Open in Node/Flow View" buttons. */
  const [pivotSubView, setPivotSubView] = useState<"flow" | "node">("flow");
  const [flowViewFocusIndex, setFlowViewFocusIndex] = useState<
    number | null
  >(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2>(1);
  const [workflowSpeed, setWorkflowSpeed] = useState(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isWorkflowView = viewMode === "pivot";
  const playbackSpeed = isWorkflowView ? workflowSpeed : speed;

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

  const currentEvent = eventCount > 0 ? session.events[currentIndex] : null;
  const currentStepLabel = currentEvent ? getEventShortLabel(currentEvent) : "";

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
      className={`replay-view ${isWorkflowView ? "replay-view--workflow" : ""}`}
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
            className={viewMode === "pivot" ? "active" : ""}
            onClick={() => setViewMode("pivot")}
          >
            Pivot
          </button>
        </div>
      </header>
      <div className="replay-layout">
        {!isWorkflowView && (
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
                      This session has no plan steps. Load a session that uses{" "}
                      <code>record_plan</code> or <code>record_plan_step</code>.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </div>
      <footer className="replay-footer">
        {viewMode === "pivot" && pivotSubView === "node" ? (
          <WorkflowPlaybackBar
            stepIndex={currentIndex}
            totalSteps={eventCount}
            isPlaying={isPlaying}
            speed={workflowSpeed}
            onPlay={handlePlay}
            onPause={handlePause}
            onSeek={handleSeek}
            onSpeedChange={setWorkflowSpeed}
            currentLabel={currentStepLabel}
            disabled={eventCount === 0}
          />
        ) : viewMode === "timeline" ? (
          <>
            <TimelineStrip
              eventCount={eventCount}
              currentIndex={currentIndex}
              onSeek={handleSeek}
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
