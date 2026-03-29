# Repo Butler

[![CI](https://github.com/npmulder/repo-butler/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/npmulder/repo-butler/actions/workflows/ci.yml)

Repo Butler is an AI-powered issue triage and automated bug reproduction tool for open-source maintainers. It is built around a Planner → Generator → Evaluator pipeline:

- Triager classifies issue severity, category, label suggestions, and a reproduction hypothesis.
- Reproducer launches sandboxed environments and iterates until it produces a failing test or deterministic script.
- Verifier re-runs the artifact in a clean sandbox, enforces determinism and policy checks, and reports evidence back to GitHub.

## Prerequisites

- Node.js 20+
- pnpm 10+

## Local setup

1. Install dependencies:

```bash
pnpm install
```

2. Copy the environment template and fill in WorkOS values:

```bash
cp .env.example .env.local
```

3. Select the shared Convex deployment (`dev:handsome-raven-359`) and populate
   the generated Convex env vars:

```bash
pnpm exec convex dev --once --configure existing
```

This writes `CONVEX_DEPLOYMENT`, `NEXT_PUBLIC_CONVEX_URL`, and
`NEXT_PUBLIC_CONVEX_SITE_URL` into `.env.local`.

4. Start Convex development mode.

For a normal interactive workflow:

```bash
pnpm exec convex dev
```

For headless or unattended sessions:

```bash
CONVEX_AGENT_MODE=anonymous pnpm exec convex dev
```

5. Start Next.js:

```bash
pnpm dev
```

The app runs at `http://localhost:3000`.

## Environment variables

- `NEXT_PUBLIC_CONVEX_URL`: Convex deployment URL used by the React client.
- `NEXT_PUBLIC_CONVEX_SITE_URL`: Convex HTTP actions URL written by Convex when
  you select a deployment.
- `CONVEX_DEPLOYMENT`: Convex deployment ref used by CLI commands such as
  `pnpm run convex:codegen`. Mirror this value into the GitHub Actions
  `CONVEX_DEPLOYMENT` secret for non-interactive CI/CD configuration.
- `WORKOS_CLIENT_ID`: WorkOS AuthKit client ID.
- `WORKOS_API_KEY`: WorkOS API key. Keep this server-side only.
- `WORKOS_COOKIE_PASSWORD`: 32+ character secret used for encrypted session cookies.
- `NEXT_PUBLIC_WORKOS_REDIRECT_URI`: AuthKit callback URL. In local development this should match `http://localhost:3000/callback`.

## Validation commands

```bash
pnpm run convex:codegen
pnpm lint
pnpm tsc --noEmit
pnpm build
pnpm dev
```

## CI and deployment

- `.github/workflows/ci.yml` runs lint, type-check, and build on pushes and pull requests.
- GitHub Actions secret `CONVEX_DEPLOYMENT` should match the shared dev
  deployment for any non-interactive Convex CLI tasks that need deployment
  selection.
- `.github/workflows/convex-deploy.yml` deploys to Convex when
  `CONVEX_DEPLOY_KEY`, `WORKOS_CLIENT_ID`, and `WORKOS_API_KEY` are present.
  The WorkOS credentials are required because `convex.json` enables AuthKit
  auto-configuration during non-interactive deploys.
- `.github/workflows/deploy-cloudflare.yml` builds the Next.js app with
  `@opennextjs/cloudflare`, deploys the `preview` Worker environment for
  pull requests to `main`, and deploys production on pushes to `main`.
- Required GitHub repository secrets for Cloudflare deployment:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
- The Cloudflare deploy workflow uses GitHub `preview` and `production`
  environments for build-time app configuration. Define the existing app values
  there (`NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_WORKOS_REDIRECT_URI`,
  `NEXT_PUBLIC_GITHUB_APP_SLUG`, `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, and
  `WORKOS_COOKIE_PASSWORD`) so the Worker build uses real values for each
  environment.
- Worker deployments run with `wrangler deploy --keep-vars`, so runtime vars and
  secrets that are already managed in Cloudflare are preserved instead of being
  deleted during each GitHub Actions deploy.
- GitHub does not expose repository secrets to workflows triggered from forked
  pull requests, so preview deploys only run for branches in this repository.
