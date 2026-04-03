export type ForensicInputKind = "config_snapshot" | "env_snapshot" | "proxy_trace";
export type ForensicInputOrigin = "file" | "paste";

export interface ForensicInputDraft {
  kind: ForensicInputKind;
  name: string;
  content: string;
  origin: ForensicInputOrigin;
}

export interface ForensicInputReject {
  index?: number;
  kind?: ForensicInputKind;
  name?: string;
  reason: string;
}

export interface ForensicInputAttachResponse {
  session_id: string;
  accepted_count: number;
  rejected_inputs: ForensicInputReject[];
  guidance?: string;
}

export class ForensicInputApiError extends Error {
  status: number;
  payload: Record<string, unknown> | null;

  constructor(message: string, status: number, payload: Record<string, unknown> | null = null) {
    super(message);
    this.name = "ForensicInputApiError";
    this.status = status;
    this.payload = payload;
  }
}

const API_BASE =
  (import.meta.env.VITE_AUDIT_API_BASE as string | undefined)?.trim() ?? "";

async function readJsonLike(response: Response): Promise<Record<string, unknown>> {
  const raw = await response.text();
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return { error: `Non-JSON response (${response.status}).` };
  }
}

function assertString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Forensic input response missing required field: ${field}`);
  }
  return value;
}

function assertArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Forensic input response missing required array: ${field}`);
  }
  return value;
}

function normalizeReject(value: unknown, path: string): ForensicInputReject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Forensic input response contains an invalid rejection at ${path}`);
  }
  const item = value as Record<string, unknown>;
  return {
    index: typeof item.index === "number" ? item.index : undefined,
    kind:
      item.kind === "config_snapshot" ||
      item.kind === "env_snapshot" ||
      item.kind === "proxy_trace"
        ? item.kind
        : undefined,
    name: typeof item.name === "string" ? item.name : undefined,
    reason: assertString(item.reason, `${path}.reason`),
  };
}

function normalizeResponse(payload: Record<string, unknown>): ForensicInputAttachResponse {
  const forensic =
    payload.forensic && typeof payload.forensic === "object" && !Array.isArray(payload.forensic)
      ? (payload.forensic as Record<string, unknown>)
      : payload;
  const rejected =
    forensic.rejected_inputs ??
    forensic.rejected_files ??
    forensic.rejected;
  const attachments = Array.isArray(forensic.attachments) ? forensic.attachments : [];
  return {
    session_id: assertString((payload.session_id ?? forensic.session_id ?? payload.sessionId), "session_id"),
    accepted_count: Number(
      forensic.accepted_count ??
        forensic.accepted_file_count ??
        forensic.accepted ??
        attachments.length ??
        0,
    ),
    rejected_inputs: rejected == null ? [] : assertArray(rejected, "rejected_inputs").map((item, index) => normalizeReject(item, `rejected_inputs[${index}]`)),
    guidance:
      typeof payload.guidance === "string"
        ? payload.guidance
        : typeof forensic.guidance === "string"
          ? forensic.guidance
          : undefined,
  };
}

export async function attachForensicInputs(
  sessionId: string,
  inputs: ForensicInputDraft[],
  options?: { signal?: AbortSignal },
): Promise<ForensicInputAttachResponse> {
  const response = await fetch(
    `${API_BASE}/api/sessions/${encodeURIComponent(sessionId)}/forensic`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        inputs: inputs.map((input) => ({
          kind: input.kind,
          source_label: input.name,
          data: input.content,
        })),
      }),
      signal: options?.signal,
    },
  );

  const payload = await readJsonLike(response);
  if (!response.ok) {
    throw new ForensicInputApiError(
      typeof payload.error === "string"
        ? payload.error
        : `Forensic input attachment failed (${response.status}).`,
      response.status,
      payload,
    );
  }

  return normalizeResponse(payload);
}
