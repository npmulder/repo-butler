# Benchmark Regression Suite

This directory contains the offline regression suite for Repo Butler's triage,
reproduction, and verification pipeline. The suite runs the same Anthropic
prompt/parser flow and Docker sandbox logic used by the app, but does so from a
local CLI so prompt or pipeline changes can be measured without Convex setup.

## Layout

- `swt-bench-subset.json`: curated 20-instance SWT-Bench Lite subset.
- `tdd-bench-subset.json`: curated 10-instance TDD-Bench-Verified subset.
- `fixtures/`: benchmark fixture notes and provenance.
- `run-benchmark.ts`: CLI entrypoint for running the suite.
- `metrics.ts`: metrics aggregation and regression detection helpers.
- `check-regression.ts`: compares a fresh metrics run against `baseline.json`.
- `baseline.json`: checked-in placeholder baseline until the first full run is recorded.

## Provenance

- SWT fixtures are derived from the upstream SWT-Bench Lite filter list in
  `logic-star-ai/swt-bench`.
- TDD fixtures are derived from the `IBM/TDD-Bench-Verified` id list and the
  `princeton-nlp/SWE-bench_Verified` dataset rows.
- As of March 31, 2026, the upstream SWT-Bench Lite filter list does not include
  scikit-learn instances. The committed SWT subset therefore uses the current
  upstream Lite repos: Django, Flask, Requests, Pytest, Sphinx, and SymPy.

## Requirements

- Docker available on the host running the benchmark.
- An LLM credential:
  - `ANTHROPIC_API_KEY` when `LLM_PROVIDER=anthropic` or unset.
  - `OPENROUTER_API_KEY` when `LLM_PROVIDER=openrouter`.
- Sufficient network access to clone the fixture repositories from GitHub.

## Running

Run the full suite:

```bash
pnpm exec tsx benchmarks/run-benchmark.ts --suite all --output-dir benchmarks/results
```

Run only the SWT or TDD subset:

```bash
pnpm exec tsx benchmarks/run-benchmark.ts --suite swt-bench --max-concurrent 2
pnpm exec tsx benchmarks/run-benchmark.ts --suite tdd-bench --max-concurrent 2
```

Compare the latest results to the checked-in baseline:

```bash
pnpm exec tsx benchmarks/check-regression.ts --current benchmarks/results/metrics.json --baseline benchmarks/baseline.json
```

## Outputs

Each benchmark run writes:

- `results.json`: one result object per fixture.
- `metrics.json`: suite-level metrics plus timestamp and selected suite.
- `summary.md`: lightweight markdown summary for CI artifacts.

## Metric Definitions

- `triageAccuracy`: share of fixtures whose final triage classification matched the ground truth class.
- `reproSuccessRate`: share of fixtures where the reproducer produced an artifact that failed on the buggy revision.
- `envFailureRate`: share of fixtures blocked by environment setup issues.
- `verificationPassRate`: share of successful repros that also verified under reruns.
- `failToPassRate`: share of generated artifacts that failed on the buggy SHA and passed on the fix SHA.
- `avgIterations`: average number of reproduction iterations for successful repros.

## Updating the Baseline

`baseline.json` is intentionally a zeroed placeholder until the first trusted
full run is captured. After that run, replace the metric values with the audited
output from `benchmarks/results/metrics.json`.
