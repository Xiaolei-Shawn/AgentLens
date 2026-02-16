/**
 * Flow View — multi-row snaking grid. Pan and zoom (infinite canvas).
 */

import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import type { Session, SessionEvent } from "../types/session";
import {
  getNodeKind,
  getIconPath,
  isKeyMoment,
  getDurationMs,
  formatDurationMs,
  getEventSummary,
  formatEventLogLine,
} from "../lib/workflowHelpers";
import { CurrentEventRenderer } from "./CurrentEventRenderer";

import "./FlowView.css";

const DEFAULT_VIEW_WIDTH = 1000;
const DEFAULT_VIEW_HEIGHT = 520;
/** Fixed content size for grid so layout is stable when panning/zooming */
const CONTENT_WIDTH = 1200;
const CONTENT_HEIGHT = 800;
const ZOOM_MIN = 0.15;
const ZOOM_MAX = 4;
const ZOOM_SENSITIVITY = 0.0012;
const ZOOM_STEP = 1.35;
const FOCUS_ANIMATION_MS = 360;
const OPEN_NODE_ANIMATION_MS = 280;

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function animatePanZoom(
  from: { pan: { x: number; y: number }; zoom: number },
  to: { pan: { x: number; y: number }; zoom: number },
  durationMs: number,
  onUpdate: (pan: { x: number; y: number }, zoom: number) => void,
  onComplete: () => void
) {
  const start = performance.now();
  let rafId: number;
  const tick = () => {
    const elapsed = performance.now() - start;
    const t = Math.min(1, elapsed / durationMs);
    const eased = easeOutCubic(t);
    const pan = {
      x: from.pan.x + (to.pan.x - from.pan.x) * eased,
      y: from.pan.y + (to.pan.y - from.pan.y) * eased,
    };
    const zoom = from.zoom + (to.zoom - from.zoom) * eased;
    onUpdate(pan, zoom);
    if (t < 1) rafId = requestAnimationFrame(tick);
    else onComplete();
  };
  rafId = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(rafId);
}

interface FlowViewProps {
  session: Session;
  currentIndex: number;
  onSeek: (index: number) => void;
  isPlaying?: boolean;
  onPlay?: () => void;
  onPause?: () => void;
  onOpenInNodeView?: () => void;
  /** When set, flow view will zoom to center this node (e.g. when switching from Node View). */
  focusNodeIndex?: number | null;
  onFocusComplete?: () => void;
}

const PAD = 48;
const MIN_SLOT_WIDTH = 130;
const NODE_BOX_WIDTH = 44;
const NODE_BOX_HEIGHT = 36;
const NODE_BOX_RX = 8;
const LABEL_FONT_SIZE = 12;
const BAR_WINDOW_SIZE = 20;

type GridLayout = {
  width: number;
  height: number;
  eventsPerRow: number;
  numRows: number;
  slotWidth: number;
  rowHeight: number;
  positions: [number, number][];
  pathD: string;
};

function computeGridLayout(
  n: number,
  viewWidth: number,
  viewHeight: number,
): GridLayout | null {
  if (n === 0) return null;
  const contentW = viewWidth - 2 * PAD;
  const contentH = viewHeight - 2 * PAD;
  if (contentW <= 0 || contentH <= 0) return null;

  const eventsPerRow = Math.max(1, Math.floor(contentW / MIN_SLOT_WIDTH));
  const numRows = Math.ceil(n / eventsPerRow);
  const slotWidth = contentW / eventsPerRow;
  const rowHeight = contentH / numRows;

  const positions: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / eventsPerRow);
    let col = i % eventsPerRow;
    if (row % 2 === 1) col = eventsPerRow - 1 - col;
    const cx = PAD + (col + 0.5) * slotWidth;
    const cy = PAD + (row + 0.5) * rowHeight;
    positions.push([cx, cy]);
  }

  const pathSegments: string[] = [];
  for (let i = 0; i < positions.length; i++) {
    const [x, y] = positions[i];
    pathSegments.push(`${i === 0 ? "M" : "L"} ${x} ${y}`);
  }
  const pathD = pathSegments.join(" ");

  return {
    width: viewWidth,
    height: viewHeight,
    eventsPerRow,
    numRows,
    slotWidth,
    rowHeight,
    positions,
    pathD,
  };
}

/** Ray from (cx,cy) in direction (dx,dy): first intersection with rect [cx±halfW, cy±halfH]. */
function getRectBoundaryPoint(
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  dx: number,
  dy: number,
): [number, number] {
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return [cx + halfW, cy];
  let t = Infinity;
  if (dx > 1e-9) t = Math.min(t, halfW / dx);
  else if (dx < -1e-9) t = Math.min(t, -halfW / dx);
  if (dy > 1e-9) t = Math.min(t, halfH / dy);
  else if (dy < -1e-9) t = Math.min(t, -halfH / dy);
  if (t === Infinity || t <= 0) return [cx + halfW, cy];
  return [cx + t * dx, cy + t * dy];
}

function isCriticalEvent(event: SessionEvent): boolean {
  if (event.kind === "verification" && event.payload.result === "fail") return true;
  if (event.kind === "assumption" && event.payload.risk === "high") return true;
  if (event.kind === "file_op") {
    const target =
      (typeof event.payload.target === "string" ? event.payload.target : "") ||
      (typeof event.scope?.file === "string" ? event.scope.file : "");
    const lower = target.toLowerCase();
    if (
      lower.includes("/api/") ||
      lower.includes("/routes/") ||
      lower.includes("/migrations/") ||
      lower.endsWith("package.json")
    ) {
      return true;
    }
  }
  return false;
}

function isWarningEvent(event: SessionEvent): boolean {
  if (isCriticalEvent(event)) return false;
  if (event.kind === "verification" && event.payload.result === "unknown") return true;
  if (event.kind === "decision") return true;
  return false;
}

function formatClock(ts?: string): string {
  if (!ts) return "--:--:--";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "--:--:--";
  return d.toLocaleTimeString(undefined, { hour12: false });
}

function interpolatePathPoint(points: [number, number][], t: number): [number, number] {
  if (points.length === 0) return [0, 0];
  if (points.length === 1) return points[0];
  const i1 = Math.max(0, Math.min(points.length - 1, Math.floor(t)));
  const i2 = Math.max(0, Math.min(points.length - 1, i1 + 1));
  const i0 = Math.max(0, i1 - 1);
  const i3 = Math.max(0, Math.min(points.length - 1, i2 + 1));
  const localT = Math.max(0, Math.min(1, t - i1));
  const p0 = points[i0];
  const p1 = points[i1];
  const p2 = points[i2];
  const p3 = points[i3];
  const tt = localT * localT;
  const ttt = tt * localT;
  const x =
    0.5 *
    ((2 * p1[0]) +
      (-p0[0] + p2[0]) * localT +
      (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * tt +
      (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * ttt);
  const y =
    0.5 *
    ((2 * p1[1]) +
      (-p0[1] + p2[1]) * localT +
      (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * tt +
      (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * ttt);
  return [x, y];
}

function buildFairCurvePath(points: [number, number][]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

function getIntentId(event: SessionEvent): string {
  if (typeof event.scope?.intent_id === "string" && event.scope.intent_id) {
    return event.scope.intent_id;
  }
  if (typeof event.payload.intent_id === "string" && event.payload.intent_id) {
    return event.payload.intent_id;
  }
  return "intent_fallback";
}

const INTENT_COLORS = [
  "#22d3ee",
  "#38bdf8",
  "#34d399",
  "#f59e0b",
  "#a78bfa",
  "#fb7185",
  "#f97316",
  "#10b981",
];

export function FlowView({
  session,
  currentIndex,
  onSeek,
  isPlaying = false,
  onPlay,
  onPause,
  onOpenInNodeView,
  focusNodeIndex = null,
  onFocusComplete,
}: FlowViewProps) {
  const events = session.events;
  const lastIndex = events.length - 1;
  const canvasRef = useRef<HTMLDivElement>(null);
  const [pathBounds, setPathBounds] = useState({
    width: DEFAULT_VIEW_WIDTH,
    height: DEFAULT_VIEW_HEIGHT,
  });

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0]?.contentRect ?? {};
      if (width > 0 && height > 0) setPathBounds({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(
    () => computeGridLayout(events.length, CONTENT_WIDTH, CONTENT_HEIGHT),
    [events.length],
  );
  const [rideCamera, setRideCamera] = useState(true);
  const [shipPerspective, setShipPerspective] = useState(false);
  const [travelFx, setTravelFx] = useState(0);
  const [travelPosition, setTravelPosition] = useState(currentIndex);

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [selectedTransactionIndex, setSelectedTransactionIndex] = useState<number | null>(null);
  const isPanningRef = useRef(false);
  const startPanRef = useRef({ x: 0, y: 0 });
  const startClientRef = useRef({ x: 0, y: 0 });

  const getViewCoords = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const el = canvasRef.current;
      if (!el) return { x: 0, y: 0 };
      const rect = el.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },
    [],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const view = getViewCoords(e);
      const delta = -e.deltaY * ZOOM_SENSITIVITY;
      const newZoom = Math.max(
        ZOOM_MIN,
        Math.min(ZOOM_MAX, zoom * (1 + delta)),
      );
      if (newZoom === zoom) return;
      const factor = 1 / zoom - 1 / newZoom;
      setPan((p) => ({
        x: p.x + view.x * factor,
        y: p.y + view.y * factor,
      }));
      setZoom(newZoom);
    },
    [zoom, getViewCoords],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if ((e.target as Element).closest?.(".flow-view__node-wrap")) return;
      if ((e.target as Element).closest?.(".flow-view__connector-hit")) return;
      isPanningRef.current = true;
      startPanRef.current = pan;
      startClientRef.current = getViewCoords(e);
    },
    [pan, getViewCoords],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isPanningRef.current) return;
      const view = getViewCoords(e);
      const dx = startClientRef.current.x - view.x;
      const dy = startClientRef.current.y - view.y;
      setPan({
        x: startPanRef.current.x + dx / zoom,
        y: startPanRef.current.y + dy / zoom,
      });
    },
    [zoom, getViewCoords],
  );

  const handleMouseUp = useCallback(() => {
    isPanningRef.current = false;
  }, []);

  const zoomIn = useCallback(() => {
    const el = canvasRef.current;
    const view = el
      ? { x: pathBounds.width / 2, y: pathBounds.height / 2 }
      : { x: 0, y: 0 };
    const newZoom = Math.min(ZOOM_MAX, zoom * ZOOM_STEP);
    if (newZoom === zoom) return;
    const factor = 1 / zoom - 1 / newZoom;
    setPan((p) => ({ x: p.x + view.x * factor, y: p.y + view.y * factor }));
    setZoom(newZoom);
  }, [zoom, pathBounds.width, pathBounds.height]);

  const zoomOut = useCallback(() => {
    const el = canvasRef.current;
    const view = el
      ? { x: pathBounds.width / 2, y: pathBounds.height / 2 }
      : { x: 0, y: 0 };
    const newZoom = Math.max(ZOOM_MIN, zoom / ZOOM_STEP);
    if (newZoom === zoom) return;
    const factor = 1 / zoom - 1 / newZoom;
    setPan((p) => ({ x: p.x + view.x * factor, y: p.y + view.y * factor }));
    setZoom(newZoom);
  }, [zoom, pathBounds.width, pathBounds.height]);

  useEffect(() => {
    const onUp = () => {
      isPanningRef.current = false;
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, []);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => e.preventDefault();
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const focusAnimationRef = useRef<(() => void) | null>(null);
  const travelFxRafRef = useRef<number | null>(null);
  const prevIndexRef = useRef(currentIndex);
  const travelPosRafRef = useRef<number | null>(null);

  const keyMomentIndices = useMemo(
    () => events
      .map((e, i) => (isKeyMoment(e, i, lastIndex) ? i : -1))
      .filter((i) => i >= 0),
    [events, lastIndex]
  );
  const criticalIndices = useMemo(
    () => events
      .map((e, i) => (isCriticalEvent(e) ? i : -1))
      .filter((i) => i >= 0),
    [events]
  );
  const nextKeyMoment = keyMomentIndices.find((i) => i > currentIndex) ?? null;
  const nextCritical = criticalIndices.find((i) => i > currentIndex) ?? null;
  const criticalRatio = events.length === 0 ? 0 : criticalIndices.length / events.length;
  const missionFeed = useMemo(() => {
    const start = Math.max(0, currentIndex - 3);
    return events.slice(start, currentIndex + 1).map((event, offset) => {
      const idx = start + offset;
      return {
        index: idx,
        time: formatClock(event.ts),
        title: event.kind.toUpperCase(),
        detail: getEventSummary(event),
        isCurrent: idx === currentIndex,
      };
    });
  }, [events, currentIndex]);
  const intentOrder = useMemo(() => {
    const order: string[] = [];
    const seen = new Set<string>();
    for (const event of events) {
      const id = getIntentId(event);
      if (!seen.has(id)) {
        seen.add(id);
        order.push(id);
      }
    }
    return order;
  }, [events]);
  const intentColorMap = useMemo(() => {
    const map = new Map<string, string>();
    intentOrder.forEach((id, i) => {
      map.set(id, INTENT_COLORS[i % INTENT_COLORS.length]);
    });
    return map;
  }, [intentOrder]);

  useEffect(() => {
    if (focusNodeIndex == null || !layout || focusNodeIndex < 0 || focusNodeIndex >= layout.positions.length) return;
    focusAnimationRef.current?.();
    const [cx, cy] = layout.positions[focusNodeIndex];
    const targetZoom = 1.8;
    const targetPan = {
      x: cx - pathBounds.width / (2 * targetZoom),
      y: cy - pathBounds.height / (2 * targetZoom),
    };
    focusAnimationRef.current = animatePanZoom(
      { pan: { x: pan.x, y: pan.y }, zoom },
      { pan: targetPan, zoom: targetZoom },
      FOCUS_ANIMATION_MS,
      (p, z) => {
        setPan(p);
        setZoom(z);
      },
      () => {
        focusAnimationRef.current = null;
        onFocusComplete?.();
      }
    );
    return () => {
      focusAnimationRef.current?.();
      focusAnimationRef.current = null;
    };
    // Only run when focusNodeIndex is set (e.g. switching from Node View); layout/pathBounds are from same render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNodeIndex]);

  useEffect(() => {
    if (!shipPerspective) {
      setTravelPosition(currentIndex);
      return;
    }
    if (travelPosRafRef.current != null) cancelAnimationFrame(travelPosRafRef.current);
    const from = travelPosition;
    const to = currentIndex;
    if (Math.abs(to - from) < 0.001) return;
    const start = performance.now();
    const duration = isPlaying ? 1420 : 760;
    const tick = () => {
      const elapsed = performance.now() - start;
      const t = Math.min(1, elapsed / duration);
      const eased = easeOutCubic(t);
      setTravelPosition(from + (to - from) * eased);
      if (t < 1) {
        travelPosRafRef.current = requestAnimationFrame(tick);
      } else {
        travelPosRafRef.current = null;
      }
    };
    travelPosRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (travelPosRafRef.current != null) {
        cancelAnimationFrame(travelPosRafRef.current);
        travelPosRafRef.current = null;
      }
    };
  }, [currentIndex, isPlaying, shipPerspective, travelPosition]);

  useEffect(() => {
    if (!rideCamera || !layout || !isPlaying) return;
    if (shipPerspective) {
      setPan({ x: 0, y: 0 });
      setZoom(1);
      return;
    }
    let rafId: number | null = null;
    const tick = () => {
      const maxIndex = Math.max(0, layout.positions.length - 1);
      const t = Math.max(0, Math.min(maxIndex, currentIndex));
      const [cx, cy] = interpolatePathPoint(layout.positions, t);
      const targetZoom = isPlaying ? 1.24 : 1.12;
      const targetPan = {
        x: cx - pathBounds.width / (2 * targetZoom),
        y: cy - pathBounds.height / (2 * targetZoom),
      };
      setPan((prev) => ({
        x: prev.x + (targetPan.x - prev.x) * 0.16,
        y: prev.y + (targetPan.y - prev.y) * 0.16,
      }));
      setZoom((prev) => prev + (targetZoom - prev) * 0.12);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => {
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [
    currentIndex,
    isPlaying,
    layout,
    isPlaying,
    pathBounds.height,
    pathBounds.width,
    rideCamera,
    shipPerspective,
  ]);

  useEffect(() => {
    if (!(rideCamera && isPlaying)) return;
    if (prevIndexRef.current === currentIndex) return;
    prevIndexRef.current = currentIndex;
    if (travelFxRafRef.current != null) cancelAnimationFrame(travelFxRafRef.current);
    const started = performance.now();
    const DURATION = 520;
    const tick = () => {
      const elapsed = performance.now() - started;
      const t = Math.min(1, elapsed / DURATION);
      // quick burst then cool-down
      const pulse = t < 0.45 ? t / 0.45 : 1 - (t - 0.45) / 0.55;
      setTravelFx(Math.max(0, pulse));
      if (t < 1) {
        travelFxRafRef.current = requestAnimationFrame(tick);
      } else {
        travelFxRafRef.current = null;
        setTravelFx(0);
      }
    };
    travelFxRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (travelFxRafRef.current != null) {
        cancelAnimationFrame(travelFxRafRef.current);
        travelFxRafRef.current = null;
      }
    };
  }, [currentIndex, isPlaying, rideCamera]);

  const currentEvent = events[currentIndex];
  const summary = currentEvent ? getEventSummary(currentEvent) : "";
  const currentTimestamp = currentEvent?.ts || "—";
  const currentNodeId = currentEvent ? `EVT_${currentIndex}_${currentEvent.kind.toUpperCase()}` : "—";
  const logsTail = useMemo(() => {
    const start = Math.max(0, currentIndex - 1);
    return events.slice(start, currentIndex + 2).map((event, offset) => {
      const idx = start + offset;
      return {
        index: idx,
        line: formatEventLogLine(event, idx),
        isCurrent: idx === currentIndex,
      };
    });
  }, [currentIndex, events]);
  const upcomingCritical = criticalIndices.filter((i) => i >= currentIndex).slice(0, 4);
  const cinematicZoom = shipPerspective ? 1 : zoom * (1 + travelFx * 0.14);
  const cinematicPanX = shipPerspective ? 0 : (-pan.x * zoom - (travelFx * 16));
  const cinematicPanY = shipPerspective ? 0 : (-pan.y * zoom);
  const showTravelDenseLabels = !(rideCamera && isPlaying);
  const avgTransitionMs = useMemo(() => {
    if (events.length < 2) return 0;
    let total = 0;
    let count = 0;
    for (let i = 0; i < events.length - 1; i++) {
      const d = getDurationMs(events, i, i + 1);
      if (d != null) {
        total += d;
        count += 1;
      }
    }
    if (count === 0) return 0;
    return Math.round(total / count);
  }, [events]);
  const p95TransitionMs = useMemo(() => {
    if (events.length < 2) return 0;
    const durations: number[] = [];
    for (let i = 0; i < events.length - 1; i++) {
      const d = getDurationMs(events, i, i + 1);
      if (d != null) durations.push(d);
    }
    if (durations.length === 0) return 0;
    durations.sort((a, b) => a - b);
    const idx = Math.min(
      durations.length - 1,
      Math.max(0, Math.ceil(durations.length * 0.95) - 1),
    );
    return Math.round(durations[idx]);
  }, [events]);
  const activeDurationMs = useMemo(() => {
    if (events.length < 2) return 0;
    const first = events[0]?.ts ? new Date(events[0].ts).getTime() : NaN;
    const last = events[events.length - 1]?.ts ? new Date(events[events.length - 1].ts).getTime() : NaN;
    if (!Number.isFinite(first) || !Number.isFinite(last)) return 0;
    return Math.max(0, Math.round(last - first));
  }, [events]);
  const verificationStats = useMemo(() => {
    const all = events.filter((e) => e.kind === "verification");
    const pass = all.filter((e) => e.payload.result === "pass").length;
    const fail = all.filter((e) => e.payload.result === "fail").length;
    const unknown = all.filter((e) => e.payload.result === "unknown").length;
    const health = all.length === 0 ? 0 : Math.max(0, Math.min(100, Math.round((pass / all.length) * 100)));
    const intents = events.filter((e) => e.kind === "intent");
    const intentIds = intents
      .map((e) => {
        const id = e.scope?.intent_id;
        return typeof id === "string" && id ? id : null;
      })
      .filter((id): id is string => Boolean(id));
    const verifiedIntentIds = new Set<string>();
    for (const event of all) {
      const id = event.scope?.intent_id;
      if (typeof id === "string" && id) verifiedIntentIds.add(id);
    }
    const coveragePct = intentIds.length === 0
      ? null
      : Math.round((verifiedIntentIds.size / intentIds.length) * 100);
    const lastVerification = all.length > 0 ? all[all.length - 1] : null;
    return { all: all.length, pass, fail, unknown, health, coveragePct, lastVerification };
  }, [events]);
  const paceBars = useMemo(() => {
    if (events.length < 2) return [20, 24, 28, 32, 36];
    const durations: number[] = [];
    for (let i = 0; i < events.length - 1; i++) {
      const d = getDurationMs(events, i, i + 1);
      if (d != null) durations.push(d);
    }
    const tail = durations.slice(-5);
    if (tail.length === 0) return [20, 24, 28, 32, 36];
    const max = Math.max(...tail, 1);
    return tail.map((d) => Math.max(18, Math.round((d / max) * 86)));
  }, [events]);

  if (!layout) {
    return (
      <div className="flow-view">
        <div className="flow-view__main">
          <div ref={canvasRef} className="flow-view__canvas" />
          {events.length === 0 && (
            <div className="flow-view__status">
              <span>No events in this session.</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  const { positions, rowHeight } = layout;
  const rowScale = Math.min(1, (rowHeight - 8) / 72);
  const nodeBoxW = NODE_BOX_WIDTH * rowScale;
  const nodeBoxH = NODE_BOX_HEIGHT * rowScale;
  const nodeBoxRx = NODE_BOX_RX * rowScale;
  const halfW = nodeBoxW / 2;
  const halfH = nodeBoxH / 2;
  const labelY = nodeBoxH / 2 + 14;
  const labelFontSize = Math.round(LABEL_FONT_SIZE * rowScale);
  const laneRows = Array.from({ length: layout.numRows }, (_, row) => {
    const start = row * layout.eventsPerRow;
    const end = Math.min(events.length, start + layout.eventsPerRow);
    const bucket = new Map<string, number>();
    for (let i = start; i < end; i++) {
      const intentId = getIntentId(events[i]);
      bucket.set(intentId, (bucket.get(intentId) ?? 0) + 1);
    }
    let dominantIntent = "intent_fallback";
    let dominantCount = 0;
    for (const [intentId, count] of bucket.entries()) {
      if (count > dominantCount) {
        dominantIntent = intentId;
        dominantCount = count;
      }
    }
    return {
      row,
      y: PAD + row * layout.rowHeight,
      intentId: dominantIntent,
      color: intentColorMap.get(dominantIntent) ?? "#38bdf8",
    };
  });

  const projected = useMemo(() => {
    const horizonY = pathBounds.height * 0.14;
    const centerX = pathBounds.width * 0.5;
    const centerY = pathBounds.height * 0.4;
    const futureDirX = -0.8;
    const futureDirY = -0.6;
    const pastDirX = 0.82;
    const pastDirY = -0.57;
    return positions.map(([x, y], i) => {
      if (!shipPerspective) {
        return { x, y, scale: 1, opacity: 1, depth: 0, isForward: false };
      }
      const delta = i - travelPosition;
      const forward = delta >= 0;
      const depth = Math.abs(delta);
      const falloff = forward
        ? Math.exp(-depth * 0.35)
        : Math.exp(-depth * 0.16);
      const axisDistanceRaw = forward
        ? (Math.pow(depth, 0.72) * (pathBounds.height * 0.74))
        : (Math.pow(depth, 0.86) * (pathBounds.height * 0.34));
      const minSeparation = forward ? 84 : 62;
      const separationFactor = 1 - Math.exp(-depth * 9);
      const axisDistance = axisDistanceRaw + (minSeparation * separationFactor);
      const dirX = forward ? futureDirX : pastDirX;
      const dirY = forward ? futureDirY : pastDirY;
      const perpX = -dirY;
      const perpY = dirX;
      const laneFactor = centerX === 0 ? 0 : (x - centerX) / centerX;
      const swirl = Math.sin(delta * 0.92) * (forward ? 64 : 42) * Math.max(0.24, falloff);
      const laneOffset = laneFactor * (forward ? 36 : 58);
      const lateral = swirl + laneOffset;
      const baseX = centerX + dirX * axisDistance;
      const baseY = centerY + dirY * axisDistance;
      let projX = baseX + perpX * lateral;
      let projY = baseY + perpY * lateral;
      if (forward) {
        projY = Math.max(horizonY, projY);
      }
      const scale = forward
        ? Math.max(0.26, 0.18 + falloff * 0.98)
        : Math.min(1.45, 1 + depth * 0.1);
      let opacity = forward
        ? Math.max(0.2, 0.25 + falloff * 0.88)
        : Math.max(0.18, 1 - depth * 0.16);
      if (depth > 0.04 && depth < 0.35) {
        opacity *= 0.3;
      }
      const isCurrent = i === currentIndex;
      const finalScale = isCurrent ? Math.max(0.96, scale) : scale;
      const finalOpacity = isCurrent ? 1 : opacity;
      return { x: projX, y: projY, scale: finalScale, opacity: finalOpacity, depth, isForward: forward };
    });
  }, [currentIndex, positions, pathBounds.height, pathBounds.width, shipPerspective, travelPosition]);

  const CONNECTOR_INSET = 2;

  const connectorSegments = useMemo(() => {
    const out: { exit: [number, number]; entry: [number, number] }[] = [];
    for (let i = 0; i < projected.length - 1; i++) {
      const p0 = projected[i];
      const p1 = projected[i + 1];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const hw0 = halfW * p0.scale;
      const hh0 = halfH * p0.scale;
      const hw1 = halfW * p1.scale;
      const hh1 = halfH * p1.scale;
      const exit = getRectBoundaryPoint(p0.x, p0.y, hw0, hh0, dx, dy);
      const entry = getRectBoundaryPoint(p1.x, p1.y, hw1, hh1, -dx, -dy);
      out.push({ exit: exit as [number, number], entry: entry as [number, number] });
    }
    return out;
  }, [projected, halfW, halfH]);

  const perspectiveRoutePath = useMemo(() => {
    if (!shipPerspective || projected.length < 2) return "";
    const points: [number, number][] = projected.map((p) => [p.x, p.y]);
    return buildFairCurvePath(points);
  }, [projected, shipPerspective]);

  const renderOrder = useMemo(() => {
    const order = events.map((_, i) => i);
    if (!shipPerspective) return order;
    return order.sort((a, b) => {
      if (a === currentIndex) return 1;
      if (b === currentIndex) return -1;
      const pa = projected[a];
      const pb = projected[b];
      if (pa.scale !== pb.scale) return pa.scale - pb.scale;
      if (pa.depth !== pb.depth) return pb.depth - pa.depth;
      return a - b;
    });
  }, [currentIndex, events, projected, shipPerspective]);
  const navWindowSize = Math.min(BAR_WINDOW_SIZE, events.length);
  const navWindowStart =
    events.length <= BAR_WINDOW_SIZE
      ? 0
      : Math.max(
          0,
          Math.min(currentIndex - Math.floor(navWindowSize / 2), events.length - navWindowSize),
        );
  const navDisplayIndices = Array.from({ length: navWindowSize }, (_, i) => navWindowStart + i);

  const handleOpenInNodeView = useCallback(() => {
    const idx = Math.max(0, Math.min(currentIndex, positions.length - 1));
    const [cx, cy] = positions[idx];
    const targetZoom = 1.8;
    const targetPan = {
      x: cx - pathBounds.width / (2 * targetZoom),
      y: cy - pathBounds.height / (2 * targetZoom),
    };
    focusAnimationRef.current?.();
    focusAnimationRef.current = animatePanZoom(
      { pan: { x: pan.x, y: pan.y }, zoom },
      { pan: targetPan, zoom: targetZoom },
      OPEN_NODE_ANIMATION_MS,
      (p, z) => {
        setPan(p);
        setZoom(z);
      },
      () => {
        focusAnimationRef.current = null;
        onOpenInNodeView?.();
      }
    );
  }, [
    currentIndex,
    positions,
    pathBounds.width,
    pathBounds.height,
    pan,
    zoom,
    onOpenInNodeView,
  ]);

  return (
    <div className="flow-view">
      <div className="flow-view__main">
        <div className="flow-view__canvas-wrap">
          <div
            className={`flow-view__space-layer ${rideCamera && isPlaying ? "is-traveling" : ""}`}
            style={{
              transform: `translate(${(-pan.x * 0.14) - (travelFx * 30)}px, ${-pan.y * 0.06}px) scale(${1 + travelFx * 0.06})`,
            }}
            aria-hidden
          />
          <div
            className={`flow-view__warp-overlay ${rideCamera && isPlaying ? "is-active" : ""}`}
            style={{ opacity: travelFx * 0.5 }}
            aria-hidden
          />
          {shipPerspective && (
            <aside className="flow-view__mission-log" aria-label="Mission log">
              <div className="flow-view__panel-title">Mission Log</div>
              <div className="flow-view__mission-items">
                {missionFeed.map((entry) => (
                  <button
                    key={entry.index}
                    type="button"
                    className={`flow-view__mission-item ${entry.isCurrent ? "is-current" : ""}`}
                    onClick={() => onSeek(entry.index)}
                    title={`Jump to event ${entry.index + 1}`}
                  >
                    <div className="flow-view__mission-dot" />
                    <div>
                      <div className="flow-view__mission-time">TIMESTAMP {entry.time}</div>
                      <div className="flow-view__mission-head">{entry.title}</div>
                      <div className="flow-view__mission-detail">{entry.detail}</div>
                    </div>
                  </button>
                ))}
              </div>
            </aside>
          )}
          <div
            className="flow-view__toolbar flow-view__toolbar--float"
            role="group"
            aria-label="Flow controls"
          >
            <button
              type="button"
              className="flow-view__zoom-btn"
              onClick={zoomIn}
              disabled={zoom >= ZOOM_MAX}
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              className="flow-view__zoom-btn"
              onClick={zoomOut}
              disabled={zoom <= ZOOM_MIN}
              aria-label="Zoom out"
            >
              −
            </button>
            <button
              type="button"
              className={`flow-view__ride-btn ${rideCamera ? "is-active" : ""}`}
              onClick={() =>
                setRideCamera((v) => {
                  const next = !v;
                  if (next) setShipPerspective(false);
                  return next;
                })
              }
              aria-label={rideCamera ? "Disable ride camera mode" : "Enable ride camera mode"}
              title={rideCamera ? "Ride camera: on" : "Ride camera: off"}
            >
              Ride
            </button>
            <button
              type="button"
              className={`flow-view__ride-btn ${shipPerspective ? "is-active" : ""}`}
              onClick={() =>
                setShipPerspective((v) => {
                  const next = !v;
                  if (next) setRideCamera(false);
                  return next;
                })
              }
              aria-label={shipPerspective ? "Disable ship perspective" : "Enable ship perspective"}
              title={shipPerspective ? "Ship perspective: on" : "Ship perspective: off"}
            >
              Perspective
            </button>
            {onPlay && onPause && (
              <>
                <span className="flow-view__toolbar-sep" aria-hidden="true" />
                <button
                  type="button"
                  className="flow-view__play-btn"
                  onClick={isPlaying ? onPause : onPlay}
                  disabled={events.length === 0}
                  aria-label={isPlaying ? "Pause" : "Play"}
                >
                  <span aria-hidden>{isPlaying ? "⏸" : "▶"}</span>
                </button>
                <div
                  className="flow-view__progress-track flow-view__progress-track--toolbar"
                  role="progressbar"
                  aria-valuenow={currentIndex + 1}
                  aria-valuemin={1}
                  aria-valuemax={events.length || 1}
                  aria-label="Event progress"
                  onClick={(e) => {
                    if (events.length <= 0) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const idx = Math.min(
                      events.length - 1,
                      Math.floor((x / rect.width) * events.length),
                    );
                    onSeek(Math.max(0, idx));
                  }}
                >
                  <div
                    className="flow-view__progress-fill"
                    style={{
                      width: `${
                        events.length <= 1 ? 100 : (100 * (currentIndex + 1)) / events.length
                      }%`,
                    }}
                  />
                </div>
                <span className="flow-view__progress-pct" aria-hidden="true">
                  {events.length
                    ? `${Math.round((100 * (currentIndex + 1)) / events.length)}%`
                    : "—"}
                </span>
              </>
            )}
            {onOpenInNodeView && (
              <>
                <span className="flow-view__toolbar-sep" aria-hidden="true" />
                <button
                  type="button"
                  className="flow-view__open-node-btn flow-view__open-node-btn--top"
                  onClick={handleOpenInNodeView}
                  aria-label="Zoom to current node and open Node View"
                >
                  Open in Node View
                </button>
              </>
            )}
          </div>
          <div
            ref={canvasRef}
            className="flow-view__canvas flow-view__canvas--pannable"
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            role="application"
            aria-label="Flow canvas: drag to pan, scroll to zoom"
          >
            <svg
              className="flow-view__svg"
              viewBox={`0 0 ${pathBounds.width} ${pathBounds.height}`}
              preserveAspectRatio="none"
            >
              <defs>
                <pattern id="flow-grid" width="28" height="28" patternUnits="userSpaceOnUse">
                  <path d="M 28 0 L 0 0 0 28" fill="none" stroke="rgba(56,189,248,0.14)" strokeWidth="0.7" />
                </pattern>
                <linearGradient
                  id="flow-path-gradient"
                  x1="0%"
                  y1="100%"
                  x2="100%"
                  y2="0%"
                >
                  <stop offset="0%" stopColor="#0da6f2" />
                  <stop offset="100%" stopColor="#06b6d4" />
                </linearGradient>
                <marker
                  id="flow-arrow"
                  markerUnits="userSpaceOnUse"
                  markerWidth="5"
                  markerHeight="4"
                  refX="4"
                  refY="2"
                  orient="auto"
                >
                  <path d="M0,0 L5,2 L0,4 z" fill="#38bdf8" stroke="none" />
                </marker>
              </defs>
              <g
                className="flow-view__content"
                transform={`translate(${cinematicPanX}, ${cinematicPanY}) scale(${cinematicZoom})`}
              >
                <rect
                  x={0}
                  y={0}
                  width={layout.width}
                  height={layout.height}
                  fill="url(#flow-grid)"
                  opacity={0.55}
                />
                {!shipPerspective &&
                  laneRows.map((lane) => (
                    <rect
                      key={lane.row}
                      x={PAD / 2}
                      y={lane.y}
                      width={layout.width - PAD}
                      height={layout.rowHeight}
                      fill={lane.color}
                      opacity={showTravelDenseLabels ? 0.07 : 0.03}
                      rx={8}
                    />
                  ))}
                {/* Directional connectors: regular mode arrows, perspective mode dotted route */}
                {shipPerspective && perspectiveRoutePath && (
                  <path
                    d={perspectiveRoutePath}
                    fill="none"
                    stroke="rgba(56,189,248,0.92)"
                    strokeWidth="1.8"
                    strokeDasharray="6 8"
                    strokeLinecap="round"
                    opacity={0.95}
                  />
                )}
                {!shipPerspective && connectorSegments.map((seg, i) => {
                  const [x0, y0] = seg.exit;
                  const [x1, y1] = seg.entry;
                  const dx = x1 - x0;
                  const dy = y1 - y0;
                  const len = Math.hypot(dx, dy) || 1;
                  const ux = dx / len;
                  const uy = dy / len;
                  const inset = Math.min(CONNECTOR_INSET, len / 4);
                  const startX = x0 + inset * ux;
                  const startY = y0 + inset * uy;
                  const endX = x1 - inset * ux;
                  const endY = y1 - inset * uy;
                  const pathD = `M ${startX} ${startY} L ${endX} ${endY}`;
                  const mx = (x0 + x1) / 2;
                  const my = (y0 + y1) / 2;
                  const dur = getDurationMs(events, i, i + 1);
                  const durLabel = formatDurationMs(dur);
                  const isActive = i === currentIndex - 1;
                  const showDurLabel = showTravelDenseLabels || i === currentIndex - 1;
                  const isSelected = i === selectedTransactionIndex;
                  return (
                    <g
                      key={i}
                      className={`flow-view__connector-hit ${isSelected ? "flow-view__connector-hit--selected" : ""}`}
                      style={{ cursor: "pointer" }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTransactionIndex((prev) => (prev === i ? null : i));
                      }}
                      role="button"
                      tabIndex={0}
                      aria-label={`Transition from event ${i + 1} to ${i + 2}, ${durLabel}`}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setSelectedTransactionIndex((prev) => (prev === i ? null : i));
                        }
                      }}
                    >
                      <path
                        d={pathD}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={20}
                        strokeLinecap="round"
                      />
                      <path
                        className="flow-view__connector-line"
                        d={pathD}
                        fill="none"
                        stroke={
                          isCriticalEvent(events[i + 1])
                            ? "#f87171"
                            : isWarningEvent(events[i + 1])
                              ? "#f59e0b"
                              : intentColorMap.get(getIntentId(events[i + 1])) ?? "#38bdf8"
                        }
                        strokeWidth={showTravelDenseLabels ? "2" : "1.4"}
                        opacity={1}
                        strokeLinecap="round"
                        markerEnd="url(#flow-arrow)"
                      />
                      {showDurLabel && !shipPerspective && (
                        <text
                          x={mx}
                          y={my - 8}
                          textAnchor="middle"
                          fill={isActive ? "#0da6f2" : "rgba(255,255,255,0.45)"}
                          fontSize={showTravelDenseLabels ? 10 : 8}
                          fontWeight="700"
                          pointerEvents="none"
                        >
                          {durLabel}
                        </text>
                      )}
                    </g>
                  );
                })}
                {/* Nodes */}
                {renderOrder.map((i) => {
                  const event = events[i];
                  const p = projected[i];
                  const cx = p.x;
                  const cy = p.y;
                  const kind = getNodeKind(event, i, lastIndex);
                  const label =
                    event.kind.length > 16
                      ? event.kind.slice(0, 14) + "…"
                      : event.kind;
                  const isCompleted = i < currentIndex;
                  const isCurrent = i === currentIndex;
                  const keyMoment = isKeyMoment(event, i, lastIndex);
                  const critical = isCriticalEvent(event);
                  const warning = isWarningEvent(event);
                  const intentColor = intentColorMap.get(getIntentId(event)) ?? "#38bdf8";
                  const station = `Station ${String(i + 1).padStart(2, "0")}`;
                  const levelTitle = event.kind
                    .split("_")
                    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                    .join(" ");
                  const cardW = Math.max(112, 290 * p.scale);
                  const cardH = Math.max(44, (shipPerspective && isCurrent ? 132 : 92) * p.scale);
                  const subtitleSize = Math.max(7, 11 * p.scale);
                  const titleSize = Math.max(10, 24 * p.scale);
                  const navLabelSize = Math.max(7, 10 * p.scale);
                  const navBarY = -cardH / 2 + cardH * 0.82;
                  const navStartX = -cardW / 2 + cardW * 0.08;
                  const navTrackW = cardW * 0.84;
                  const navGap = Math.max(1.5, 2 * p.scale);
                  const navSegW = navWindowSize > 0
                    ? Math.max(3, (navTrackW - navGap * (navWindowSize - 1)) / navWindowSize)
                    : navTrackW;
                  const navWindowHint =
                    events.length > BAR_WINDOW_SIZE
                      ? ` (${navWindowStart + 1}-${navWindowStart + navWindowSize})`
                      : "";

                  return (
                    <g
                      key={i}
                      className={`flow-view__node-wrap ${isCurrent ? "flow-view__node-wrap--current" : ""} ${isCurrent && isPlaying ? "flow-view__node-wrap--playing" : ""}`}
                      transform={`translate(${cx}, ${cy})`}
                      opacity={p.opacity}
                    >
                      {shipPerspective ? (
                        <>
                          <rect
                            x={-cardW / 2}
                            y={-cardH / 2}
                            width={cardW}
                            height={cardH}
                            rx={Math.max(8, 16 * p.scale)}
                            ry={Math.max(8, 16 * p.scale)}
                            className={`flow-view__event-card ${isCurrent ? "is-current" : ""} ${critical ? "is-critical" : ""} ${warning ? "is-warning" : ""}`}
                            style={{ ["--intent-color" as string]: intentColor }}
                            onClick={() => onSeek(i)}
                            role="button"
                            tabIndex={0}
                            aria-label={`Event ${i + 1}: ${label}`}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                onSeek(i);
                              }
                            }}
                          />
                          <text
                            x={-cardW / 2 + cardW * 0.08}
                            y={-cardH / 2 + cardH * 0.24}
                            textAnchor="start"
                            className="flow-view__event-card-subtitle"
                            fontSize={subtitleSize}
                          >
                            {station}
                          </text>
                          <text
                            x={-cardW / 2 + cardW * 0.08}
                            y={-cardH / 2 + cardH * (isCurrent ? 0.5 : 0.62)}
                            textAnchor="start"
                            className="flow-view__event-card-title"
                            fontSize={titleSize}
                          >
                            {event.kind === "session_end" ? "Mission Complete" : levelTitle}
                          </text>
                          {event.kind !== "session_end" && (
                            <text
                              x={-cardW / 2 + cardW * 0.08}
                              y={-cardH / 2 + cardH * (isCurrent ? 0.68 : 0.78)}
                              textAnchor="start"
                              className="flow-view__event-card-summary"
                              fontSize={Math.max(7, subtitleSize * 0.95)}
                            >
                              {(() => {
                                const summary = getEventSummary(event);
                                return summary.length > 48 ? `${summary.slice(0, 47)}…` : summary;
                              })()}
                            </text>
                          )}
                          {isCurrent && (
                            <>
                              <text
                                x={navStartX}
                                y={-cardH / 2 + cardH * 0.69}
                                textAnchor="start"
                                className="flow-view__event-card-subtitle"
                                fontSize={navLabelSize}
                              >
                                {`${i + 1} / ${events.length}${navWindowHint}`}
                              </text>
                              {navDisplayIndices.map((segIndex, segOffset) => {
                                const x = navStartX + segOffset * (navSegW + navGap);
                                const isNavCurrent = segIndex === i;
                                return (
                                  <rect
                                    key={`nav-${segIndex}`}
                                    x={x}
                                    y={navBarY}
                                    width={navSegW}
                                    height={Math.max(4.5, 6 * p.scale)}
                                    rx={Math.max(1.6, 2.2 * p.scale)}
                                    ry={Math.max(1.6, 2.2 * p.scale)}
                                    fill={isNavCurrent ? "rgba(34,211,238,0.98)" : "rgba(148,163,184,0.52)"}
                                    stroke={isNavCurrent ? "rgba(186,230,253,0.95)" : "rgba(148,163,184,0.2)"}
                                    strokeWidth={isNavCurrent ? Math.max(0.8, 1.1 * p.scale) : Math.max(0.4, 0.7 * p.scale)}
                                    style={{ cursor: "pointer" }}
                                    role="button"
                                    tabIndex={0}
                                    aria-label={`Go to event ${segIndex + 1}`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onSeek(segIndex);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        onSeek(segIndex);
                                      }
                                    }}
                                  />
                                );
                              })}
                            </>
                          )}
                        </>
                      ) : (
                        <>
                          {isCurrent && (
                            <circle
                              r={Math.max(nodeBoxW, nodeBoxH) * 0.85 * p.scale}
                              fill="none"
                              stroke={intentColor}
                              strokeOpacity={0.45}
                              strokeDasharray="6 4"
                              className="flow-view__node-aura"
                            />
                          )}
                          <rect
                            x={-(nodeBoxW * p.scale) / 2}
                            y={-(nodeBoxH * p.scale) / 2}
                            width={nodeBoxW * p.scale}
                            height={nodeBoxH * p.scale}
                            rx={nodeBoxRx}
                            ry={nodeBoxRx}
                            className={`flow-view__node flow-view__node--box ${isCompleted ? "flow-view__node--completed" : ""} ${isCurrent ? "flow-view__node--current" : ""} ${isCurrent && isPlaying ? "flow-view__node--playing" : ""} ${keyMoment ? "flow-view__node--key" : ""} ${critical ? "flow-view__node--critical" : ""} ${warning ? "flow-view__node--warning" : ""}`}
                            style={{ ["--intent-color" as string]: intentColor }}
                            onClick={() => onSeek(i)}
                            role="button"
                            tabIndex={0}
                            aria-label={`Event ${i + 1}: ${label}`}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                onSeek(i);
                              }
                            }}
                          />
                          {isCompleted && (
                            <g className="flow-view__marker flow-view__marker--done">
                              <rect
                                x={(nodeBoxW * p.scale) / 2 - 12}
                                y={-(nodeBoxH * p.scale) / 2 + 2}
                                width={10 * rowScale * p.scale}
                                height={10 * rowScale * p.scale}
                                rx={2 * rowScale}
                                fill="#22c55e"
                              />
                              <text
                                x={(nodeBoxW * p.scale) / 2 - 7}
                                y={-(nodeBoxH * p.scale) / 2 + 10}
                                fontSize={8 * rowScale * p.scale}
                                fill="#052e16"
                                fontWeight="800"
                                textAnchor="middle"
                              >
                                ✓
                              </text>
                            </g>
                          )}
                          <g
                            className="flow-view__node-icon"
                            transform={`scale(${1.1 * rowScale * p.scale})`}
                          >
                            <path
                              d={getIconPath(kind)}
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                            />
                          </g>
                          {keyMoment && (
                            <text
                              x={nodeBoxW / 2 - 4}
                              y={-(nodeBoxH * p.scale) / 2 + 8}
                              fontSize={10 * rowScale * p.scale}
                              fill="#fbbf24"
                            >
                              ★
                            </text>
                          )}
                          {critical && (
                            <text
                              x={-(nodeBoxW * p.scale) / 2 + 3}
                              y={-(nodeBoxH * p.scale) / 2 + 8}
                              fontSize={10 * rowScale * p.scale}
                              fill="#f87171"
                            >
                              !
                            </text>
                          )}
                          <text
                            x={0}
                            y={labelY * p.scale}
                            textAnchor="middle"
                            className="flow-view__label"
                            fill="rgba(255,255,255,0.9)"
                            fontSize={Math.max(7, Math.round(labelFontSize * p.scale))}
                          >
                            {label}
                          </text>
                          {showTravelDenseLabels && !shipPerspective && (
                            <text
                              x={0}
                              y={-nodeBoxH / 2 - 6}
                              textAnchor="middle"
                              fill="rgba(148, 163, 184, 0.8)"
                              fontSize={Math.max(8, Math.round(9 * rowScale))}
                              className="flow-view__station-label"
                            >
                              ST-{String(i + 1).padStart(2, "0")}
                            </text>
                          )}
                        </>
                      )}
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>
          {!shipPerspective && <aside className="flow-view__signal-panel" aria-label="Flow signal panel">
            <div className="flow-view__signal-title">Signal Feed</div>
            <div className="flow-view__signal-stats">
              <span>Key: {keyMomentIndices.length}</span>
              <span>Critical: {criticalIndices.length}</span>
              <span>Danger: {(criticalRatio * 100).toFixed(0)}%</span>
            </div>
            <div className="flow-view__signal-actions">
              <button
                type="button"
                className="flow-view__signal-btn"
                disabled={nextKeyMoment == null}
                onClick={() => nextKeyMoment != null && onSeek(nextKeyMoment)}
              >
                Next Key
              </button>
              <button
                type="button"
                className="flow-view__signal-btn flow-view__signal-btn--critical"
                disabled={nextCritical == null}
                onClick={() => nextCritical != null && onSeek(nextCritical)}
              >
                Next Critical
              </button>
            </div>
            <div className="flow-view__signal-list">
              {upcomingCritical.length === 0 ? (
                <span className="flow-view__signal-empty">No pending critical events.</span>
              ) : (
                upcomingCritical.map((idx) => (
                  <button
                    key={idx}
                    type="button"
                    className={`flow-view__signal-item ${idx === currentIndex ? "is-current" : ""}`}
                    onClick={() => onSeek(idx)}
                    title={`Jump to event ${idx + 1}`}
                  >
                    E{idx + 1} · {events[idx].kind}
                  </button>
                ))
              )}
            </div>
            <div className="flow-view__intent-legend">
              {intentOrder.slice(0, 5).map((intentId) => (
                <div key={intentId} className="flow-view__intent-chip">
                  <span
                    className="flow-view__intent-dot"
                    style={{ backgroundColor: intentColorMap.get(intentId) ?? "#38bdf8" }}
                  />
                  <span className="flow-view__intent-name">{intentId}</span>
                </div>
              ))}
            </div>
            <div className="flow-view__marker-legend">
              <div className="flow-view__marker-item">
                <span className="flow-view__marker-glyph flow-view__marker-glyph--key">★</span>
                <span>Key milestone (intent/start/end/verification)</span>
              </div>
              <div className="flow-view__marker-item">
                <span className="flow-view__marker-glyph flow-view__marker-glyph--critical">!</span>
                <span>Critical event (high risk / failed check)</span>
              </div>
              <div className="flow-view__marker-item">
                <span className="flow-view__marker-glyph flow-view__marker-glyph--done">✓</span>
                <span>Completed in current playback run</span>
              </div>
            </div>
          </aside>}
          {shipPerspective && <aside className="flow-view__telemetry" aria-label="Telemetry">
            <div
              className="flow-view__telemetry-card"
              title="Execution Pace summarizes how quickly the agent moved between events. Lower avg/p95 means smoother, faster progression."
            >
              <div className="flow-view__panel-title">
                Execution Pace
                <span
                  className="flow-view__hint"
                  role="img"
                  aria-label="Execution Pace: average and p95 event-to-event transition durations from timestamps."
                  title="Average and p95 transition durations computed from consecutive event timestamps."
                >
                  i
                </span>
              </div>
              <div className="flow-view__bars">
                {paceBars.map((value, i) => <span key={i} style={{ height: `${value}%` }} />)}
              </div>
              <div
                className="flow-view__telemetry-value"
                title="avg: mean transition time. p95: worst-case tail latency for transitions."
              >
                avg {formatDurationMs(avgTransitionMs)} · p95 {formatDurationMs(p95TransitionMs)}
              </div>
            </div>
            <div
              className="flow-view__telemetry-card"
              title="Verification Health summarizes trust in outputs from verification events and intent-level coverage."
            >
              <div className="flow-view__panel-title">
                Verification Health
                <span
                  className="flow-view__hint"
                  role="img"
                  aria-label="Verification Health: pass rate, pass-fail-unknown counts, and intent verification coverage."
                  title="Pass rate track, pass/fail/unknown counts, plus verified-intent coverage when intent IDs are present."
                >
                  i
                </span>
              </div>
              <div className="flow-view__stability-track">
                <div
                  className="flow-view__stability-fill"
                  style={{ width: `${verificationStats.health}%` }}
                />
              </div>
              <div
                className="flow-view__telemetry-value"
                title="Format: pass/fail/unknown counts · verified intent coverage · active duration."
              >
                {verificationStats.pass}p/{verificationStats.fail}f/{verificationStats.unknown}u
                {" · "}
                {verificationStats.coveragePct == null ? "intent cov N/A" : `intent cov ${verificationStats.coveragePct}%`}
                {" · "}
                active {formatDurationMs(activeDurationMs)}
              </div>
            </div>
          </aside>}
          {shipPerspective && currentEvent && (
            <aside className="flow-view__ops-panels" aria-label="Execution panels">
              <div className="flow-view__ops-card">
                <div className="flow-view__panel-title">Execution Metadata</div>
                <div className="flow-view__ops-list">
                  <div className="flow-view__ops-row">
                    <span>Timestamp</span>
                    <span className="flow-view__ops-mono">{currentTimestamp}</span>
                  </div>
                  <div className="flow-view__ops-row">
                    <span>Session ID</span>
                    <span className="flow-view__ops-mono" title={session.id}>{session.id.slice(0, 12)}…</span>
                  </div>
                  <div className="flow-view__ops-row">
                    <span>Node ID</span>
                    <span className="flow-view__ops-mono">{currentNodeId}</span>
                  </div>
                </div>
              </div>
              <div className="flow-view__ops-card">
                <div className="flow-view__panel-title">Config</div>
                <div className="flow-view__ops-config">{currentEvent.kind}</div>
              </div>
              <div className="flow-view__ops-card flow-view__ops-card--logs">
                <div className="flow-view__panel-title">Logs</div>
                <div className="flow-view__ops-logs">
                  {logsTail.map((log) => (
                    <div
                      key={log.index}
                      className={`flow-view__ops-log-line ${log.isCurrent ? "is-current" : ""}`}
                    >
                      {log.line}
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          )}
          {shipPerspective && currentEvent && (
            <section className="flow-view__event-detail-panel" aria-label="Event detail">
              <div className="flow-view__panel-title">Event Detail</div>
              <div className="flow-view__event-detail-body">
                <CurrentEventRenderer event={currentEvent} index={currentIndex} />
              </div>
            </section>
          )}
          {selectedTransactionIndex != null && events.length > 1 && selectedTransactionIndex < events.length - 1 && (
            <aside className="flow-view__transaction-panel" aria-label="Transaction detail">
              <div className="flow-view__transaction-card">
                <div className="flow-view__panel-title">
                  Transaction E{selectedTransactionIndex + 1} → E{selectedTransactionIndex + 2}
                  <button
                    type="button"
                    className="flow-view__transaction-close"
                    onClick={() => setSelectedTransactionIndex(null)}
                    aria-label="Close transaction detail"
                  >
                    ×
                  </button>
                </div>
                <div className="flow-view__transaction-body">
                  <div className="flow-view__transaction-duration">
                    <span className="flow-view__transaction-label">Duration</span>
                    <span className="flow-view__ops-mono">
                      {formatDurationMs(getDurationMs(events, selectedTransactionIndex, selectedTransactionIndex + 1))}
                    </span>
                  </div>
                  <div className="flow-view__transaction-row">
                    <span className="flow-view__transaction-label">From (E{selectedTransactionIndex + 1})</span>
                    <button
                      type="button"
                      className="flow-view__transaction-seek"
                      onClick={() => onSeek(selectedTransactionIndex)}
                    >
                      {getEventSummary(events[selectedTransactionIndex])}
                    </button>
                  </div>
                  <div className="flow-view__transaction-row">
                    <span className="flow-view__transaction-label">To (E{selectedTransactionIndex + 2})</span>
                    <button
                      type="button"
                      className="flow-view__transaction-seek"
                      onClick={() => onSeek(selectedTransactionIndex + 1)}
                    >
                      {getEventSummary(events[selectedTransactionIndex + 1])}
                    </button>
                  </div>
                  <div className="flow-view__transaction-meta">
                    <div className="flow-view__ops-row">
                      <span>From</span>
                      <span className="flow-view__ops-mono">{formatClock(events[selectedTransactionIndex]?.ts)} · {events[selectedTransactionIndex]?.kind}</span>
                    </div>
                    <div className="flow-view__ops-row">
                      <span>To</span>
                      <span className="flow-view__ops-mono">{formatClock(events[selectedTransactionIndex + 1]?.ts)} · {events[selectedTransactionIndex + 1]?.kind}</span>
                    </div>
                  </div>
                </div>
              </div>
            </aside>
          )}
          <div className="flow-view__desc-panel flow-view__desc-panel--float">
            <span className="flow-view__control-desc" title={summary || undefined}>
              Event {currentIndex + 1} of {events.length}
              {currentEvent && summary && (
                <>
                  {" · "}
                  <span className="flow-view__control-summary">{summary}</span>
                </>
              )}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
