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
- `LLM_PROVIDER`: Provider switch for Claude requests. Use `anthropic` (default)
  for direct Anthropic calls or `openrouter` to proxy those calls through
  OpenRouter.
- `ANTHROPIC_API_KEY`: Required when `LLM_PROVIDER=anthropic`.
- `OPENROUTER_API_KEY`: Required when `LLM_PROVIDER=openrouter`.
- `OPENROUTER_PROVIDER_ORDER`: Optional comma-separated provider preference list
  for OpenRouter fallback routing.
- `OPENROUTER_ROUTE`: Optional OpenRouter routing mode. Use `fallback`
  (default) to preserve the configured provider order or `cheapest` to let
  OpenRouter optimize for price.

## LLM Provider Configuration

Repo Butler uses the Anthropic SDK for Claude requests. `LLM_PROVIDER`
controls whether those requests go straight to Anthropic or through
OpenRouter's Anthropic-compatible endpoint.

| Option | Why you might choose it | Trade-offs |
| --- | --- | --- |
| `anthropic` | Lowest-latency path with the fewest moving parts. | Simplest setup and direct Anthropic billing, but no OpenRouter fallback layer or unified provider billing. |
| `openrouter` | One API key/account for routing and fallback across providers. | Adds a proxy hop and OpenRouter billing/platform overhead, but gives you provider failover and a single billing surface. |

### Direct Anthropic setup

1. Create an Anthropic API key in the Anthropic Console.
2. Set `LLM_PROVIDER=anthropic` in `.env.local`, or leave it unset because
   `anthropic` is the default.
3. Set `ANTHROPIC_API_KEY=...`.
4. Leave `OPENROUTER_*` unset unless you are preparing a later switch.

### OpenRouter setup

1. Create an OpenRouter account.
2. Add credits if your deployment will call paid models.
3. Generate an API key by following the [OpenRouter authentication
   guide](https://openrouter.ai/docs/api/reference/authentication).
4. Set `LLM_PROVIDER=openrouter`.
5. Set `OPENROUTER_API_KEY=...`.
6. Optionally configure routing:
   - `OPENROUTER_PROVIDER_ORDER="Anthropic,Amazon Bedrock,Google"` keeps
     Anthropic first and lets OpenRouter fall back to the next providers.
   - `OPENROUTER_ROUTE=fallback` is the default and preserves the preferred
     provider order with fallbacks enabled.
   - `OPENROUTER_ROUTE=cheapest` ignores the manual provider order and lets
     OpenRouter sort providers by price instead.
7. Do not set `OPENROUTER_BASE_URL`; Repo Butler already points the Anthropic
   SDK at `https://openrouter.ai/api` internally.

### Trade-offs and pricing

- Direct Anthropic is the simplest path and avoids the extra proxy hop, so it
  should have the lowest latency.
- OpenRouter adds provider fallback and consolidated billing, which is useful
  if Anthropic has an outage or you want one place to manage credits and usage.
- OpenRouter says model prices are pass-through, but its pricing page also
  lists a platform fee for pay-as-you-go accounts. Compare the current
  [OpenRouter pricing](https://openrouter.ai/pricing) page with
  [Anthropic pricing](https://claude.com/pricing) before production rollouts.
- OpenRouter's [quickstart guide](https://openrouter.ai/docs/quickstart)
  describes the account, key, and request flow if you want more detail.

## Validation commands

```bash
pnpm run convex:codegen
pnpm lint
pnpm exec tsc --noEmit
pnpm typecheck
pnpm build
pnpm dev
```

`pnpm exec tsc --noEmit` uses the base `tsconfig.json`, which now relies on a
stable `next-env.base.d.ts` shim so it can pass without generated `.next/types`
present.

`pnpm typecheck` runs `next typegen` before `tsc --noEmit --project
tsconfig.next.json`, so generated Next route types are still validated on the
explicit route-aware typecheck path and in CI.

## CI and deployment

- `.github/workflows/ci.yml` runs lint, type-check, and build on pushes and pull requests.
- GitHub Actions secret `CONVEX_DEPLOYMENT` should match the shared dev
  deployment for any non-interactive Convex CLI tasks that need deployment
  selection.
- `.github/workflows/convex-deploy.yml` deploys to Convex when `CONVEX_DEPLOY_KEY` is present. Set GitHub Actions environment variable `APP_URL` in the `production` environment so Convex can configure WorkOS redirect and CORS URLs.
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
  environment. Also define `APP_URL` in `production` and `PREVIEW_APP_URL` in
  `preview` if Convex AuthKit should track those deployed URLs.
- Worker deployments run with `wrangler deploy --keep-vars`, so runtime vars and
  secrets that are already managed in Cloudflare are preserved instead of being
  deleted during each GitHub Actions deploy.
- GitHub does not expose repository secrets to workflows triggered from forked
  pull requests, so preview deploys only run for branches in this repository.
