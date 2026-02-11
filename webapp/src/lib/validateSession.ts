/**
 * Browser-safe session validation using JSON schema.
 * Uses same contract as @al/schema; schema copy in lib for bundle.
 */

import Ajv from "ajv";
import addFormats from "ajv-formats";
import sessionSchema from "./session.schema.json";
import type { Session } from "../types/session";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(sessionSchema);

export interface ValidationError {
  instancePath: string;
  message?: string;
  keyword: string;
}

export interface ValidationFailure {
  success: false;
  errors: ValidationError[];
}

export interface ValidationSuccess {
  success: true;
  data: Session;
}

export type ValidateSessionResult = ValidationSuccess | ValidationFailure;

export function validateSession(data: unknown): ValidateSessionResult {
  const toValidate = typeof data === "string" ? (JSON.parse(data) as unknown) : data;
  const valid = validate(toValidate);
  if (valid) {
    return { success: true, data: toValidate as unknown as Session };
  }
  const errors: ValidationError[] = (validate.errors || []).map((e) => ({
    instancePath: e.instancePath,
    message: e.message ?? undefined,
    keyword: e.keyword,
  }));
  return { success: false, errors };
}
