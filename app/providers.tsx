"use client";

import { useCallback, type PropsWithChildren } from "react";
import { ConvexProviderWithAuthKit } from "@convex-dev/workos";
import {
  useAccessToken,
  useAuth,
} from "@workos-inc/authkit-nextjs/components";
import { ConvexReactClient } from "convex/react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  throw new Error(
    "NEXT_PUBLIC_CONVEX_URL is not set. Start Convex dev or add the deployment URL to .env.local.",
  );
}

const convex = new ConvexReactClient(convexUrl);

function useAuthKitForConvex() {
  const { user, loading } = useAuth();
  const { accessToken, loading: tokenLoading, refresh } = useAccessToken();

  const getAccessToken = useCallback(async () => {
    if (!user) {
      return null;
    }

    return accessToken ?? (await refresh()) ?? null;
  }, [accessToken, refresh, user]);

  return {
    isLoading: loading || tokenLoading,
    user,
    getAccessToken,
  };
}

export function Providers({ children }: PropsWithChildren) {
  return (
    <ConvexProviderWithAuthKit client={convex} useAuth={useAuthKitForConvex}>
      {children}
    </ConvexProviderWithAuthKit>
  );
}
