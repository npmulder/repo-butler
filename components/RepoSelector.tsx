"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  FolderGit2,
  LoaderCircle,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { buttonStyles } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

const setupMessages = {
  installed: "GitHub App installation saved and repositories were synced.",
  updated: "GitHub App installation updated and repositories were re-synced.",
} as const;

const errorMessages = {
  install_unavailable:
    "GitHub App installation is not configured yet. Check the server-side GitHub App settings and retry.",
  invalid_installation_state:
    "The GitHub install callback could not be verified for this signed-in session. Start the install flow again from this page.",
  missing_access_token:
    "The WorkOS session did not include a Convex access token for setup.",
  missing_convex_url:
    "NEXT_PUBLIC_CONVEX_URL is not configured, so the installation could not be stored.",
  missing_installation:
    "GitHub did not include an installation ID in the setup redirect.",
  missing_installation_state:
    "The GitHub install callback was missing its signed setup state. Start the install flow again from this page.",
  setup_failed:
    "GitHub installation setup failed before Repo Butler could finish syncing repositories.",
} as const;

export function RepoSelector({
  installationUrl,
}: {
  installationUrl: string | null;
}) {
  const searchParams = useSearchParams();
  const currentUser = useQuery(api.users.getCurrentUser, {}) as
    | Doc<"users">
    | null
    | undefined;
  const installations = useQuery(
    api.githubInstallations.list,
    currentUser ? {} : "skip",
  ) as Doc<"githubInstallations">[] | undefined;
  const repos = useQuery(api.repos.list, currentUser ? {} : "skip") as
    | Doc<"repos">[]
    | undefined;
  const toggleActive = useMutation(api.repos.toggleActive);
  const [pendingRepoId, setPendingRepoId] = useState<string | null>(null);

  const setupState = searchParams.get("setup");
  const setupMessage =
    setupState &&
    Object.prototype.hasOwnProperty.call(setupMessages, setupState)
      ? setupMessages[setupState as keyof typeof setupMessages]
      : null;
  const errorCode = searchParams.get("error");
  const errorMessage =
    errorCode && Object.prototype.hasOwnProperty.call(errorMessages, errorCode)
      ? errorMessages[errorCode as keyof typeof errorMessages]
      : null;
  const syncedCount = searchParams.get("synced");

  if (
    currentUser === undefined ||
    (currentUser && (installations === undefined || repos === undefined))
  ) {
    return (
      <Panel className="gap-4 p-6">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin text-accent" />
          Loading GitHub installations and repositories.
        </div>
      </Panel>
    );
  }

  if (currentUser === null) {
    return (
      <Panel className="gap-4 p-6">
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
          Convex profile pending
        </p>
        <h2 className="text-2xl font-semibold tracking-tight">
          Repo Butler is waiting for the authenticated user profile to sync.
        </h2>
        <p className="max-w-3xl text-sm leading-7 text-muted-foreground">
          The dashboard session is active, but the Convex `users` record is not
          available yet. Retry after the WorkOS webhook or setup callback
          finishes syncing the profile.
        </p>
      </Panel>
    );
  }

  const sortedRepos = [...(repos ?? [])].sort((left, right) =>
    left.fullName.localeCompare(right.fullName),
  );

  return (
    <div className="space-y-6">
      {setupMessage ? (
        <Notice tone="success">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
          <span>
            {setupMessage}
            {syncedCount ? ` Synced ${syncedCount} repositories.` : ""}
          </span>
        </Notice>
      ) : null}

      {errorMessage ? (
        <Notice tone="error">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
          <span>{errorMessage}</span>
        </Notice>
      ) : null}

      <Panel className="gap-5 p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
                GitHub App
              </p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight">
                Connected repositories
              </h2>
            </div>
            <p className="max-w-3xl text-sm leading-7 text-muted-foreground">
              Install Repo Butler on a personal account or organization, then
              choose which repositories stay active for triage, reproduction,
              and verification workflows.
            </p>
          </div>

          {installationUrl ? (
            <a
              className={buttonStyles({ className: "w-full sm:w-auto" })}
              href={installationUrl}
            >
              Connect GitHub
              <ArrowUpRight className="h-4 w-4" />
            </a>
          ) : (
            <div className="rounded-xl border border-border/80 bg-background/60 px-4 py-3 text-sm text-muted-foreground">
              Set `NEXT_PUBLIC_GITHUB_APP_SLUG` and `GITHUB_APP_CLIENT_SECRET`
              to enable GitHub App installs.
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Stat
            label="Installations"
            value={String(installations?.length ?? 0)}
            detail="Personal and organization installs linked to this user"
          />
          <Stat
            label="Repositories"
            value={String(sortedRepos.length)}
            detail="Repositories discovered from the linked GitHub App installs"
          />
          <Stat
            label="Active"
            value={String(sortedRepos.filter((repo) => repo.isActive).length)}
            detail="Repositories currently enabled for Repo Butler processing"
          />
        </div>

        {installations && installations.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {installations.map((installation) => (
              <span
                key={installation._id}
                className="rounded-full border border-border/80 bg-background/60 px-3 py-1.5 text-xs font-medium text-foreground"
              >
                {installation.accountLogin} · {installation.accountType}
              </span>
            ))}
          </div>
        ) : (
          <div className="rounded-[22px] border border-dashed border-border/80 bg-background/45 p-5 text-sm leading-7 text-muted-foreground">
            No GitHub App installations are connected yet. Use the install flow
            to grant Repo Butler repository access.
          </div>
        )}
      </Panel>

      <Panel className="gap-4 p-6">
        <div className="flex items-center gap-3">
          <FolderGit2 className="h-5 w-5 text-accent" />
          <div>
            <h3 className="text-xl font-semibold">Repository inventory</h3>
            <p className="text-sm text-muted-foreground">
              Active repositories remain available for issue ingestion and run
              orchestration.
            </p>
          </div>
        </div>

        {sortedRepos.length === 0 ? (
          <div className="rounded-[22px] border border-dashed border-border/80 bg-background/45 p-5 text-sm leading-7 text-muted-foreground">
            Repo Butler has not synced any repositories yet. Complete the GitHub
            App install flow, then return here to verify the imported
            repositories.
          </div>
        ) : (
          <div className="space-y-3">
            {sortedRepos.map((repo) => {
              const isPending = pendingRepoId === repo._id;

              return (
                <div
                  key={repo._id}
                  className="flex flex-col gap-4 rounded-[22px] border border-border/80 bg-background/55 p-4 lg:flex-row lg:items-center lg:justify-between"
                >
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-base font-semibold">
                        {repo.fullName}
                      </p>
                      <span className="rounded-full border border-border/80 bg-panel/80 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                        {repo.defaultBranch}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {repo.language ?? "Language unavailable"} · Linked to{" "}
                      {installations?.find(
                        (installation) =>
                          installation._id === repo.installationId,
                      )?.accountLogin ?? "GitHub installation"}
                    </p>
                  </div>

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <Link
                      className={buttonStyles({
                        variant: "ghost",
                        className: "w-full sm:w-auto",
                      })}
                      href={`/settings/${repo._id}`}
                    >
                      Approval settings
                    </Link>
                    <button
                      className={cn(
                        "inline-flex h-11 items-center justify-center rounded-full border px-4 text-sm font-medium transition",
                        repo.isActive
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:border-emerald-400/40"
                          : "border-border/80 bg-panel/65 text-muted-foreground hover:border-accent/30 hover:text-foreground",
                      )}
                      disabled={isPending}
                      onClick={() => {
                        setPendingRepoId(repo._id);
                        void toggleActive({
                          repoId: repo._id,
                          isActive: !repo.isActive,
                        }).finally(() => {
                          setPendingRepoId(null);
                        });
                      }}
                      type="button"
                    >
                      {isPending ? (
                        <>
                          <LoaderCircle className="h-4 w-4 animate-spin" />
                          Updating
                        </>
                      ) : repo.isActive ? (
                        "Active"
                      ) : (
                        "Inactive"
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Notice({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "error" | "success";
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-[22px] border px-4 py-4 text-sm leading-7",
        tone === "success"
          ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
          : "border-amber-500/20 bg-amber-500/10 text-amber-50",
      )}
    >
      {children}
    </div>
  );
}

function Stat({
  detail,
  label,
  value,
}: {
  detail: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[20px] border border-border/80 bg-background/60 p-4">
      <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-3 text-3xl font-semibold text-foreground">{value}</p>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">{detail}</p>
    </div>
  );
}
