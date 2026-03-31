"use client";

import { useState } from "react";
import { Copy, CopyCheck } from "lucide-react";

import { Panel } from "@/components/ui/panel";
import {
  formatShaFingerprint,
  formatStepDuration,
  toNumber,
  type RunDetailData,
} from "@/lib/run-detail";
import { cn } from "@/lib/utils";

function formatSeconds(seconds: number | null) {
  if (seconds === null) {
    return "Pending";
  }

  return formatStepDuration(seconds * 1_000);
}

export function SandboxInfo({ detail }: { detail: RunDetailData }) {
  const [copied, setCopied] = useState(false);
  const imageDigest =
    detail.latestReproRun?.sandbox.imageDigest ??
    detail.latestReproRun?.environmentStrategy?.imageUsed ??
    detail.reproPlan?.environmentStrategy.imageUsed ??
    null;
  const network =
    detail.latestReproRun?.sandbox.network ??
    detail.reproContract?.sandboxPolicy.network ??
    (detail.repoSettings
      ? detail.repoSettings.networkEnabled
        ? "enabled"
        : "disabled"
      : null);
  const uid = toNumber(detail.latestReproRun?.sandbox.uid);
  const timeoutSeconds =
    toNumber(detail.reproContract?.budgets.wallClockSeconds) ??
    toNumber(detail.repoSettings?.sandboxTimeoutSeconds);
  const totalDurationMs = detail.reproRuns.reduce((total, reproRun) => {
    return total + (toNumber(reproRun.durationMs) ?? 0);
  }, 0);

  async function handleCopy() {
    if (!imageDigest) {
      return;
    }

    await navigator.clipboard.writeText(imageDigest);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <Panel className="gap-5 p-6">
      <div className="space-y-2">
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
          Sandbox
        </p>
        <h2 className="text-xl font-semibold">Execution environment</h2>
        <p className="max-w-3xl text-sm leading-7 text-muted-foreground">
          Runtime metadata for the latest reproduction attempt.
        </p>
      </div>

      <div className="rounded-[22px] border border-border/80 bg-background/50 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Docker image digest</p>
            <p className="mt-2 font-mono text-sm text-foreground">
              {formatShaFingerprint(imageDigest)}
            </p>
          </div>

          <button
            className="inline-flex items-center gap-2 self-start rounded-xl border border-border/80 bg-background/60 px-3 py-2 text-sm font-medium text-foreground hover:border-accent/30 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!imageDigest}
            onClick={() => void handleCopy()}
            type="button"
          >
            {copied ? (
              <>
                Copied
                <CopyCheck className="h-4 w-4" />
              </>
            ) : (
              <>
                Copy digest
                <Copy className="h-4 w-4" />
              </>
            )}
          </button>
        </div>

        <dl className="mt-5 space-y-3 text-sm">
          <div className="flex items-start justify-between gap-3">
            <dt className="text-muted-foreground">Network</dt>
            <dd>
              <span
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.18em]",
                  network === "enabled"
                    ? "border-amber-300/20 bg-amber-300/10 text-amber-100"
                    : network === "disabled"
                      ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                      : "border-border/80 bg-panel/80 text-muted-foreground",
                )}
              >
                {network ?? "pending"}
              </span>
            </dd>
          </div>

          <div className="flex items-start justify-between gap-3">
            <dt className="text-muted-foreground">UID</dt>
            <dd className="text-right text-foreground/90">
              {uid !== null ? `${uid} ${uid === 0 ? "(root)" : "(non-root)"}` : "Pending"}
            </dd>
          </div>

          <div className="flex items-start justify-between gap-3">
            <dt className="text-muted-foreground">Total duration</dt>
            <dd className="text-right text-foreground/90">
              {detail.reproRuns.length > 0 ? formatStepDuration(totalDurationMs) : "Pending"}
            </dd>
          </div>

          <div className="flex items-start justify-between gap-3">
            <dt className="text-muted-foreground">Timeout</dt>
            <dd className="text-right text-foreground/90">
              {formatSeconds(timeoutSeconds)}
            </dd>
          </div>

          <div className="flex items-start justify-between gap-3">
            <dt className="text-muted-foreground">Environment strategy</dt>
            <dd className="text-right text-foreground/90">
              {detail.latestReproRun?.environmentStrategy?.attempted ??
                detail.reproPlan?.environmentStrategy.preferred ??
                "Pending"}
            </dd>
          </div>
        </dl>
      </div>
    </Panel>
  );
}
