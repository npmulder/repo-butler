"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";

import { Panel } from "@/components/ui/panel";
import {
  formatShaFingerprint,
  formatStepDuration,
  toNumber,
  type ReproRunDetail,
} from "@/lib/run-detail";
import { cn } from "@/lib/utils";

function StepExitBadge({ exitCode }: { exitCode: bigint | number }) {
  const numericExitCode = toNumber(exitCode) ?? 0;

  return (
    <span
      className={cn(
        "rounded-full border px-2.5 py-1 text-[11px] font-medium",
        numericExitCode === 0
          ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
          : "border-rose-400/20 bg-rose-400/10 text-rose-100",
      )}
    >
      exit {numericExitCode}
    </span>
  );
}

export function StepLogViewer({
  reproRuns,
}: {
  reproRuns: ReproRunDetail[];
}) {
  const [expandedKeys, setExpandedKeys] = useState<Record<string, boolean>>({});

  const stepKeys = useMemo(
    () =>
      reproRuns.flatMap((reproRun) =>
        reproRun.steps.map((step, index) => `${reproRun._id}:${index}:${step.name}`),
      ),
    [reproRuns],
  );

  if (reproRuns.length === 0) {
    return (
      <Panel className="gap-4 p-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
            Sandbox steps
          </p>
          <h2 className="mt-2 text-xl font-semibold">Step logs</h2>
        </div>
        <p className="text-sm leading-7 text-muted-foreground">
          No sandbox steps have been stored for this run yet.
        </p>
      </Panel>
    );
  }

  return (
    <Panel className="gap-5 p-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
            Sandbox steps
          </p>
          <h2 className="text-xl font-semibold">Execution log viewer</h2>
          <p className="max-w-3xl text-sm leading-7 text-muted-foreground">
            Expand a step to inspect any persisted stdout or stderr excerpts. Older
            runs may only contain fingerprints if output tails were not stored.
          </p>
        </div>

        <button
          className="self-start rounded-full border border-border/80 bg-background/60 px-3 py-1 text-xs uppercase tracking-[0.18em] text-muted-foreground"
          onClick={() =>
            setExpandedKeys((currentValue) => {
              const shouldExpandAll = stepKeys.some((key) => !currentValue[key]);

              return Object.fromEntries(
                stepKeys.map((key) => [key, shouldExpandAll]),
              );
            })
          }
          type="button"
        >
          Toggle all
        </button>
      </div>

      <div className="space-y-5">
        {reproRuns.map((reproRun) => (
          <section
            key={reproRun._id}
            className="space-y-4 rounded-[24px] border border-border/80 bg-background/45 p-4"
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-lg font-medium">
                  Iteration {toNumber(reproRun.iteration) ?? "?"}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {reproRun.steps.length} step{reproRun.steps.length === 1 ? "" : "s"} ·
                  total duration {formatStepDuration(reproRun.durationMs)}
                </p>
              </div>

              {reproRun.logUrl ? (
                <a
                  className="inline-flex items-center gap-2 rounded-xl border border-border/80 bg-background/60 px-3 py-2 text-sm font-medium text-foreground hover:border-accent/30 hover:text-accent"
                  href={reproRun.logUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  Full log
                  <ExternalLink className="h-4 w-4" />
                </a>
              ) : null}
            </div>

            <div className="space-y-3">
              {reproRun.steps.map((step, index) => {
                const stepKey = `${reproRun._id}:${index}:${step.name}`;
                const isExpanded = expandedKeys[stepKey] ?? false;
                const hasPersistedOutput = Boolean(step.stdoutTail || step.stderrTail);
                const numericExitCode = toNumber(step.exitCode) ?? 0;

                return (
                  <div
                    key={stepKey}
                    className="rounded-[20px] border border-border/80 bg-panel/75 p-4"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-medium text-foreground">
                            Step {index + 1}: {step.name}
                          </h4>
                          <StepExitBadge exitCode={step.exitCode} />
                          <span
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.18em]",
                              numericExitCode === 0
                                ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-100"
                                : "border-rose-400/20 bg-rose-400/10 text-rose-100",
                            )}
                          >
                            {numericExitCode === 0 ? "ok" : "failed"}
                          </span>
                        </div>

                        <pre className="mt-3 overflow-x-auto rounded-xl border border-border/80 bg-background/70 px-3 py-3 font-mono text-xs text-foreground/90">
                          <code>{step.cmd}</code>
                        </pre>

                        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                          <span>Duration {formatStepDuration(step.durationMs)}</span>
                          <span>stdout {formatShaFingerprint(step.stdoutSha256)}</span>
                          <span>stderr {formatShaFingerprint(step.stderrSha256)}</span>
                        </div>
                      </div>

                      <button
                        className="inline-flex items-center gap-2 self-start rounded-xl border border-border/80 bg-background/60 px-3 py-2 text-sm font-medium text-foreground hover:border-accent/30 hover:text-accent"
                        onClick={() =>
                          setExpandedKeys((currentValue) => ({
                            ...currentValue,
                            [stepKey]: !isExpanded,
                          }))
                        }
                        type="button"
                      >
                        {isExpanded ? (
                          <>
                            Hide output
                            <ChevronUp className="h-4 w-4" />
                          </>
                        ) : (
                          <>
                            Show output
                            <ChevronDown className="h-4 w-4" />
                          </>
                        )}
                      </button>
                    </div>

                    {isExpanded ? (
                      <div className="mt-4 grid gap-3 lg:grid-cols-2">
                        <div className="rounded-[18px] border border-border/80 bg-background/70 p-3">
                          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            stdout tail
                          </p>
                          <pre className="mt-3 overflow-x-auto font-mono text-xs leading-6 text-foreground/90">
                            <code>
                              {step.stdoutTail || "No stdout excerpt stored for this step."}
                            </code>
                          </pre>
                        </div>
                        <div className="rounded-[18px] border border-border/80 bg-background/70 p-3">
                          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                            stderr tail
                          </p>
                          <pre className="mt-3 overflow-x-auto font-mono text-xs leading-6 text-foreground/90">
                            <code>
                              {step.stderrTail || "No stderr excerpt stored for this step."}
                            </code>
                          </pre>
                        </div>
                        {!hasPersistedOutput ? (
                          <p className="text-sm leading-6 text-muted-foreground lg:col-span-2">
                            This run only persisted SHA-256 fingerprints for command output.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </Panel>
  );
}
