import { codexJsonlAdapter } from "./codex.js";
import { cursorRawAdapter } from "./cursor.js";
import type { AdaptedSession, RawAdapter } from "./types.js";

const adapters: RawAdapter[] = [codexJsonlAdapter, cursorRawAdapter];

export function getAdapters(): RawAdapter[] {
  return adapters;
}

export function adaptRawContent(
  content: string,
  adapterName: string = "auto"
): AdaptedSession {
  if (adapterName !== "auto") {
    const adapter = adapters.find((a) => a.name === adapterName);
    if (!adapter) {
      throw new Error(`Unknown adapter: ${adapterName}`);
    }
    return adapter.adapt(content);
  }

  const adapter = adapters.find((a) => a.canAdapt(content));
  if (!adapter) {
    throw new Error("No raw adapter matched input.");
  }
  return adapter.adapt(content);
}
