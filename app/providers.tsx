"use client";

import { useCallback, useEffect, type PropsWithChildren } from "react";
import { ConvexProviderWithAuthKit } from "@convex-dev/workos";
import { AuthKitProvider, useAccessToken, useAuth } from "@workos-inc/authkit-nextjs/components";
import { ConvexReactClient } from "convex/react";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

function MissingConvexUrlProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.error(
        "NEXT_PUBLIC_CONVEX_URL is not set. Convex hooks will remain unavailable until the environment variable is configured.",
      );
    }
  }, []);

  return <AuthKitProvider>{children}</AuthKitProvider>;
}

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
  if (!convex) {
    return <MissingConvexUrlProvider>{children}</MissingConvexUrlProvider>;
  }

  return (
    <AuthKitProvider>
      <ConvexProviderWithAuthKit client={convex} useAuth={useAuthKitForConvex}>
        {children}
      </ConvexProviderWithAuthKit>
    </AuthKitProvider>
  );
}
