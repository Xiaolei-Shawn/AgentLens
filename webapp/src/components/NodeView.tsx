import { useRef, useEffect, useState, useCallback } from "react";
import type { Session, SessionEvent } from "../types/session";
import {
  getNodeKind,
  getIconPath,
  getEventShortLabel,
  formatEventLogLine,
  getDurationMs,
  formatDurationMs,
} from "../lib/workflowHelpers";
import { CurrentEventRenderer } from "./CurrentEventRenderer";

import "./NodeView.css";

const CONNECTOR_WIDTH = 48;
/** Match CSS breakpoint (NodeView.css @media (max-width: 1023px)) */
const MOBILE_BREAKPOINT = 1023;
function getCardWidths(): { side: number; center: number } {
  if (typeof window !== "undefined" && window.innerWidth <= MOBILE_BREAKPOINT) {
    return { side: 200, center: 300 };
  }
  return { side: 220, center: 340 };
}

interface NodeViewProps {
  session: Session;
  currentIndex: number;
  onSeek: (index: number) => void;
  onOpenInFlowView?: () => void;
}

function NodeCard({
  event,
  index,
  lastIndex,
  state,
  isCenter,
  onSelect,
}: {
  event: SessionEvent;
  index: number;
  lastIndex: number;
  state: "completed" | "running" | "pending";
  isCenter: boolean;
  onSelect: () => void;
}) {
  const label = getEventShortLabel(event);
  const kind = getNodeKind(event, index, lastIndex);
  const description =
    event.type === "plan_step" && "step" in event
      ? (event.step as string).slice(0, 60) +
        ((event.step as string).length > 60 ? "…" : "")
      : null;

  return (
    <button
      type="button"
      className={`node-view__card node-view__card--${state} ${isCenter ? "node-view__card--center" : ""}`}
      onClick={onSelect}
      aria-pressed={isCenter}
      aria-label={`Step ${index + 1}: ${label}. Click to focus.`}
    >
      <span className="node-view__card-icon" aria-hidden>
        <svg
          className="node-view__card-icon-svg"
          viewBox="-10 -10 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d={getIconPath(kind)} />
        </svg>
      </span>
      <h3 className="node-view__card-title">{label}</h3>
      {isCenter && description && (
        <p className="node-view__card-desc">{description}</p>
      )}
      {isCenter && (
        <div className="node-view__progress-wrap">
          <div
            className="node-view__progress-bar"
            style={{
              width: `${lastIndex <= 0 ? 100 : (index / lastIndex) * 100}%`,
            }}
          />
        </div>
      )}
    </button>
  );
}

function ConnectorSegment({
  fromIndex,
  toIndex,
  events,
  onSeek,
}: {
  fromIndex: number;
  toIndex: number;
  events: SessionEvent[];
  onSeek: (index: number) => void;
}) {
  const durationMs = getDurationMs(events, fromIndex, toIndex);
  const label = formatDurationMs(durationMs);
  return (
    <button
      type="button"
      className="node-view__connector"
      onClick={() => onSeek(toIndex)}
      title={`Time to next: ${label}. Click to go to next event.`}
      aria-label={`Go to event ${toIndex + 1} (${label} from previous)`}
    >
      <span className="node-view__connector-line" aria-hidden />
      <span className="node-view__connector-label">{label}</span>
    </button>
  );
}

function MetadataPanel({
  event,
  index,
  sessionId,
}: {
  event: SessionEvent;
  index: number;
  sessionId: string;
}) {
  const at = "at" in event && event.at ? event.at : "";
  const timestamp = at || "—";
  const nodeId = `EVT_${index}_${event.type.toUpperCase()}`;

  return (
    <div className="node-view__panel node-view__panel--meta">
      <h4 className="node-view__panel-title">EXECUTION METADATA</h4>
      <div className="node-view__meta-list">
        <div className="node-view__meta-row">
          <span className="node-view__meta-label">Timestamp</span>
          <span className="node-view__meta-value node-view__meta-value--mono">
            {timestamp}
          </span>
        </div>
        <div className="node-view__meta-row">
          <span className="node-view__meta-label">Session ID</span>
          <span
            className="node-view__meta-value node-view__meta-value--mono"
            title={sessionId}
          >
            {sessionId.slice(0, 12)}…
          </span>
        </div>
        <div className="node-view__meta-row">
          <span className="node-view__meta-label">Node ID</span>
          <span className="node-view__meta-value node-view__meta-value--mono">
            {nodeId}
          </span>
        </div>
      </div>
    </div>
  );
}

function LogsPanel({
  events,
  currentIndex,
}: {
  events: SessionEvent[];
  currentIndex: number;
}) {
  const tail = events.slice(Math.max(0, currentIndex - 1), currentIndex + 2);
  return (
    <div className="node-view__panel node-view__panel--logs">
      <h4 className="node-view__panel-title">LOGS</h4>
      <div className="node-view__logs-box">
        {tail.map((e, i) => {
          const idx = Math.max(0, currentIndex - 1) + i;
          return (
            <div
              key={idx}
              className={`node-view__log-line ${idx === currentIndex ? "node-view__log--current" : ""}`}
            >
              {formatEventLogLine(e, idx)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function NodeView({ session, currentIndex, onSeek, onOpenInFlowView }: NodeViewProps) {
  const events = session.events;
  const lastIndex = events.length - 1;
  const current = events[currentIndex];
  const containerRef = useRef<HTMLDivElement>(null);
  const [stripStyle, setStripStyle] = useState<{
    width: number;
    transform: string;
  }>({
    width: 0,
    transform: "translateX(0)",
  });

  const updateStrip = useCallback(() => {
    const el = containerRef.current;
    if (!el || events.length === 0) return;
    const containerWidth = el.offsetWidth;
    const { side: sideW, center: centerW } = getCardWidths();
    let totalWidth = 0;
    const positions: number[] = [];
    for (let i = 0; i < events.length; i++) {
      positions.push(totalWidth);
      const cardW = i === currentIndex ? centerW : sideW;
      totalWidth += cardW + (i < events.length - 1 ? CONNECTOR_WIDTH : 0);
    }
    if (containerWidth <= 0) return;
    const centerLeft = positions[currentIndex];
    const centerCardW = centerW;
    const centerX = centerLeft + centerCardW / 2;
    const containerCenter = containerWidth / 2;
    const tx = containerCenter - centerX;
    setStripStyle({ width: totalWidth, transform: `translateX(${tx}px)` });
  }, [currentIndex, events.length]);

  useEffect(() => {
    updateStrip();
  }, [updateStrip]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(updateStrip);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateStrip]);

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const handler = () => updateStrip();
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [updateStrip]);

  if (events.length === 0) {
    return (
      <div className="node-view node-view--empty">
        <p>No events in this session.</p>
      </div>
    );
  }

  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < lastIndex;

  return (
    <div className="node-view">
      {onOpenInFlowView && (
        <div className="node-view__toolbar node-view__toolbar--sticky">
          <button
            type="button"
            className="node-view__open-flow-btn"
            onClick={onOpenInFlowView}
            aria-label="Open in Flow View and focus on this node"
          >
            Open in Flow View
          </button>
        </div>
      )}
      <div className="node-view__center">
        {/* Rolling wheel: strip of [card][connector][card]... + prev/next arrows */}
        <div className="node-view__carousel-wrap">
          <button
            type="button"
            className="node-view__nav node-view__nav--prev"
            onClick={() => onSeek(currentIndex - 1)}
            disabled={!canGoPrev}
            aria-label="Previous event"
          >
            <span aria-hidden>‹</span>
          </button>
          <div className="node-view__carousel" ref={containerRef}>
            <div
              className="node-view__strip"
              style={{
                width: stripStyle.width || undefined,
                minWidth: stripStyle.width ? undefined : "max-content",
                transform: stripStyle.transform,
              }}
            >
              {events.map((event, i) => {
                const isCenter = i === currentIndex;
                const state =
                  i < currentIndex
                    ? "completed"
                    : i > currentIndex
                      ? "pending"
                      : "running";
                return (
                  <div key={i} className="node-view__strip-cell">
                    <NodeCard
                      event={event}
                      index={i}
                      lastIndex={lastIndex}
                      state={state}
                      isCenter={isCenter}
                      onSelect={() => onSeek(i)}
                    />
                    {i < events.length - 1 && (
                      <ConnectorSegment
                        fromIndex={i}
                        toIndex={i + 1}
                        events={events}
                        onSeek={onSeek}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          <button
            type="button"
            className="node-view__nav node-view__nav--next"
            onClick={() => onSeek(currentIndex + 1)}
            disabled={!canGoNext}
            aria-label="Next event"
          >
            <span aria-hidden>›</span>
          </button>
        </div>
      </div>

      {/* Compact detail: single row, smaller panels */}
      <div className="node-view__detail">
        <MetadataPanel
          event={current}
          index={currentIndex}
          sessionId={session.id}
        />
        <div className="node-view__panel node-view__panel--config">
          <h4 className="node-view__panel-title">CONFIG</h4>
          <div className="node-view__config-list">
            <span className="node-view__meta-value">{current.type}</span>
          </div>
        </div>
        <LogsPanel events={events} currentIndex={currentIndex} />
      </div>

      <div className="node-view__expand">
        <h4 className="node-view__panel-title">EVENT DETAIL</h4>
        <div className="node-view__expand-body">
          <CurrentEventRenderer event={current} index={currentIndex} />
        </div>
      </div>
    </div>
  );
}
