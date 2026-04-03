import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readVersion(path: string): string | null {
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

const webappVersion = readVersion(resolve(__dirname, "package.json"));
const mcpServerVersion = readVersion(resolve(__dirname, "../mcp-server/package.json"));
const appVersion = process.env.VITE_APP_VERSION ?? mcpServerVersion ?? webappVersion ?? "0.0.0";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(appVersion),
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    css: true,
  },
});
