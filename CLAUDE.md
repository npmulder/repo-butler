# Repo Butler — CLAUDE.md

## What is Repo Butler?

Repo Butler is an **AI-powered issue triage and automated bug reproduction tool for open-source maintainers**, built on the Claude Harness Planner → Generator → Evaluator pattern.

It watches connected GitHub repositories for new issues, automatically classifies and triages them, then produces **verified reproduction artifacts** — failing tests and deterministic repro scripts — so maintainers get proof before they start fixing.

### The Pipeline

| Stage | Agent Role | What it does |
|---|---|---|
| **Triage** | Planner | Ingests issue context, produces structured triage artifact (severity, category, label suggestions, reproduction hypothesis). Maintainers can approve or override via a configurable approval gate. |
| **Reproduce** | Generator | Sets up a sandboxed environment (devcontainer → Dockerfile → bootstrap fallback), iteratively generates reproduction artifacts (failing tests, deterministic scripts) using a runtime-feedback refinement loop. |
| **Verify** | Evaluator | Re-runs the reproduction artifact in a clean sandbox, checks determinism (3 reruns, 0% flake rate) and policy compliance (no network, no secrets), then posts results back to the GitHub issue with full evidence. |

### Key Differentiator

**Reproduction-first, not fix-first.** Repo Butler produces verified evidence (fail-to-pass tests, deterministic repro scripts with verification evidence) before anyone writes a line of fix code.

### Target Audience

Open-source maintainers and engineering teams who deal with unverified bug reports and want automated proof before starting fixes.

## Tech Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | **Next.js 15** (App Router) | TypeScript strict mode, server components by default |
| Styling | **Tailwind CSS** | Utility-first; use `cn()` helper from `lib/utils.ts` for conditional classes |
| Auth | **WorkOS AuthKit** | Middleware-based route protection, SSR-compatible |
| Backend / DB | **Convex** | Real-time serverless database, functions, and HTTP actions |
| Package manager | **pnpm** (>=10.x) | Lockfile is committed; always use `pnpm` (never npm/yarn) |
| Runtime | **Node.js 20+** | |
| Icons | **Lucide React** | Consistent icon set across UI |
| CI | **GitHub Actions** | Lint → Typecheck → Build pipeline on every push/PR |

## Architecture Overview

```
┌──────────────────────────────────────────────────┐
│                    Next.js 15                     │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  │
│  │  Marketing  │  │    Auth    │  │  Dashboard  │  │
│  │   (public)  │  │  (public)  │  │ (protected) │  │
│  │   app/      │  │ app/(auth) │  │app/(dashboard)│ │
│  └────────────┘  └────────────┘  └────────────┘  │
│                        │                │         │
│                   WorkOS AuthKit    ConvexProvider │
└──────────────────────┬──────────────────┬─────────┘
                       │                  │
                  ┌────▼────┐      ┌──────▼──────┐
                  │  WorkOS  │      │   Convex    │
                  │  (auth)  │      │  (backend)  │
                  └─────────┘      └──────┬──────┘
                                          │
                                   ┌──────▼──────┐
                                   │   GitHub    │
                                   │  App / API  │
                                   └─────────────┘
```

### Route Groups

- **`app/`** — Root layout, providers, global styles, marketing landing page (`/`)
- **`app/(auth)/`** — Public auth pages: `/login`, `/signup`
- **`app/api/auth/`** — Auth API routes: login redirect, signup redirect, WorkOS callback
- **`app/(dashboard)/`** — Protected routes behind WorkOS middleware. Contains:
  - `dashboard/` — Pipeline activity and reproduction status overview
  - `dashboard/repos/` — Connected repositories and GitHub App installations
  - `dashboard/runs/` — Triage, reproduction, and verification history
  - `dashboard/settings/` — Team, notifications, and approval preferences

### Backend (Convex)

All server-side logic lives in `convex/`:

- **`schema.ts`** — Database table definitions (source of truth for data model)
- **`auth.ts`** — WorkOS AuthKit component configuration
- **`http.ts`** — HTTP router for webhooks (WorkOS user sync, GitHub issue/installation events)
- **`convex.config.ts`** — App-level config with AuthKit component registration
- **`_generated/`** — Auto-generated types (never edit manually)

### Key Shared Code

- **`lib/constants.ts`** — App metadata, navigation items, landing page content
- **`lib/utils.ts`** — `cn()` class-name merging utility (clsx + tailwind-merge)
- **`components/ui/`** — Reusable UI primitives (Button, Card, Badge, etc.)
- **`components/`** — Layout components (Header, Sidebar, UserMenu)
- **`middleware.ts`** — WorkOS AuthKit route protection

## Data Model

The Convex schema in `convex/schema.ts` is the single source of truth. Core tables:

### `users`
| Field | Type | Notes |
|---|---|---|
| `workosId` | `string` | Indexed — WorkOS user identifier |
| `email` | `string` | Indexed |
| `name` | `string?` | Optional display name |
| `avatarUrl` | `string?` | Optional avatar |
| `createdAt` | `number` | Unix timestamp |

Additional tables (repos, runs, settings) will be added as features are built. Always define new tables in `convex/schema.ts` with proper indexes.

## Authentication Flow

1. User visits `/login` or `/signup` → redirected to WorkOS hosted auth
2. WorkOS redirects back to `/api/auth/callback` with authorization code
3. Callback handler creates session, redirects to `/dashboard`
4. `middleware.ts` validates session on every protected route
5. WorkOS webhook syncs user data to Convex `users` table via `convex/http.ts`

## Environment Variables

Documented in `.env.example`. Required for local dev:

```
# Convex
NEXT_PUBLIC_CONVEX_URL=        # Convex deployment URL

# WorkOS AuthKit
WORKOS_CLIENT_ID=              # WorkOS client ID
WORKOS_API_KEY=                # WorkOS API key
WORKOS_COOKIE_PASSWORD=        # 32+ char secret for session encryption
NEXT_PUBLIC_WORKOS_REDIRECT_URI=http://localhost:3000/api/auth/callback

# Future
# GITHUB_APP_ID=
# GITHUB_APP_PRIVATE_KEY=
# GITHUB_WEBHOOK_SECRET=
```

## Development Commands

```bash
pnpm install              # Install dependencies (always use pnpm)
cp .env.example .env.local # Set up local env
npx convex dev            # Start Convex dev server (run in separate terminal)
pnpm dev                  # Start Next.js dev server on port 3000
pnpm lint                 # ESLint (strict, no warnings allowed)
pnpm typecheck            # TypeScript strict check
pnpm build                # Production build
```

## Coding Conventions

### General

- **TypeScript strict mode** — no `any` types, no `@ts-ignore`. Fix type errors properly.
- **Server components by default** — only add `"use client"` when the component needs browser APIs, hooks, or interactivity.
- **Functional components only** — no class components.
- **Named exports** for components; default exports only for Next.js pages/layouts.

### File & Naming

- **Components**: PascalCase filenames (`UserMenu.tsx`, `RepoCard.tsx`)
- **Utilities/hooks**: camelCase filenames (`useAuth.ts`, `formatDate.ts`)
- **Convex functions**: camelCase filenames matching the domain (`repos.ts`, `runs.ts`)
- **Route segments**: kebab-case directories as per Next.js convention

### Styling

- Use **Tailwind CSS utility classes** exclusively. No CSS modules, no styled-components.
- Use the `cn()` helper from `lib/utils.ts` for conditional class composition.
- Follow the existing UI primitives in `components/ui/` for consistency.
- Keep component-specific styles co-located (Tailwind in JSX, not separate files).

### Convex Patterns

- Define all tables and indexes in `convex/schema.ts` before writing queries/mutations.
- Use Convex's type-safe query and mutation builders.
- Keep functions small and focused — one query or mutation per logical operation.
- Use `convex/http.ts` for all webhook handlers.
- Never edit files in `convex/_generated/`.

### Git & Commits

- **Conventional commits**: `feat(scope):`, `fix(scope):`, `refactor(scope):`, etc.
- Subject line: imperative mood, ≤72 characters, no trailing period.
- Body: include summary of changes, rationale, and tests/validation run.
- Append `Co-authored-by: Codex <codex@openai.com>` trailer when committing via agent.
- See `.agents/skills/commit/SKILL.md` for the full commit template.

### Branching

- Feature branches from `main` — named after the Linear ticket (e.g., `feat/RB-42-add-repo-listing`).
- Keep branches short-lived; one PR per Linear ticket.
- Always pull latest `origin/main` before starting work and before opening a PR.

## Planned Feature Roadmap

Matches the Linear project milestones (Phase 1–5):

1. **Repository onboarding** — GitHub App installation flow, repo listing, connection management
2. **Issue ingestion** — GitHub webhook processing (issues opened, labeled, commented), issue snapshot pipeline into Convex
3. **Triage pipeline** — Triager agent (Planner role) with Claude API, structured `triage.json` artifacts, label taxonomy, configurable maintainer approval gate
4. **Reproduction pipeline** — Sandbox runner (Docker, network-off default), Reproducer agent (Generator role), environment strategy (devcontainer → Dockerfile → bootstrap), runtime-feedback refinement loop, `repro_plan.json` and `repro_run.json` artifacts
5. **Verification pipeline** — Verifier agent (Evaluator role), `repro_contract.json` written before reproduction, determinism checks (3 reruns, 0% flake rate), policy compliance enforcement, `verification.json` verdict, GitHub reporter posting results as structured issue comments
6. **Hardening & scale** — Hybrid GitHub App + Actions dispatcher, benchmark regression suite (SWT-Bench + TDD-Bench subsets), security hardening (token isolation, audit logs, secret management)

## Orchestration Context

This repo is managed by **Symphony**, an autonomous orchestration system:

- **Tracker**: Linear (project slug: `claude-harness-repo-butler-b6144219147b`)
- **Agent runtime**: Codex agents pick up Linear tickets and implement them autonomously
- **Workflow**: `WORKFLOW.md` contains the full orchestration spec (status map, execution protocol, workpad conventions)
- **Skills**: `.agents/skills/` contains reusable agent skills (commit, push, pull, land, linear, debug)
- Agents should always consult `WORKFLOW.md` for the execution protocol and status transitions
- PR labels: all PRs created by agents must have the `symphony` label

## CI Pipeline

GitHub Actions (`.github/workflows/ci.yml`) runs on every push to `main` and on PRs:

1. Install dependencies (`pnpm install --frozen-lockfile`)
2. Lint (`pnpm lint`) — zero warnings policy
3. Typecheck (`pnpm typecheck`)
4. Build (`pnpm build`)

All four checks must pass before a PR can be merged. Fix issues locally before pushing.

## Important Rules for Agents

1. **Read `WORKFLOW.md`** before starting any ticket — it defines the full execution protocol.
2. **Never hardcode secrets or API keys.** Use environment variables.
3. **Run `pnpm lint` and `pnpm typecheck`** before every commit. CI will reject failures.
4. **Keep the Convex schema in sync.** Any new data requirement starts with a schema change in `convex/schema.ts`.
5. **Don't modify `convex/_generated/`** — these files are auto-generated by Convex.
6. **Use existing UI primitives** from `components/ui/` before creating new ones.
7. **Server components first.** Only use `"use client"` when truly needed.
8. **One PR per Linear ticket.** Don't bundle unrelated changes.
9. **File follow-up issues** for out-of-scope discoveries instead of expanding the current ticket.
10. **Test your changes** — run validation, capture evidence, and document it in the workpad.

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->
