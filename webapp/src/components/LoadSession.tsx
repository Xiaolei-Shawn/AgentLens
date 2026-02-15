import { useCallback, useRef } from "react";
import { validateSession } from "../lib/validateSession";
import type { Session } from "../types/session";

import "./LoadSession.css";

interface LoadSessionProps {
  onLoad: (session: Session) => void;
  onError: (message: string) => void;
}

export function LoadSession({ onLoad, onError }: LoadSessionProps) {
  const inputRef = useRef<HTMLInputElement>(null);

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
      const file = e.dataTransfer.files[0];
      if (file && (file.name.endsWith(".json") || file.name.endsWith(".jsonl"))) handleFile(file);
      else onError("Please drop a .json or .jsonl file.");
    },
    [handleFile, onError]
  );

  const onDragOver = useCallback((e: React.DragEvent) => e.preventDefault(), []);

  const onInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
      e.target.value = "";
    },
    [handleFile]
  );

  return (
    <div className="load-session" onDrop={onDrop} onDragOver={onDragOver}>
      <h1>AL Session Replay</h1>
      <p>Drop a session JSON file here or click to browse.</p>
      <input
        ref={inputRef}
        type="file"
        accept=".json,.jsonl,application/json"
        onChange={onInputChange}
        className="file-input"
        aria-label="Choose session JSON"
      />
      <button type="button" onClick={() => inputRef.current?.click()} className="browse-btn">
        Choose file
      </button>
    </div>
  );
}
