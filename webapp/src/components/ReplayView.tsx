import { useState, useCallback, useRef, useEffect } from "react";
import type { Session } from "../types/session";
import { getSegments } from "../lib/segments";
import { PlanNodesPanel } from "./PlanNodesPanel";
import { SegmentDetailView } from "./SegmentDetailView";
import { TimelineStrip } from "./TimelineStrip";
import { PlaybackControls } from "./PlaybackControls";

import "./ReplayView.css";

const BASE_INTERVAL_MS = 2000;

interface ReplayViewProps {
  session: Session;
  onBack: () => void;
}

export function ReplayView({ session, onBack }: ReplayViewProps) {
  const segments = getSegments(session);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState<number | null>(
    segments.length > 0 ? 0 : null
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<1 | 2>(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
    const segIdx = segments.findIndex((s) => s.eventIndices.includes(currentIndex));
    setSelectedSegmentIndex(segIdx >= 0 ? segIdx : null);
  }, [currentIndex, segments]);

  useEffect(() => {
    if (!isPlaying) return;
    if (atEnd) {
      stopPlayback();
      return;
    }
    const ms = BASE_INTERVAL_MS / speed;
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
  }, [isPlaying, speed, atEnd, eventCount, stopPlayback]);

  const handleSeek = useCallback(
    (index: number) => {
      setCurrentIndex(index);
      if (isPlaying) stopPlayback();
      const segIdx = segments.findIndex((s) => s.eventIndices.includes(index));
      if (segIdx >= 0) setSelectedSegmentIndex(segIdx);
    },
    [isPlaying, stopPlayback, segments]
  );

  const handleSelectSegment = useCallback(
    (index: number) => {
      setSelectedSegmentIndex(index);
      const seg = segments[index];
      if (seg) setCurrentIndex(seg.planStepIndex);
    },
    [segments]
  );

  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => stopPlayback(), [stopPlayback]);

  const selectedSegment =
    selectedSegmentIndex != null && segments[selectedSegmentIndex]
      ? segments[selectedSegmentIndex]
      : null;

  return (
    <div className="replay-view">
      <header className="replay-header">
        <button type="button" className="back-btn" onClick={onBack} aria-label="Load another session">
          ← Back
        </button>
        <h1 className="replay-title">{session.title}</h1>
        <p className="replay-meta">
          {session.id} · {eventCount} events
        </p>
      </header>
      <div className="replay-layout">
        <PlanNodesPanel
          session={session}
          selectedSegmentIndex={selectedSegmentIndex}
          onSelectSegment={handleSelectSegment}
        />
        <main className="replay-main">
          {selectedSegment ? (
            <SegmentDetailView
              session={session}
              segment={selectedSegment}
              segmentIndex={selectedSegmentIndex ?? 0}
            />
          ) : (
            <div className="replay-placeholder">
              <p>Select a plan step on the left to see timestamp, actions, file changes, and results.</p>
              {segments.length === 0 && (
                <p className="replay-placeholder-note">This session has no plan steps. Load a session that uses <code>record_plan</code> or <code>record_plan_step</code>.</p>
              )}
            </div>
          )}
        </main>
      </div>
      <footer className="replay-footer">
        <TimelineStrip eventCount={eventCount} currentIndex={currentIndex} onSeek={handleSeek} />
        <PlaybackControls
          isPlaying={isPlaying}
          speed={speed}
          onPlay={handlePlay}
          onPause={handlePause}
          onSpeedChange={setSpeed}
          disabled={eventCount === 0}
        />
      </footer>
    </div>
  );
}
