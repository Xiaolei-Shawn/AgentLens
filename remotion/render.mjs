#!/usr/bin/env node
/**
 * S31: Render session replay to video.
 * Usage: node render.mjs <session.json> [output.mp4] [compositionId]
 * Reads session JSON (array or { session } or raw session object) and runs remotion render.
 * compositionId: SessionReplay (default) | FunReplay
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

const sessionPath = process.argv[2];
const outputPath = process.argv[3] ?? "out/session.mp4";
const compositionId = process.argv[4] ?? "SessionReplay";

if (!sessionPath) {
  console.error("Usage: node render.mjs <session.json> [output.mp4] [SessionReplay|FunReplay]");
  process.exit(1);
}

let raw;
try {
  raw = JSON.parse(readFileSync(resolve(process.cwd(), sessionPath), "utf-8"));
} catch (e) {
  console.error("Failed to read session JSON:", e.message);
  process.exit(1);
}

const session = Array.isArray(raw) ? raw[0] : raw?.session ?? raw;
if (!session?.events) {
  console.error("Invalid session: expected { id, started_at, title, user_message, events }");
  process.exit(1);
}

const propsPath = resolve(__dirname, "props-render.json");
const fs = await import("fs");
fs.writeFileSync(propsPath, JSON.stringify({ session }), "utf-8");

execSync(
  `npx remotion render src/index.ts ${compositionId} "${outputPath}" --props="${propsPath}"`,
  { cwd: __dirname, stdio: "inherit" }
);
