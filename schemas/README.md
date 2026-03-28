# Artifact Schemas

This directory contains the versioned JSON Schema contracts for the structured
artifacts exchanged by the Triager -> Reproducer -> Verifier pipeline.

## Files

- `triage.v1.json`
- `repro-contract.v1.json`
- `repro-plan.v1.json`
- `repro-run.v1.json`
- `verification.v1.json`
- `examples/*.example.json`

## Versioning Strategy

- Runtime schema identifiers use the format `rb.<type>.v<N>`, for example
  `rb.triage.v1`.
- Schema files are named `<type>.v<N>.json`.
- Breaking schema changes create a new versioned file and keep prior versions in
  place for backwards-compatible readers.
- Consumers detect the correct validator at read time via each artifact's
  `schema_version` field.

## Tooling

- `pnpm generate:schema-types` regenerates `lib/generated/*.d.ts` from the
  versioned JSON Schemas.
- `pnpm validate:schemas` validates the example artifacts, checks negative
  cases, and proves cross-schema rejection with the shared Ajv utility.
