"use client";

import { useEffect } from "react";

import { buttonStyles } from "@/components/ui/button";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-16 sm:px-10">
      <section className="w-full rounded-[28px] border border-border/80 bg-panel/90 p-8 shadow-[0_24px_80px_rgba(0,0,0,0.24)] sm:p-10">
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
          Authentication error
        </p>
        <h1 className="mt-6 text-4xl font-semibold tracking-tight">
          Repo Butler could not load the authenticated workspace.
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">
          The WorkOS session may have expired or the auth service may be
          temporarily unavailable. Retry the request to fetch a fresh session.
        </p>
        <button
          className={buttonStyles({ className: "mt-8", size: "lg" })}
          onClick={reset}
          type="button"
        >
          Retry dashboard
        </button>
      </section>
    </main>
  );
}
