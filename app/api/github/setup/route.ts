import { withAuth } from "@workos-inc/authkit-nextjs";
import { ConvexHttpClient } from "convex/browser";
import { NextRequest, NextResponse } from "next/server";

import { api } from "@/convex/_generated/api";
import { getInstallation, getInstallationOctokit } from "@/lib/github";

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

function normalizePermissions(permissions: Record<string, unknown> | undefined) {
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

async function listAccessibleRepos(installationId: number) {
  const octokit = await getInstallationOctokit(installationId);
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

export const GET = async (request: NextRequest) => {
  const installationId = Number(
    request.nextUrl.searchParams.get("installation_id"),
  );

  if (!Number.isInteger(installationId) || installationId <= 0) {
    return redirectToRepos(request, { error: "missing_installation" });
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

  if (!convexUrl) {
    return redirectToRepos(request, { error: "missing_convex_url" });
  }

  const { accessToken, user } = await withAuth({ ensureSignedIn: true });

  if (!accessToken) {
    return redirectToRepos(request, { error: "missing_access_token" });
  }

  try {
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
      ...(user.profilePictureUrl
        ? { avatarUrl: user.profilePictureUrl }
        : {}),
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
    const repos = await listAccessibleRepos(installationId);
    const syncResult = await convex.mutation(api.repos.syncFromGitHub, {
      installationId: installationDocId,
      repos,
    });

    return redirectToRepos(request, {
      setup: normalizeSetupState(
        request.nextUrl.searchParams.get("setup_action"),
      ),
      synced: String(syncResult.totalCount),
    });
  } catch (error) {
    console.error("GitHub App setup failed", error);

    return redirectToRepos(request, { error: "setup_failed" });
  }
};
