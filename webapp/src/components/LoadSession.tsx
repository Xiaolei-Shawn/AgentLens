import { useCallback, useEffect, useRef, useState } from "react";
import { validateSession } from "../lib/validateSession";
import type { Session } from "../types/session";

import "./LoadSession.css";

interface LoadSessionProps {
  onLoad: (session: Session) => void;
  onError: (message: string) => void;
}

interface LocalSessionSummary {
  key: string;
  session_id: string;
  goal?: string;
  started_at?: string;
  ended_at?: string;
  outcome?: "completed" | "partial" | "failed" | "aborted" | "unknown";
  event_count: number;
  updated_at: string;
}

const API_BASE = (import.meta.env.VITE_AUDIT_API_BASE as string | undefined)?.trim() ?? "";

export function LoadSession({ onLoad, onError }: LoadSessionProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isLoadingLocal, setIsLoadingLocal] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localSessions, setLocalSessions] = useState<LocalSessionSummary[]>([]);

  const fetchLocalSessions = useCallback(async () => {
    setIsLoadingLocal(true);
    setLocalError(null);
    try {
      const response = await fetch(`${API_BASE}/api/sessions`, { method: "GET" });
      if (!response.ok) throw new Error(`Session API returned ${response.status}`);
      const data = (await response.json()) as { sessions?: LocalSessionSummary[] };
      const sessions = Array.isArray(data.sessions) ? data.sessions : [];
      setLocalSessions(sessions);
    } catch (err) {
      setLocalSessions([]);
      setLocalError(err instanceof Error ? err.message : "Failed to load local sessions.");
    } finally {
      setIsLoadingLocal(false);
    }
  }, []);

  useEffect(() => {
    void fetchLocalSessions();
  }, [fetchLocalSessions]);

  const loadLocalSession = useCallback(
    async (sessionKey: string) => {
      try {
        const response = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionKey)}`, {
          method: "GET",
        });
        if (!response.ok) throw new Error(`Failed to load session (${response.status})`);
        const data = (await response.json()) as unknown;
        const result = validateSession(data);
        if (result.success) {
          onLoad(result.data);
          return;
        }
        onError(result.errors.map((e) => `${e.instancePath}: ${e.message ?? e.keyword}`).join("\n"));
      } catch (err) {
        onError(err instanceof Error ? err.message : "Failed to load local session.");
      }
    },
    [onError, onLoad]
  );

  const handleFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const result = validateSession(reader.result);
          if (result.success) {
            onLoad(result.data);
          } else {
            onError(result.errors.map((e) => `${e.instancePath}: ${e.message ?? e.keyword}`).join("\n"));
          }
        } catch (err) {
          onError(err instanceof Error ? err.message : "Invalid JSON");
        }
      };
      reader.readAsText(file);
    },
    [onLoad, onError]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragActive(false);
      const file = e.dataTransfer.files[0];
      if (file && (file.name.endsWith(".json") || file.name.endsWith(".jsonl"))) handleFile(file);
      else onError("Please drop a .json or .jsonl file.");
    },
    [handleFile, onError]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!isDragActive) setIsDragActive(true);
  }, [isDragActive]);
  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const nextTarget = e.relatedTarget as Node | null;
    if (!nextTarget || !e.currentTarget.contains(nextTarget)) {
      setIsDragActive(false);
    }
  }, []);

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      e.target.value = "";
    },
    [handleFile]
  );

  return (
    <div
      className={`load-session ${isDragActive ? "is-drag-active" : ""}`}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      <div className="load-session__stars" aria-hidden />
      <div className="load-session__nebula load-session__nebula--one" aria-hidden />
      <div className="load-session__nebula load-session__nebula--two" aria-hidden />
      <div className="load-session__hud-line" aria-hidden />
      <div className="load-session__travel" aria-hidden>
        <svg viewBox="0 0 1200 680" preserveAspectRatio="none" className="load-session__travel-svg">
          <defs>
            <linearGradient id="travelPath" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(56,189,248,0.18)" />
              <stop offset="55%" stopColor="rgba(34,211,238,0.36)" />
              <stop offset="100%" stopColor="rgba(16,185,129,0.26)" />
            </linearGradient>
          </defs>
          <path
            id="travel-route"
            d="M 60 520 C 220 420, 320 490, 470 370 C 620 250, 760 310, 900 210 C 1000 140, 1110 170, 1160 88"
            className="load-session__travel-route"
          />
          <path
            d="M 60 520 C 220 420, 320 490, 470 370 C 620 250, 760 310, 900 210 C 1000 140, 1110 170, 1160 88"
            className="load-session__travel-route-dash"
          />
          <circle cx="470" cy="370" r="6" className="load-session__travel-node" />
          <circle cx="900" cy="210" r="6" className="load-session__travel-node" />
          <circle cx="1160" cy="88" r="6" className="load-session__travel-node" />
          <circle r="7" className="load-session__travel-signal">
            <animateMotion
              dur="4.8s"
              repeatCount="indefinite"
              rotate="auto"
              path="M 60 520 C 220 420, 320 490, 470 370 C 620 250, 760 310, 900 210 C 1000 140, 1110 170, 1160 88"
            />
          </circle>
        </svg>
      </div>
      <div className="load-session__panel">
        <div className="load-session__eyebrow">Agent Lifecycle Console</div>
        <h1>Launch Session Replay</h1>
        <p>
          Import one session file to activate timeline, pivot, and reviewer intelligence.
        </p>
        <div className="load-session__chips" aria-hidden>
          <span>JSON / JSONL</span>
          <span>Risk + Impact</span>
          <span>Mission Replay</span>
        </div>
      </div>
      <div className="load-session__dropzone" role="region" aria-label="Session file drop zone">
        <div className="load-session__drop-icon" aria-hidden>
          ⬡
        </div>
        <div className="load-session__drop-title">
          {isDragActive ? "Release to Import" : "Drop Session File Here"}
        </div>
        <div className="load-session__drop-subtitle">
          or use the command below
        </div>
        <button type="button" onClick={() => inputRef.current?.click()} className="browse-btn">
          Import Session File
        </button>
      </div>
      <div className="load-session__local">
        <div className="load-session__local-head">
          <h2>Local Sessions</h2>
          <button
            type="button"
            onClick={() => void fetchLocalSessions()}
            className="load-session__refresh-btn"
            disabled={isLoadingLocal}
          >
            {isLoadingLocal ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        {localError ? (
          <p className="load-session__local-error">
            Local dashboard API unavailable ({localError}). File import still works.
          </p>
        ) : null}
        {!localError && localSessions.length === 0 ? (
          <p className="load-session__local-empty">No session files found in local storage.</p>
        ) : null}
        <div className="load-session__local-list">
          {localSessions.slice(0, 12).map((session) => (
            <button
              type="button"
              key={`${session.key}-${session.updated_at}`}
              className="load-session__local-item"
              onClick={() => void loadLocalSession(session.key)}
              title={session.goal ?? session.session_id}
            >
              <div className="load-session__local-title">{session.goal ?? session.session_id}</div>
              <div className="load-session__local-meta">
                {session.event_count} events · {session.outcome ?? "unknown"} · {new Date(session.updated_at).toLocaleString()}
              </div>
            </button>
          ))}
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".json,.jsonl,application/json"
        onChange={onInputChange}
        className="file-input"
        aria-label="Choose session JSON"
      />
      <div className="load-session__footnote">Local-only dashboard: browser is a viewer for on-device session files</div>
    </div>
  );
}
