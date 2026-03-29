import { withAuth } from "@workos-inc/authkit-nextjs";
import { ConvexHttpClient } from "convex/browser";
import { NextRequest, NextResponse } from "next/server";
import type { Octokit } from "octokit";

import { api } from "@/convex/_generated/api";
import {
  getInstallation,
  getInstallationOctokit,
  githubInstallStateCookieName,
  validateGitHubInstallState,
} from "@/lib/github";
import { syncLabelsToRepo } from "@/lib/labels";

function redirectToRepos(
  request: NextRequest,
  params: Record<string, string | undefined>,
) {
  const url = new URL("/dashboard/repos", request.url);

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  return NextResponse.redirect(url);
}

function clearInstallStateCookie(response: NextResponse) {
  response.cookies.set({
    name: githubInstallStateCookieName,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/github/setup",
    maxAge: 0,
  });

  return response;
}

function normalizePermissions(
  permissions: Record<string, unknown> | undefined,
) {
  return Object.fromEntries(
    Object.entries(permissions ?? {}).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function normalizeAccountType(targetType: string | undefined) {
  return targetType === "Organization" ? "Organization" : "User";
}

function getAccountLogin(
  account:
    | {
        login: string;
      }
    | {
        slug: string;
      }
    | null
    | undefined,
  installationId: number,
) {
  if (!account) {
    return `installation-${installationId}`;
  }

  if ("login" in account) {
    return account.login;
  }

  return account.slug;
}

function normalizeSetupState(setupAction: string | null) {
  return setupAction === "update" ? "updated" : "installed";
}

function parseSuspendedAt(value: string | null | undefined) {
  if (!value) {
    return undefined;
  }

  const timestamp = Date.parse(value);

  return Number.isNaN(timestamp) ? undefined : timestamp;
}

async function listAccessibleRepos(octokit: Octokit) {
  const repos: {
    owner: string;
    name: string;
    defaultBranch: string;
    language?: string;
  }[] = [];

  for (let page = 1; ; page += 1) {
    const { data } = await octokit.rest.apps.listReposAccessibleToInstallation({
      page,
      per_page: 100,
    });

    for (const repo of data.repositories) {
      repos.push({
        owner: repo.owner.login,
        name: repo.name,
        defaultBranch: repo.default_branch,
        ...(repo.language ? { language: repo.language } : {}),
      });
    }

    if (data.repositories.length < 100) {
      return repos;
    }
  }
}

async function syncRepoButlerLabels(
  octokit: Octokit,
  repos: Awaited<ReturnType<typeof listAccessibleRepos>>,
) {
  const maxConcurrency = 5;
  let nextRepoIndex = 0;

  async function worker() {
    while (true) {
      const repo = repos[nextRepoIndex];

      if (!repo) {
        return;
      }

      nextRepoIndex += 1;

      try {
        await syncLabelsToRepo(octokit, repo.owner, repo.name);
      } catch (error) {
        console.warn(
          `[github/setup] Failed to sync Repo Butler labels for ${repo.owner}/${repo.name}`,
          error,
        );
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(maxConcurrency, repos.length) }, () => worker()),
  );
}

export const GET = async (request: NextRequest) => {
  const installationId = Number(
    request.nextUrl.searchParams.get("installation_id"),
  );

  if (!Number.isInteger(installationId) || installationId <= 0) {
    return redirectToRepos(request, { error: "missing_installation" });
  }

  const { accessToken, user } = await withAuth({ ensureSignedIn: true });
  const state = request.nextUrl.searchParams.get("state");
  const installStateNonce = request.cookies.get(
    githubInstallStateCookieName,
  )?.value;

  if (!state || !installStateNonce) {
    return clearInstallStateCookie(
      redirectToRepos(request, { error: "missing_installation_state" }),
    );
  }

  if (!validateGitHubInstallState(state, user.id, installStateNonce)) {
    return clearInstallStateCookie(
      redirectToRepos(request, { error: "invalid_installation_state" }),
    );
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

  if (!convexUrl) {
    return clearInstallStateCookie(
      redirectToRepos(request, { error: "missing_convex_url" }),
    );
  }

  try {
    if (!accessToken) {
      return clearInstallStateCookie(
        redirectToRepos(request, { error: "missing_access_token" }),
      );
    }

    const convex = new ConvexHttpClient(convexUrl, {
      auth: accessToken,
      logger: false,
    });
    const { data: installation } = await getInstallation(installationId);
    const suspendedAt = parseSuspendedAt(installation.suspended_at);

    await convex.mutation(api.users.ensureCurrentUser, {
      email: user.email,
      ...(user.firstName || user.lastName
        ? {
            name: [user.firstName, user.lastName]
              .filter(Boolean)
              .join(" ")
              .trim(),
          }
        : {}),
      ...(user.profilePictureUrl ? { avatarUrl: user.profilePictureUrl } : {}),
    });

    const installationDocId = await convex.mutation(
      api.githubInstallations.upsert,
      {
        installationId: BigInt(installationId),
        accountLogin: getAccountLogin(installation.account, installationId),
        accountType: normalizeAccountType(installation.target_type),
        permissions: normalizePermissions(installation.permissions),
        ...(suspendedAt !== undefined ? { suspendedAt } : {}),
      },
    );
    const octokit = await getInstallationOctokit(installationId);
    const repos = await listAccessibleRepos(octokit);
    const syncResult = await convex.mutation(api.repos.syncFromGitHub, {
      installationId: installationDocId,
      repos,
    });
    await syncRepoButlerLabels(octokit, repos);

    return clearInstallStateCookie(
      redirectToRepos(request, {
        setup: normalizeSetupState(
          request.nextUrl.searchParams.get("setup_action"),
        ),
        synced: String(syncResult.totalCount),
      }),
    );
  } catch (error) {
    console.error("GitHub App setup failed", error);

    return clearInstallStateCookie(
      redirectToRepos(request, { error: "setup_failed" }),
    );
  }
};
