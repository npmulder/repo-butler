"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Copy, CopyCheck } from "lucide-react";

import { Panel } from "@/components/ui/panel";
import { stringifyArtifact, type RunDetailData } from "@/lib/run-detail";
import { cn } from "@/lib/utils";

type ArtifactTab = "triage" | "reproPlan" | "reproRun" | "verification";

const tabLabels = {
  reproPlan: "Repro plan",
  reproRun: "Repro run",
  triage: "Triage",
  verification: "Verification",
} satisfies Record<ArtifactTab, string>;

function getArtifacts(detail: RunDetailData) {
  return {
    reproPlan: detail.reproPlan,
    reproRun: detail.latestReproRun,
    triage: detail.triage,
    verification: detail.verification,
  } satisfies Record<ArtifactTab, unknown>;
}

function getArtifactSummary(tab: ArtifactTab, detail: RunDetailData) {
  if (tab === "triage") {
    return detail.triage
      ? `${detail.triage.classificationType ?? "unknown"} · confidence ${Math.round(
          (detail.triage.confidence ?? 0) * 100,
        )}%`
      : "No triage artifact yet";
  }

  if (tab === "reproPlan") {
    return detail.reproPlan
      ? `${detail.reproPlan.commands.length} command${detail.reproPlan.commands.length === 1 ? "" : "s"} · ${detail.reproPlan.artifact.path}`
      : "No reproduction plan yet";
  }

  if (tab === "reproRun") {
    return detail.latestReproRun
      ? `iteration ${detail.latestReproRun.iteration.toString()} · ${detail.latestReproRun.sandbox.kind}`
      : "No reproduction run yet";
  }

  return detail.verification
    ? `verdict ${detail.verification.verdict.replaceAll("_", " ")}`
    : "No verification artifact yet";
}

function getSchemaVersion(tab: ArtifactTab, detail: RunDetailData) {
  const artifacts = getArtifacts(detail);
  const artifact = artifacts[tab] as { schemaVersion?: string } | null;

  return artifact?.schemaVersion ?? "legacy";
}

export function ArtifactViewer({ detail }: { detail: RunDetailData }) {
  const [activeTab, setActiveTab] = useState<ArtifactTab>("triage");
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedTab, setCopiedTab] = useState<ArtifactTab | null>(null);
  const artifact = getArtifacts(detail)[activeTab];
  const artifactText = artifact ? stringifyArtifact(artifact) : null;

  async function handleCopy() {
    if (!artifactText) {
      return;
    }

    await navigator.clipboard.writeText(artifactText);
    setCopiedTab(activeTab);
    window.setTimeout(() => {
      setCopiedTab((currentValue) =>
        currentValue === activeTab ? null : currentValue,
      );
    }, 1_500);
  }

  return (
    <Panel className="gap-5 p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
            Artifacts
          </p>
          <h2 className="text-xl font-semibold">Structured payloads</h2>
          <p className="max-w-3xl text-sm leading-7 text-muted-foreground">
            Inspect the stored JSON artifacts behind triage, planning,
            reproduction, and verification.
          </p>
        </div>

        <button
          className="inline-flex items-center gap-2 self-start rounded-xl border border-border/80 bg-background/60 px-3 py-2 text-sm font-medium text-foreground hover:border-accent/30 hover:text-accent"
          onClick={() => setIsExpanded((currentValue) => !currentValue)}
          type="button"
        >
          {isExpanded ? (
            <>
              Collapse
              <ChevronUp className="h-4 w-4" />
            </>
          ) : (
            <>
              Expand JSON
              <ChevronDown className="h-4 w-4" />
            </>
          )}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(tabLabels) as ArtifactTab[]).map((tab) => (
          <button
            key={tab}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm font-medium transition",
              tab === activeTab
                ? "border-accent/30 bg-accent/10 text-accent"
                : "border-border/80 bg-background/60 text-foreground hover:border-accent/20 hover:text-accent",
            )}
            onClick={() => setActiveTab(tab)}
            type="button"
          >
            {tabLabels[tab]}
          </button>
        ))}
      </div>

      <div className="rounded-[22px] border border-border/80 bg-background/50 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-medium">{tabLabels[activeTab]}</h3>
              <span className="rounded-full border border-border/80 bg-panel/80 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                {getSchemaVersion(activeTab, detail)}
              </span>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              {getArtifactSummary(activeTab, detail)}
            </p>
          </div>

          <button
            className="inline-flex items-center gap-2 self-start rounded-xl border border-border/80 bg-background/60 px-3 py-2 text-sm font-medium text-foreground hover:border-accent/30 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!artifactText}
            onClick={() => void handleCopy()}
            type="button"
          >
            {copiedTab === activeTab ? (
              <>
                Copied
                <CopyCheck className="h-4 w-4" />
              </>
            ) : (
              <>
                Copy JSON
                <Copy className="h-4 w-4" />
              </>
            )}
          </button>
        </div>

        {isExpanded ? (
          artifactText ? (
            <pre className="mt-4 overflow-x-auto rounded-[18px] border border-border/80 bg-panel/80 p-4 font-mono text-xs leading-6 text-foreground/90">
              <code>{artifactText}</code>
            </pre>
          ) : (
            <p className="mt-4 text-sm leading-7 text-muted-foreground">
              No artifact is stored for this stage yet.
            </p>
          )
        ) : null}
      </div>
    </Panel>
  );
}
