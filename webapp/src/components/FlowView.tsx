/**
 * Flow View — multi-row snaking grid. Pan and zoom (infinite canvas).
 */

import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import type { Session } from "../types/session";
import {
  getNodeKind,
  getIconPath,
  isKeyMoment,
  getDurationMs,
  formatDurationMs,
  getEventSummary,
} from "../lib/workflowHelpers";

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

  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
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

  const currentEvent = events[currentIndex];
  const summary = currentEvent ? getEventSummary(currentEvent) : "";

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

  const CONNECTOR_INSET = 2;

  const connectorSegments = useMemo(() => {
    const out: { exit: [number, number]; entry: [number, number] }[] = [];
    for (let i = 0; i < positions.length - 1; i++) {
      const [cx0, cy0] = positions[i];
      const [cx1, cy1] = positions[i + 1];
      const dx = cx1 - cx0;
      const dy = cy1 - cy0;
      const exit = getRectBoundaryPoint(cx0, cy0, halfW, halfH, dx, dy);
      const entry = getRectBoundaryPoint(cx1, cy1, halfW, halfH, -dx, -dy);
      out.push({ exit: exit as [number, number], entry: entry as [number, number] });
    }
    return out;
  }, [positions, halfW, halfH]);

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
                transform={`translate(${-pan.x * zoom}, ${-pan.y * zoom}) scale(${zoom})`}
              >
                {/* Directional connectors: inset so line stops short of box edges; thin line + small arrow */}
                {connectorSegments.map((seg, i) => {
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
                  return (
                    <path
                      key={i}
                      d={`M ${startX} ${startY} L ${endX} ${endY}`}
                      fill="none"
                      stroke="#38bdf8"
                      strokeWidth="2"
                      strokeLinecap="round"
                      markerEnd="url(#flow-arrow)"
                    />
                  );
                })}
                {/* Duration labels at segment midpoints */}
                {connectorSegments.map((seg, i) => {
                  const [x0, y0] = seg.exit;
                  const [x1, y1] = seg.entry;
                  const mx = (x0 + x1) / 2;
                  const my = (y0 + y1) / 2;
                  const dur = getDurationMs(events, i, i + 1);
                  const label = formatDurationMs(dur);
                  const isActive = i === currentIndex - 1;
                  return (
                    <text
                      key={i}
                      x={mx}
                      y={my - 8}
                      textAnchor="middle"
                      fill={isActive ? "#0da6f2" : "rgba(255,255,255,0.5)"}
                      fontSize={10}
                      fontWeight="700"
                    >
                      {label}
                    </text>
                  );
                })}
                {/* Nodes */}
                {events.map((event, i) => {
                  const [cx, cy] = positions[i];
                  const kind = getNodeKind(event, i, lastIndex);
                  const label =
                    event.kind.length > 16
                      ? event.kind.slice(0, 14) + "…"
                      : event.kind;
                  const isCompleted = i < currentIndex;
                  const isCurrent = i === currentIndex;
                  const keyMoment = isKeyMoment(event, i, lastIndex);

                  return (
                    <g
                      key={i}
                      className={`flow-view__node-wrap ${isCurrent ? "flow-view__node-wrap--current" : ""} ${isCurrent && isPlaying ? "flow-view__node-wrap--playing" : ""}`}
                      transform={`translate(${cx}, ${cy})`}
                    >
                      <rect
                        x={-nodeBoxW / 2}
                        y={-nodeBoxH / 2}
                        width={nodeBoxW}
                        height={nodeBoxH}
                        rx={nodeBoxRx}
                        ry={nodeBoxRx}
                        className={`flow-view__node flow-view__node--box ${isCompleted ? "flow-view__node--completed" : ""} ${isCurrent ? "flow-view__node--current" : ""} ${isCurrent && isPlaying ? "flow-view__node--playing" : ""} ${keyMoment ? "flow-view__node--key" : ""}`}
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
                        <circle
                          r={5 * rowScale}
                          cx={nodeBoxW / 2 - 6}
                          cy={-nodeBoxH / 2 + 6}
                          fill="#22c55e"
                        />
                      )}
                      <g
                        className="flow-view__node-icon"
                        transform={`scale(${1.1 * rowScale})`}
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
                          y={-nodeBoxH / 2 + 8}
                          fontSize={10 * rowScale}
                          fill="#fbbf24"
                        >
                          ★
                        </text>
                      )}
                      <text
                        x={0}
                        y={labelY}
                        textAnchor="middle"
                        className="flow-view__label"
                        fill="rgba(255,255,255,0.9)"
                        fontSize={labelFontSize}
                      >
                        {label}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>
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
