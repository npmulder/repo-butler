# Repo Butler

## What is Repo Butler?

Repo Butler is an AI-powered issue triage and automated bug reproduction product for open-source maintainers. It follows a Planner → Generator → Evaluator harness:

- Triager ingests GitHub issue context and produces structured triage artifacts.
- Reproducer spins up sandboxed environments and iterates toward a deterministic failing artifact.
- Verifier re-runs the artifact in a clean environment, enforces determinism and policy checks, and reports evidence back to the issue.

The goal is reproduction-first maintainer evidence, not generic repository operations.

## Architecture overview

- `app/`: Next.js App Router frontend with a marketing landing page, WorkOS entry points, and protected dashboard stubs.
- `convex/`: Convex backend configuration, auth wiring, webhook registration, and placeholder data model.
- `lib/constants.ts`: Product copy and dashboard navigation definitions. Keep this aligned to Repo Butler’s actual workflow.
- `components/`: Shared UI for the dashboard shell and auth-aware controls.

## Dashboard routes

- `/dashboard`: Pipeline overview for triage, reproduction, and verification status.
- `/dashboard/repos`: Connected repositories and GitHub App installation state.
- `/dashboard/runs`: Historical triage, reproduction, and verification runs.
- `/dashboard/settings`: Team policy, notifications, and approval configuration.

## Product language guardrails

- Describe the product as issue triage plus automated bug reproduction.
- Emphasize deterministic reproduction artifacts, verification evidence, and GitHub issue reporting.
- Do not describe the product as a generic repository control plane.
- Do not introduce CI/CD, migrations, or code analysis as the primary product story.

## Planned feature roadmap

1. Repository onboarding
   GitHub App installation, repository connection, and installation health.
2. Issue ingestion
   GitHub webhook processing, issue snapshots, and queueing.
3. Triage pipeline
   Triager agent, structured triage artifacts, label taxonomy, and approval gates.
4. Reproduction pipeline
   Sandbox runner, Reproducer agent, environment strategy, and runtime-feedback loop.
5. Verification pipeline
   Verifier agent, determinism checks, policy compliance, and GitHub reporting.
6. Hardening
   Hybrid dispatcher, benchmark coverage, and security tightening.
