"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * Automatically ensures the authenticated WorkOS user has a matching
 * Convex `users` document.  Renders nothing — drop it anywhere inside
 * the Convex + AuthKit provider tree.
 */
export function EnsureConvexUser({
  email,
  name,
  avatarUrl,
}: {
  email: string;
  name?: string;
  avatarUrl?: string;
}) {
  const currentUser = useQuery(api.users.getCurrentUser, {});
  const ensureUser = useMutation(api.users.ensureCurrentUser);
  const didSync = useRef(false);

  useEffect(() => {
    // currentUser is `undefined` while loading, `null` when authenticated
    // but no Convex row exists yet.
    if (currentUser === null && !didSync.current) {
      didSync.current = true;
      ensureUser({ email, name, avatarUrl }).catch((err) => {
        console.error("Failed to sync Convex user record:", err);
        didSync.current = false; // allow retry
      });
    }
  }, [currentUser, ensureUser, email, name, avatarUrl]);

  return null;
}
