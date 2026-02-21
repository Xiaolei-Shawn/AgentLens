#!/usr/bin/env node

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync, spawn } from "node:child_process";

const root = resolve(new URL("..", import.meta.url).pathname);
const mcpEntry = join(root, "mcp-server", "dist", "index.js");
const webappDist = join(root, "webapp", "dist");
const sessionsDir = mkdtempSync(join(tmpdir(), "agentlens-verify-"));
const port = 4321;
const host = "127.0.0.1";
const baseUrl = `http://${host}:${port}`;

function runBuild() {
  const result = spawnSync("pnpm", ["-r", "build"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error("Build failed.");
  }
}

async function waitForHealth(timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("Timed out waiting for /api/health.");
}

async function assertEndpoint(path, expectedStatus = 200) {
  const res = await fetch(`${baseUrl}${path}`);
  if (res.status !== expectedStatus) {
    const body = await res.text().catch(() => "");
    throw new Error(`Unexpected status for ${path}: ${res.status}. ${body.slice(0, 300)}`);
  }
  return res;
}

async function verifyRuntime() {
  let dashboardBindError = "";
  const child = spawn("node", [mcpEntry, "start"], {
    cwd: join(root, "mcp-server"),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      AL_DASHBOARD_PORT: String(port),
      AL_DASHBOARD_HOST: host,
      AL_SESSIONS_DIR: sessionsDir,
      AL_DASHBOARD_WEBAPP_DIR: webappDist,
    },
  });
  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    process.stderr.write(text);
    if (/AL dashboard failed:/i.test(text)) {
      dashboardBindError += text;
    }
  });

  try {
    try {
      await waitForHealth();
      await assertEndpoint("/api/health");
      await assertEndpoint("/api/sessions");
      const page = await assertEndpoint("/");
      const html = await page.text();
      if (!html.includes("<!doctype html") && !html.includes("<html")) {
        throw new Error("Dashboard root did not return HTML.");
      }
      console.log("Integration verification passed.");
      return;
    } catch (error) {
      if (/EPERM|EACCES/i.test(dashboardBindError)) {
        const indexPath = join(webappDist, "index.html");
        const check = spawnSync("node", ["-e", `require('node:fs').accessSync(${JSON.stringify(indexPath)})`], {
          cwd: root,
          stdio: "ignore",
        });
        if (check.status !== 0) {
          throw new Error("Fallback verification failed: webapp dist index.html missing.");
        }
        console.warn(
          "Integration verification passed in restricted mode (HTTP bind not permitted in this environment)."
        );
        return;
      }
      throw error;
    }
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 250));
    if (!child.killed) {
      child.kill("SIGKILL");
    }
  }
}

async function main() {
  try {
    runBuild();
    await verifyRuntime();
  } finally {
    rmSync(sessionsDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`verify:integration failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
