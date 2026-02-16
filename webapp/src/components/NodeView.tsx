import { useRef, useEffect, useState, useCallback } from "react";
import type { Session, SessionEvent } from "../types/session";
import { getPayloadString } from "../types/session";
import {
  getNodeKind,
  getIconPath,
  getEventShortLabel,
  getDurationMs,
  formatDurationMs,
} from "../lib/workflowHelpers";

import "./NodeView.css";

const CONNECTOR_WIDTH = 48;
const BAR_WINDOW_SIZE = 20;
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
  onSeek,
}: {
  event: SessionEvent;
  index: number;
  lastIndex: number;
  state: "completed" | "running" | "pending";
  isCenter: boolean;
  onSelect: () => void;
  onSeek?: (index: number) => void;
}) {
  const label = getEventShortLabel(event);
  const kind = getNodeKind(event, index, lastIndex);
  const description =
    event.kind === "intent"
      ? ((getPayloadString(event, "description") ?? getPayloadString(event, "title") ?? "").slice(0, 60) +
        ((getPayloadString(event, "description") ?? getPayloadString(event, "title") ?? "").length > 60 ? "…" : ""))
      : null;
  const total = lastIndex + 1;
  const windowSize = Math.min(BAR_WINDOW_SIZE, total);
  const windowStart =
    total <= BAR_WINDOW_SIZE
      ? 0
      : Math.max(
          0,
          Math.min(index - Math.floor(windowSize / 2), total - windowSize),
        );
  const displayIndices = Array.from(
    { length: windowSize },
    (_, i) => windowStart + i,
  );

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
        <div className="node-view__progress-block">
          <span className="node-view__progress-label" aria-hidden>
            {index + 1} / {total}
            {total > BAR_WINDOW_SIZE && (
              <span className="node-view__progress-window-hint">
                {" "}
                ({windowStart + 1}–{windowStart + windowSize})
              </span>
            )}
          </span>
          <div
            className="node-view__progress-wrap"
            role="presentation"
            aria-hidden
          >
            {displayIndices.map((segIndex) => (
              <span
                key={segIndex}
                role="button"
                tabIndex={0}
                className={`node-view__progress-seg ${segIndex === index ? "node-view__progress-seg--current" : ""}`}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onSeek?.(segIndex);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onSeek?.(segIndex);
                  }
                }}
                title={`Go to event ${segIndex + 1}`}
                aria-label={`Go to event ${segIndex + 1} of ${total}`}
              />
            ))}
          </div>
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

export function NodeView({
  session,
  currentIndex,
  onSeek,
  onOpenInFlowView,
}: NodeViewProps) {
  const events = session.events;
  const lastIndex = events.length - 1;
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
                      onSeek={onSeek}
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
    </div>
  );
}
