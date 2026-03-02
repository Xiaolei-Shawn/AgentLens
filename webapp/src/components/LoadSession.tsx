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

interface McpImportResponse {
  import_set_id: string;
  sessions?: LocalSessionSummary[];
  rejected_files?: Array<{ name: string; error: string }>;
  guidance?: string;
}

const API_BASE = (import.meta.env.VITE_AUDIT_API_BASE as string | undefined)?.trim() ?? "";

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsText(file);
  });
}

export function LoadSession({ onLoad, onError }: LoadSessionProps) {
  const mcpInputRef = useRef<HTMLInputElement>(null);
  const rawInputRef = useRef<HTMLInputElement>(null);
  const [isLoadingLocal, setIsLoadingLocal] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localSessions, setLocalSessions] = useState<LocalSessionSummary[]>([]);
  const [importSetId, setImportSetId] = useState<string | null>(null);
  const [importedSessions, setImportedSessions] = useState<LocalSessionSummary[]>([]);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [rawMergeStatus, setRawMergeStatus] = useState<string | null>(null);
  const [rawTargetSessionId, setRawTargetSessionId] = useState<string>("");

  const openSessionById = useCallback(
    async (sessionId: string) => {
      if (!sessionId) return;
      try {
        const response = await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}`, {
          method: "GET",
        });
        if (!response.ok) throw new Error(`Failed to open session (${response.status})`);
        const data = (await response.json()) as unknown;
        const result = validateSession(data);
        if (!result.success) {
          throw new Error(result.errors.map((e) => `${e.instancePath}: ${e.message ?? e.keyword}`).join("\n"));
        }
        onLoad(result.data);
      } catch (err) {
        onError(err instanceof Error ? err.message : "Failed to open imported session.");
      }
    },
    [onError, onLoad]
  );

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

  const handleImportMcpFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      try {
        setImportStatus("Importing canonical MCP logs...");
        const payloadFiles = await Promise.all(
          Array.from(files).map(async (file) => ({
            name: file.name,
            content: await readFileAsText(file),
          }))
        );
        const response = await fetch(`${API_BASE}/api/import/mcp`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ files: payloadFiles }),
        });
        const data = (await response.json()) as McpImportResponse & { error?: string };
        if (!response.ok) throw new Error(data.error ?? `MCP import failed (${response.status})`);
        const sessions = Array.isArray(data.sessions) ? data.sessions : [];
        setImportSetId(data.import_set_id);
        setImportedSessions(sessions);
        setRawTargetSessionId(sessions[0]?.session_id ?? "");
        const rejected = Array.isArray(data.rejected_files) ? data.rejected_files.length : 0;
        setImportStatus(
          `Imported ${sessions.length} MCP session(s).${rejected > 0 ? ` Rejected ${rejected} invalid file(s).` : ""}`
        );
        await fetchLocalSessions();
      } catch (err) {
        // Fallback: allow direct local canonical load when dashboard API is stale/unavailable.
        try {
          const first = files[0];
          if (!first) throw err;
          const text = await readFileAsText(first);
          const localResult = validateSession(text);
          if (!localResult.success) {
            throw new Error(
              localResult.errors.map((e) => `${e.instancePath}: ${e.message ?? e.keyword}`).join("\n")
            );
          }
          onLoad(localResult.data);
          setImportStatus(
            "Loaded canonical MCP session locally (API import unavailable). Restart dashboard server to persist import sets."
          );
          return;
        } catch {
          const message = err instanceof Error ? err.message : "Failed to import MCP sessions.";
          setImportStatus(message);
          onError(message);
        }
      }
    },
    [fetchLocalSessions, onError, onLoad]
  );

  const handleMergeRawLog = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      if (!importSetId || !rawTargetSessionId) {
        onError("Import canonical MCP sessions first, then select a target session for raw merge.");
        return;
      }
      try {
        setRawMergeStatus("Merging raw log...");
        const raw = await readFileAsText(files[0]);
        const response = await fetch(`${API_BASE}/api/import/raw-merge`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            import_set_id: importSetId,
            target_session_id: rawTargetSessionId,
            raw,
            adapter: "auto",
            dedupe: true,
          }),
        });
        const data = (await response.json()) as {
          error?: string;
          inserted?: number;
          skipped_duplicates?: number;
        };
        if (!response.ok) throw new Error(data.error ?? `Raw merge failed (${response.status})`);
        setRawMergeStatus(
          `Merged raw log. Inserted ${data.inserted ?? 0} event(s), skipped ${data.skipped_duplicates ?? 0} duplicate(s).`
        );
        await fetchLocalSessions();
        await openSessionById(rawTargetSessionId);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to merge raw log.";
        setRawMergeStatus(message);
        onError(message);
      }
    },
    [fetchLocalSessions, importSetId, onError, openSessionById, rawTargetSessionId]
  );

  return (
    <div className="load-session">
      <div className="load-session__stars" aria-hidden />
      <div className="load-session__nebula load-session__nebula--one" aria-hidden />
      <div className="load-session__nebula load-session__nebula--two" aria-hidden />
      <div className="load-session__hud-line" aria-hidden />
      <div className="load-session__panel">
        <div className="load-session__eyebrow">AgentLens Fusion Console</div>
        <h1>Start With Canonical MCP Logs</h1>
        <p>
          Step 1 imports one or more canonical MCP session logs. Step 2 optionally merges raw Codex/Cursor logs into
          your selected imported session.
        </p>
        <div className="load-session__chips" aria-hidden>
          <span>MCP-first import</span>
          <span>Raw merge only</span>
          <span>Relevance by user</span>
        </div>
      </div>

      <div className="load-session__dropzone" role="region" aria-label="MCP import">
        <div className="load-session__drop-title">Step 1: Import MCP Session Logs</div>
        <div className="load-session__drop-subtitle">
          Recommended: import only relevant or consecutive sessions from the same conversation/thread.
        </div>
        <button type="button" onClick={() => mcpInputRef.current?.click()} className="browse-btn">
          Import Canonical MCP Files
        </button>
        {importStatus ? <p className="load-session__local-empty">{importStatus}</p> : null}
      </div>

      <div className="load-session__dropzone" role="region" aria-label="Raw merge">
        <div className="load-session__drop-title">Step 2: Optional Raw Log Merge</div>
        <div className="load-session__drop-subtitle">
          Raw merge is available only after MCP import and only merges into an imported target session.
        </div>
        <select
          className="browse-btn"
          value={rawTargetSessionId}
          onChange={(event) => setRawTargetSessionId(event.target.value)}
          disabled={importedSessions.length === 0}
          aria-label="Select merge target session"
        >
          {importedSessions.length === 0 ? (
            <option value="">Import MCP sessions first</option>
          ) : null}
          {importedSessions.map((session) => (
            <option key={session.session_id} value={session.session_id}>
              {session.goal ?? session.session_id}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => rawInputRef.current?.click()}
          className="browse-btn"
          disabled={!importSetId || !rawTargetSessionId}
        >
          Merge Raw Codex/Cursor Log
        </button>
        <button
          type="button"
          onClick={() => void openSessionById(rawTargetSessionId)}
          className="browse-btn"
          disabled={!rawTargetSessionId}
        >
          Open Selected Session
        </button>
        {rawMergeStatus ? <p className="load-session__local-empty">{rawMergeStatus}</p> : null}
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
          <p className="load-session__local-error">Local dashboard API unavailable ({localError}).</p>
        ) : null}
        {!localError && localSessions.length === 0 ? (
          <p className="load-session__local-empty">No session files found in local storage.</p>
        ) : null}
        <div className="load-session__local-list">
          {localSessions.slice(0, 16).map((session) => (
            <button
              type="button"
              key={`${session.key}-${session.updated_at}`}
              className="load-session__local-item"
              onClick={() => void loadLocalSession(session.key)}
              title={session.goal ?? session.session_id}
            >
              <div className="load-session__local-title">{session.goal ?? session.session_id}</div>
              <div className="load-session__local-meta">
                {session.event_count} events · {session.outcome ?? "unknown"} ·{" "}
                {new Date(session.updated_at).toLocaleString()}
              </div>
            </button>
          ))}
        </div>
      </div>

      <input
        ref={mcpInputRef}
        type="file"
        multiple
        accept=".json,.jsonl,application/json"
        className="file-input"
        onChange={(event) => {
          void handleImportMcpFiles(event.target.files);
          event.target.value = "";
        }}
        aria-label="Choose canonical MCP session files"
      />
      <input
        ref={rawInputRef}
        type="file"
        accept=".json,.jsonl,.txt,text/plain,application/json"
        className="file-input"
        onChange={(event) => {
          void handleMergeRawLog(event.target.files);
          event.target.value = "";
        }}
        aria-label="Choose raw log file to merge"
      />
      <div className="load-session__footnote">
        Session Fusion rule: MCP canonical logs first, raw logs second. User-curated relevance is required.
      </div>
    </div>
  );
}
