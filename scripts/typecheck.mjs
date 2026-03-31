import { spawnSync } from "node:child_process";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const typegenEnv = {
  ...process.env,
  NEXT_PUBLIC_CONVEX_URL:
    process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://placeholder.convex.cloud",
  WORKOS_CLIENT_ID: process.env.WORKOS_CLIENT_ID ?? "client_placeholder",
  WORKOS_API_KEY: process.env.WORKOS_API_KEY ?? "sk_test_placeholder",
  WORKOS_COOKIE_PASSWORD:
    process.env.WORKOS_COOKIE_PASSWORD ??
    "0123456789abcdef0123456789abcdef",
  NEXT_PUBLIC_WORKOS_REDIRECT_URI:
    process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI ??
    "http://localhost:3000/callback",
};

for (const step of [
  {
    args: ["exec", "next", "typegen"],
    env: typegenEnv,
  },
  {
    args: ["exec", "tsc", "--noEmit", "--project", "tsconfig.json"],
    env: process.env,
  },
]) {
  const result = spawnSync(pnpm, step.args, {
    stdio: "inherit",
    env: step.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
