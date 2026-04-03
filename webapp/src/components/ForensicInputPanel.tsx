import { useState, type ChangeEvent } from "react";
import type { Session } from "../types/session";
import {
  attachForensicInputs,
  ForensicInputApiError,
  type ForensicInputAttachResponse,
  type ForensicInputDraft,
  type ForensicInputKind,
} from "../lib/forensicInputs";

interface ForensicInputPanelProps {
  session: Session;
  onAttached?: (response: ForensicInputAttachResponse) => void;
}

interface DraftState {
  name: string;
  content: string;
  origin: "file" | "paste" | null;
  status: "idle" | "reading" | "attaching" | "success" | "error";
  message: string | null;
}

interface ForensicInputSpec {
  kind: ForensicInputKind;
  title: string;
  note: string;
  fileHint: string;
  accept: string;
  placeholder: string;
}

const SPECS: ForensicInputSpec[] = [
  {
    kind: "config_snapshot",
    title: "Config snapshot",
    note: "Attach raw app, agent, or workspace configuration without browser-side parsing.",
    fileHint: "config.json, config.yaml, settings.toml, or similar raw export",
    accept: ".json,.jsonl,.yaml,.yml,.toml,.ini,.cfg,.conf,.txt",
    placeholder: "Paste the raw configuration snapshot here if you do not want to upload a file.",
  },
  {
    kind: "env_snapshot",
    title: "Environment snapshot",
    note: "Attach raw environment or process context to improve trust coverage.",
    fileHint: ".env export, shell dump, or process environment text",
    accept: ".env,.json,.jsonl,.txt,.log",
    placeholder: "Paste the raw environment snapshot here.",
  },
  {
    kind: "proxy_trace",
    title: "Proxy / HAR / curl trace",
    note: "Attach raw outbound trace evidence for non-invasive network coverage.",
    fileHint: "HAR export, proxy log, or curl trace text",
    accept: ".har,.json,.txt,.log,.curl",
    placeholder: "Paste the raw proxy, HAR, or curl trace here.",
  },
];

function createInitialDraft(): DraftState {
  return {
    name: "",
    content: "",
    origin: null,
    status: "idle",
    message: null,
  };
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsText(file);
  });
}

function defaultNameForKind(kind: ForensicInputKind): string {
  if (kind === "config_snapshot") return "config-snapshot.txt";
  if (kind === "env_snapshot") return "env-snapshot.txt";
  return "proxy-trace.txt";
}

function getStatusTone(status: DraftState["status"]): "neutral" | "live" | "danger" {
  if (status === "success") return "live";
  if (status === "error") return "danger";
  return "neutral";
}

export function ForensicInputPanel({ session, onAttached }: ForensicInputPanelProps) {
  const [drafts, setDrafts] = useState<Record<ForensicInputKind, DraftState>>({
    config_snapshot: createInitialDraft(),
    env_snapshot: createInitialDraft(),
    proxy_trace: createInitialDraft(),
  });

  function updateDraft(kind: ForensicInputKind, patch: Partial<DraftState>) {
    setDrafts((current) => ({
      ...current,
      [kind]: {
        ...current[kind],
        ...patch,
      },
    }));
  }

  async function handleFileChange(kind: ForensicInputKind, event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;

    updateDraft(kind, {
      status: "reading",
      message: `Reading ${file.name} as raw text...`,
      origin: "file",
      name: file.name,
    });

    try {
      const content = await readFileAsText(file);
      updateDraft(kind, {
        content,
        status: "idle",
        message: `Loaded ${file.name}. Ready to attach.`,
      });
    } catch (error) {
      updateDraft(kind, {
        status: "error",
        message: error instanceof Error ? error.message : "Failed to read the selected file.",
      });
    }
  }

  async function handleAttach(kind: ForensicInputKind) {
    const draft = drafts[kind];
    const content = draft.content;
    if (!content.trim()) {
      updateDraft(kind, {
        status: "error",
        message: "Paste raw content or upload a file before attaching.",
      });
      return;
    }

    const name = draft.name.trim() || defaultNameForKind(kind);
    const payload: ForensicInputDraft = {
      kind,
      name,
      content,
      origin: draft.origin ?? "paste",
    };

    updateDraft(kind, {
      status: "attaching",
      message: "Attaching raw forensic input to the current session...",
    });

    try {
      const response = await attachForensicInputs(session.id, [payload]);
      updateDraft(kind, {
        status: "success",
        message:
          response.guidance ??
          `Attached ${response.accepted_count || 1} input${response.accepted_count === 1 ? "" : "s"} to the session.`,
      });
      onAttached?.(response);
    } catch (error) {
      const message =
        error instanceof ForensicInputApiError
          ? error.message
          : error instanceof Error
            ? error.message
            : "Forensic input attachment failed.";
      updateDraft(kind, {
        status: "error",
        message,
      });
    }
  }

  return (
    <section className="trust-review__panel trust-review__panel--forensic">
      <header className="trust-review__panel-head">
        <div>
          <p className="trust-review__eyebrow">Forensic inputs</p>
          <h3>Attach optional evidence to broaden session coverage</h3>
        </div>
        <p className="trust-review__panel-note">
          Raw text only. The browser does not parse these inputs.
        </p>
      </header>

      <p className="trust-review__forensic-intro">
        Use these inputs when the agent did not fully cooperate with instrumentation.
        Attach raw snapshots to the current session and let the backend fold them into the next trust analysis.
      </p>

      <div className="trust-review__forensic-grid">
        {SPECS.map((spec) => {
          const draft = drafts[spec.kind];
          return (
            <article className="trust-review__forensic-card" key={spec.kind}>
              <div className="trust-review__forensic-card-head">
                <div>
                  <h4>{spec.title}</h4>
                  <p>{spec.note}</p>
                </div>
                <span className={`trust-review__state-pill trust-review__state-pill--${getStatusTone(draft.status)}`}>
                  {draft.status === "success"
                    ? "Attached"
                    : draft.status === "attaching"
                      ? "Attaching"
                      : draft.status === "reading"
                        ? "Reading"
                        : draft.status === "error"
                          ? "Error"
                          : "Optional"}
                </span>
              </div>

              <label className="trust-review__forensic-field">
                <span>Upload raw file</span>
                <input
                  type="file"
                  accept={spec.accept}
                  onChange={(event) => void handleFileChange(spec.kind, event)}
                />
                <small>{spec.fileHint}</small>
              </label>

              <label className="trust-review__forensic-field">
                <span>Paste raw content</span>
                <textarea
                  value={draft.content}
                  onChange={(event) =>
                    updateDraft(spec.kind, {
                      content: event.target.value,
                      origin: "paste",
                      name: draft.name || defaultNameForKind(spec.kind),
                      status: "idle",
                      message: null,
                    })
                  }
                  placeholder={spec.placeholder}
                  rows={8}
                />
              </label>

              <div className="trust-review__forensic-actions">
                <button
                  type="button"
                  className="trust-review__forensic-button"
                  onClick={() => void handleAttach(spec.kind)}
                  disabled={draft.status === "attaching" || draft.status === "reading"}
                >
                  Attach to session
                </button>
                <span className="trust-review__forensic-name">
                  {draft.name.trim() || "No file selected"}
                </span>
              </div>

              {draft.message ? (
                <p className={`trust-review__forensic-status trust-review__forensic-status--${draft.status}`}>
                  {draft.message}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
