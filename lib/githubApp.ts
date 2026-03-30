import { createHmac, timingSafeEqual } from "node:crypto";
import { App, type Octokit } from "octokit";

let appInstance: App | null = null;
export const githubInstallStateCookieName = "repo-butler-github-install-state";
export const githubInstallStateTtlSeconds = 10 * 60;

type GitHubInstallStatePayload = {
  exp: number;
  nonce: string;
  sub: string;
};

function getRequiredEnv(name: keyof NodeJS.ProcessEnv) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required for GitHub App integration.`);
  }

  return value;
}

function normalizePrivateKey(privateKey: string) {
  return privateKey.includes("\\n")
    ? privateKey.replace(/\\n/g, "\n")
    : privateKey;
}

function signInstallState(payload: string) {
  return createHmac("sha256", getRequiredEnv("GITHUB_APP_CLIENT_SECRET"))
    .update(payload)
    .digest("base64url");
}

function getGitHubAppSlug() {
  const slug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG?.trim();

  return slug && slug.length > 0 ? slug : null;
}

export function getGitHubApp() {
  if (!appInstance) {
    const clientId = process.env.GITHUB_APP_CLIENT_ID;
    const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
    const webhookSecret = process.env.GITHUB_APP_WEBHOOK_SECRET;

    appInstance = new App({
      appId: getRequiredEnv("GITHUB_APP_ID"),
      privateKey: normalizePrivateKey(getRequiredEnv("GITHUB_APP_PRIVATE_KEY")),
      ...(clientId && clientSecret
        ? { oauth: { clientId, clientSecret } }
        : {}),
      ...(webhookSecret ? { webhooks: { secret: webhookSecret } } : {}),
    });
  }

  return appInstance;
}

export async function getInstallationOctokit(
  installationId: number,
): Promise<Octokit> {
  return await getGitHubApp().getInstallationOctokit(installationId);
}

export async function getInstallation(installationId: number) {
  return await getGitHubApp().octokit.rest.apps.getInstallation({
    installation_id: installationId,
  });
}

export function getInstallationUrl() {
  const slug = getGitHubAppSlug();

  return slug && process.env.GITHUB_APP_CLIENT_SECRET
    ? "/api/github/install"
    : null;
}

export function createGitHubInstallState(userId: string, nonce: string) {
  const payload = Buffer.from(
    JSON.stringify({
      exp: Math.floor(Date.now() / 1000) + githubInstallStateTtlSeconds,
      nonce,
      sub: userId,
    } satisfies GitHubInstallStatePayload),
  ).toString("base64url");

  return `${payload}.${signInstallState(payload)}`;
}

export function validateGitHubInstallState(
  state: string,
  expectedUserId: string,
  expectedNonce: string,
) {
  const [payload, signature, extraSegment] = state.split(".");

  if (!payload || !signature || extraSegment) {
    return false;
  }

  let expectedSignature: string;

  try {
    expectedSignature = signInstallState(payload);
  } catch {
    return false;
  }

  if (
    signature.length !== expectedSignature.length ||
    !timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
  ) {
    return false;
  }

  let parsedPayload: GitHubInstallStatePayload;

  try {
    parsedPayload = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as GitHubInstallStatePayload;
  } catch {
    return false;
  }

  return (
    typeof parsedPayload.sub === "string" &&
    typeof parsedPayload.nonce === "string" &&
    typeof parsedPayload.exp === "number" &&
    parsedPayload.sub === expectedUserId &&
    parsedPayload.nonce === expectedNonce &&
    parsedPayload.exp > Math.floor(Date.now() / 1000)
  );
}

export function getGitHubInstallUrlForState(state: string) {
  const slug = getRequiredEnv("NEXT_PUBLIC_GITHUB_APP_SLUG");

  return `https://github.com/apps/${slug}/installations/new?state=${encodeURIComponent(state)}`;
}
