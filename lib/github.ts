import "server-only";

import { App, type Octokit } from "octokit";

let appInstance: App | null = null;

function getRequiredEnv(name: keyof NodeJS.ProcessEnv) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required for GitHub App integration.`);
  }

  return value;
}

function normalizePrivateKey(privateKey: string) {
  return privateKey.includes("\\n") ? privateKey.replace(/\\n/g, "\n") : privateKey;
}

export function getGitHubApp() {
  if (!appInstance) {
    const clientId = process.env.GITHUB_APP_CLIENT_ID;
    const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
    const webhookSecret = process.env.GITHUB_APP_WEBHOOK_SECRET;

    appInstance = new App({
      appId: getRequiredEnv("GITHUB_APP_ID"),
      privateKey: normalizePrivateKey(getRequiredEnv("GITHUB_APP_PRIVATE_KEY")),
      ...(clientId && clientSecret ? { oauth: { clientId, clientSecret } } : {}),
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
  const slug = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;

  return slug
    ? `https://github.com/apps/${slug}/installations/new`
    : null;
}
