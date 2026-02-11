/**
 * Shared validation for session JSON.
 * Used by MCP flush checks and web app loader.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import type { Session } from "./session-schema.js";
import type { ErrorObject } from "ajv";

const require = createRequire(import.meta.url);
const Ajv = require("ajv").default ?? require("ajv");
const addFormats = require("ajv-formats").default ?? require("ajv-formats");

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(__dirname, "session.schema.json");
const sessionSchema = JSON.parse(readFileSync(schemaPath, "utf-8"));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(sessionSchema);

export interface ValidationSuccess {
  success: true;
  data: Session;
}

export interface ValidationError {
  instancePath: string;
  message?: string;
  params?: Record<string, unknown>;
  keyword: string;
}

export interface ValidationFailure {
  success: false;
  errors: ValidationError[];
}

export type ValidateSessionResult = ValidationSuccess | ValidationFailure;

/**
 * Validates arbitrary data against the canonical session schema.
 * @param data - Parsed JSON (object) or string to parse and validate
 * @returns Typed result with session data, or structured errors
 */
export function validateSession(data: unknown): ValidateSessionResult {
  const toValidate = typeof data === "string" ? (JSON.parse(data) as unknown) : data;
  const valid = validate(toValidate);
  if (valid) {
    return { success: true, data: toValidate as Session };
  }
  const errors: ValidationError[] = (validate.errors || []).map((e: ErrorObject) => ({
    instancePath: e.instancePath,
    message: e.message ?? undefined,
    params: e.params as Record<string, unknown> | undefined,
    keyword: e.keyword,
  }));
  return { success: false, errors };
}
