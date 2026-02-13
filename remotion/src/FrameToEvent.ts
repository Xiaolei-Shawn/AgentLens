/**
 * S26: Frame-to-event mapping.
 * Computes startFrame/endFrame per event (equal segments or timestamp-based).
 * useCurrentEvent(session, frame) returns current event index and progress within segment.
 */

import type { Session } from "./types/session";

export type DurationStrategy = "equal" | "timestamp";

export interface EventSegment {
  eventIndex: number;
  startFrame: number;
  endFrame: number;
}

/**
 * Compute startFrame and endFrame for each event.
 * - equal: each event gets the same number of frames (durationInFrames / eventCount).
 * - timestamp: use event.at (ISO) to proportionally distribute frames (requires started_at on session).
 */
export function getEventSegments(
  session: Session,
  durationInFrames: number,
  strategy: DurationStrategy = "equal"
): EventSegment[] {
  const events = session.events;
  const n = events.length;
  if (n === 0) return [];

  if (strategy === "timestamp" && session.started_at) {
    const startMs = new Date(session.started_at).getTime();
    const getMs = (at: string | undefined) =>
      at ? new Date(at).getTime() - startMs : 0;
    const times = events.map((e) => getMs(e.at));
    const lastTime = Math.max(1, times[n - 1] || 1);
    const total = times[n - 1] ?? lastTime;
    if (total <= 0) return getEventSegments(session, durationInFrames, "equal");
    return events.map((_, i) => {
      const segStart = i === 0 ? 0 : (times[i - 1]! / total) * durationInFrames;
      const segEnd = (times[i]! / total) * durationInFrames;
      return {
        eventIndex: i,
        startFrame: Math.floor(segStart),
        endFrame: Math.min(durationInFrames, Math.ceil(segEnd)),
      };
    });
  }

  const framesPerEvent = durationInFrames / n;
  return events.map((_, i) => ({
    eventIndex: i,
    startFrame: Math.floor(i * framesPerEvent),
    endFrame: Math.floor((i + 1) * framesPerEvent),
  }));
}

export interface CurrentEventResult {
  eventIndex: number;
  progress: number; // 0..1 within segment
  segment: EventSegment;
}

/**
 * Given current frame, return the active event index and progress within its segment.
 */
export function getCurrentEvent(
  segments: EventSegment[],
  frame: number
): CurrentEventResult | null {
  if (segments.length === 0) return null;
  const seg = segments.find((s) => frame >= s.startFrame && frame < s.endFrame);
  if (!seg) {
    if (frame < segments[0]!.startFrame)
      return { eventIndex: 0, progress: 0, segment: segments[0]! };
    const last = segments[segments.length - 1]!;
    return {
      eventIndex: last.eventIndex,
      progress: 1,
      segment: last,
    };
  }
  const segmentFrames = seg.endFrame - seg.startFrame;
  const progress =
    segmentFrames > 0 ? (frame - seg.startFrame) / segmentFrames : 1;
  return { eventIndex: seg.eventIndex, progress, segment: seg };
}
