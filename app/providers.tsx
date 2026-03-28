"use client";

import { useCallback, type PropsWithChildren } from "react";
import { ConvexProviderWithAuthKit } from "@convex-dev/workos";
import { AuthKitProvider, useAccessToken, useAuth } from "@workos-inc/authkit-nextjs/components";
import { ConvexReactClient } from "convex/react";

const convex = new ConvexReactClient(
  process.env.NEXT_PUBLIC_CONVEX_URL ?? "https://placeholder.convex.cloud",
);

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
    <AuthKitProvider>
      <ConvexProviderWithAuthKit client={convex} useAuth={useAuthKitForConvex}>
        {children}
      </ConvexProviderWithAuthKit>
    </AuthKitProvider>
  );
}
