import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertValidArtifact,
  isSchemaVersion,
  type SchemaVersion,
  validateArtifact,
} from "../lib/schema-validator";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const examplesDir = path.join(repoRoot, "schemas", "examples");

const exampleExpectations = [
  { file: "triage.example.json", schemaVersion: "rb.triage.v1" },
  { file: "repro-contract.example.json", schemaVersion: "rb.repro_contract.v1" },
  { file: "repro-plan.example.json", schemaVersion: "rb.repro_plan.v1" },
  { file: "repro-run.example.json", schemaVersion: "rb.repro_run.v1" },
  { file: "verification.example.json", schemaVersion: "rb.verification.v1" },
] as const satisfies ReadonlyArray<{ file: string; schemaVersion: SchemaVersion }>;

type JsonObject = Record<string, unknown>;

async function readJson(filePath: string): Promise<JsonObject> {
  return JSON.parse(await readFile(filePath, "utf8")) as JsonObject;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function expectInvalid(
  label: string,
  schemaVersion: SchemaVersion,
  data: unknown,
  expectedMessage: string,
): void {
  const result = validateArtifact(schemaVersion, data);

  if (result.valid) {
    throw new Error(`${label} unexpectedly validated as ${schemaVersion}.`);
  }

  if (!result.errors.some((error) => error.includes(expectedMessage))) {
    throw new Error(
      `${label} failed without the expected diagnostic "${expectedMessage}".\n` +
        result.errors.join("\n"),
    );
  }

  console.log(`Confirmed invalid: ${label}`);
}

async function main(): Promise<void> {
  const examples = new Map<SchemaVersion, JsonObject>();

  for (const { file, schemaVersion } of exampleExpectations) {
    const filePath = path.join(examplesDir, file);
    const data = await readJson(filePath);
    const actualSchemaVersion = data.schema_version;

    if (!isSchemaVersion(actualSchemaVersion)) {
      throw new Error(`${file} is missing a known schema_version.`);
    }

    if (actualSchemaVersion !== schemaVersion) {
      throw new Error(
        `${file} declares ${actualSchemaVersion} but expected ${schemaVersion}.`,
      );
    }

    assertValidArtifact(schemaVersion, data);
    examples.set(schemaVersion, data);
    console.log(`Validated example: ${file}`);
  }

  const triage = clone(examples.get("rb.triage.v1"));
  const reproPlan = clone(examples.get("rb.repro_plan.v1"));
  const reproRun = clone(examples.get("rb.repro_run.v1"));
  const verification = clone(examples.get("rb.verification.v1"));

  if (!triage || !reproPlan || !reproRun || !verification) {
    throw new Error("Expected all example fixtures to be loaded before negative checks.");
  }

  delete triage.run_id;
  expectInvalid("triage missing run_id", "rb.triage.v1", triage, "run_id");

  reproPlan.commands = "pnpm validate:schemas";
  expectInvalid(
    "repro plan commands wrong type",
    "rb.repro_plan.v1",
    reproPlan,
    "/commands: must be array",
  );

  reproRun.iteration = "1";
  expectInvalid(
    "repro run iteration wrong type",
    "rb.repro_run.v1",
    reproRun,
    "/iteration: must be integer",
  );

  verification.determinism = {
    reruns: 3,
    fails: 1,
    flake_rate: 1.5,
  };
  expectInvalid(
    "verification flake_rate out of range",
    "rb.verification.v1",
    verification,
    "/determinism/flake_rate: must be <= 1",
  );

  expectInvalid(
    "triage example rejected by repro-run validator",
    "rb.repro_run.v1",
    examples.get("rb.triage.v1"),
    "iteration",
  );

  console.log(
    `Schema validation passed for ${exampleExpectations.length} examples and 5 negative checks.`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
