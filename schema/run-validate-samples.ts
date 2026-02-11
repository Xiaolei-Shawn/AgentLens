/**
 * Run schema validation on sample fixtures. Use in CI or locally.
 * Exit code 0 if all pass, 1 otherwise.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { validateSession } from "./validateSession.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaRoot = join(__dirname, "..");
const samples = ["sample-session-minimal.json", "sample-session-rich.json"];
let failed = 0;

for (const name of samples) {
  const path = join(schemaRoot, name);
  const raw = readFileSync(path, "utf-8");
  const result = validateSession(raw);
  if (result.success) {
    console.log(`OK ${name} (${result.data.events.length} events)`);
  } else {
    console.error(`FAIL ${name}:`, result.errors);
    failed++;
  }
}

process.exit(failed > 0 ? 1 : 0);
