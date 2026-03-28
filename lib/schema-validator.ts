import type { ErrorObject, ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import reproContractSchema from "../schemas/repro-contract.v1.json";
import reproPlanSchema from "../schemas/repro-plan.v1.json";
import reproRunSchema from "../schemas/repro-run.v1.json";
import triageSchema from "../schemas/triage.v1.json";
import verificationSchema from "../schemas/verification.v1.json";

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const validators = {
  "rb.triage.v1": ajv.compile(triageSchema),
  "rb.repro_contract.v1": ajv.compile(reproContractSchema),
  "rb.repro_plan.v1": ajv.compile(reproPlanSchema),
  "rb.repro_run.v1": ajv.compile(reproRunSchema),
  "rb.verification.v1": ajv.compile(verificationSchema),
} as const satisfies Record<string, ValidateFunction>;

export const SCHEMA_VERSIONS = Object.freeze(
  Object.keys(validators) as Array<keyof typeof validators>,
);

export type SchemaVersion = (typeof SCHEMA_VERSIONS)[number];

function formatError(error: ErrorObject): string {
  const missingProperty =
    error.keyword === "required" && typeof error.params.missingProperty === "string"
      ? `/${error.params.missingProperty}`
      : "";

  return `${error.instancePath || "/"}${missingProperty}: ${error.message}`;
}

export function isSchemaVersion(value: unknown): value is SchemaVersion {
  return typeof value === "string" && value in validators;
}

export function validateArtifact(
  schemaVersion: SchemaVersion,
  data: unknown,
): { valid: true } | { valid: false; errors: string[] } {
  const validate = validators[schemaVersion];

  if (!validate) {
    return { valid: false, errors: [`Unknown schema: ${schemaVersion}`] };
  }

  if (validate(data)) {
    return { valid: true };
  }

  return {
    valid: false,
    errors: (validate.errors ?? []).map(formatError),
  };
}

export function assertValidArtifact(schemaVersion: SchemaVersion, data: unknown): void {
  const result = validateArtifact(schemaVersion, data);

  if (!result.valid) {
    throw new Error(
      `Validation failed for ${schemaVersion}:\n${result.errors.join("\n")}`,
    );
  }
}
