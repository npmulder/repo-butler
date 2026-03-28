# Repo Butler

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

3. Start Convex development mode.

For a normal interactive workflow:

```bash
pnpm exec convex dev
```

For headless or unattended sessions:

```bash
CONVEX_AGENT_MODE=anonymous pnpm exec convex dev
```

4. Start Next.js:

```bash
pnpm dev
```

The app runs at `http://localhost:3000`.

## Environment variables

- `NEXT_PUBLIC_CONVEX_URL`: Convex deployment URL used by the React client.
- `WORKOS_CLIENT_ID`: WorkOS AuthKit client ID.
- `WORKOS_API_KEY`: WorkOS API key. Keep this server-side only.
- `WORKOS_COOKIE_PASSWORD`: 32+ character secret used for encrypted session cookies.
- `NEXT_PUBLIC_WORKOS_REDIRECT_URI`: AuthKit callback URL. In local development this should match `http://localhost:3000/api/auth/callback`.

## Validation commands

```bash
pnpm lint
pnpm tsc --noEmit
pnpm build
pnpm dev
```

## CI and deployment

- `.github/workflows/ci.yml` runs lint, type-check, and build on pushes and pull requests.
- `.github/workflows/convex-deploy.yml` deploys to Convex when `CONVEX_DEPLOY_KEY` is present.
