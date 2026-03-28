import { randomUUID } from "node:crypto";

import { withAuth } from "@workos-inc/authkit-nextjs";
import { NextRequest, NextResponse } from "next/server";

import {
  createGitHubInstallState,
  getGitHubInstallUrlForState,
  githubInstallStateCookieName,
  githubInstallStateTtlSeconds,
} from "@/lib/github";

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

export const GET = async (request: NextRequest) => {
  const { user } = await withAuth({ ensureSignedIn: true });

  try {
    const nonce = randomUUID();
    const response = NextResponse.redirect(
      getGitHubInstallUrlForState(createGitHubInstallState(user.id, nonce)),
    );

    response.cookies.set({
      name: githubInstallStateCookieName,
      value: nonce,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/github/setup",
      maxAge: githubInstallStateTtlSeconds,
    });

    return response;
  } catch (error) {
    console.error("GitHub App installation start failed", error);

    return redirectToRepos(request, { error: "install_unavailable" });
  }
};
