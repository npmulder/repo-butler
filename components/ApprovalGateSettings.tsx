"use client";

import {
  useEffect,
  useState,
  useTransition,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { CheckCircle2, LoaderCircle, ShieldAlert, Tag } from "lucide-react";
import { useMutation, useQuery } from "convex/react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { buttonStyles } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { normalizeAreaLabelValue } from "@/lib/areaLabels";
import { cn } from "@/lib/utils";

type ApprovalPolicy = "auto_approve" | "require_label" | "require_comment";

type ApprovalGateFormState = {
  approvalPolicy: ApprovalPolicy;
  autoApproveThreshold: string;
  maxConcurrentRuns: string;
  maxDailyRuns: string;
  customAreaLabels: string[];
  areaInput: string;
  enabledEventTypes: string[];
};

const approvalPolicyOptions: Array<{
  description: string;
  label: string;
  value: ApprovalPolicy;
}> = [
  {
    label: "Auto-approve",
    value: "auto_approve",
    description:
      "High-confidence triage results move forward automatically when they clear the configured threshold.",
  },
  {
    label: "Require label",
    value: "require_label",
    description:
      "Maintainers must add the GitHub label `rb:repro-approved` before reproduction begins.",
  },
  {
    label: "Require comment",
    value: "require_comment",
    description:
      "Maintainers must comment `@repobutler approve` before reproduction begins.",
  },
];

const eventTypeOptions = [
  {
    description: "Queue triage automatically when a new GitHub issue is opened.",
    label: "Issue opened",
    value: "issues.opened",
  },
  {
    description:
      "React to GitHub issue labels such as `repro-me` and `rb:repro-approved`.",
    label: "Issue labeled",
    value: "issues.labeled",
  },
  {
    description:
      "Allow comment commands like `@repobutler triage` or `@repobutler approve`.",
    label: "Issue comment created",
    value: "issue_comment.created",
  },
] as const;

type RepoSettingsData = {
  updatedAt: number | null;
  approvalPolicy: ApprovalPolicy;
  autoApproveThreshold: number;
  maxConcurrentRuns: number;
  maxDailyRuns: number;
  customAreaLabels: string[];
  enabledEventTypes: string[];
  isDefault: boolean;
};

function buildFormState(settings: RepoSettingsData): ApprovalGateFormState {
  return {
    approvalPolicy: settings.approvalPolicy,
    autoApproveThreshold: settings.autoApproveThreshold.toFixed(2),
    maxConcurrentRuns: String(settings.maxConcurrentRuns),
    maxDailyRuns: String(settings.maxDailyRuns),
    customAreaLabels: [...settings.customAreaLabels],
    areaInput: "",
    enabledEventTypes: [...settings.enabledEventTypes],
  };
}

function parseThreshold(value: string) {
  const numericValue = Number.parseFloat(value);

  if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue > 1) {
    return null;
  }

  return numericValue;
}

function parseCount(value: string) {
  const numericValue = Number.parseInt(value, 10);

  if (!Number.isFinite(numericValue) || numericValue < 1) {
    return null;
  }

  return numericValue;
}

export function ApprovalGateSettings({ repoId }: { repoId: string }) {
  const repoIdValue = repoId as Id<"repos">;
  const settings = useQuery(api.repoSettings.getByRepo, { repoId: repoIdValue });
  const saveRepoSettings = useMutation(api.repoSettings.upsert);
  const [formState, setFormState] = useState<ApprovalGateFormState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!settings) {
      return;
    }

    setFormState(buildFormState(settings));
  }, [repoId, settings]);

  if (settings === undefined || formState === null) {
    return (
      <Panel className="gap-4 p-6">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin text-accent" />
          Loading repository approval settings from Convex.
        </div>
      </Panel>
    );
  }

  const addAreaLabel = (rawValue: string) => {
    const normalizedValue = normalizeAreaLabelValue(rawValue);

    if (!normalizedValue) {
      setFormState((current) =>
        current ? { ...current, areaInput: "" } : current,
      );
      return;
    }

    setFormState((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        areaInput: "",
        customAreaLabels: current.customAreaLabels.includes(normalizedValue)
          ? current.customAreaLabels
          : [...current.customAreaLabels, normalizedValue],
      };
    });
  };

  const handleAreaKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" && event.key !== ",") {
      return;
    }

    event.preventDefault();
    addAreaLabel(formState.areaInput);
  };

  const saveSettings = () => {
    const autoApproveThreshold = parseThreshold(formState.autoApproveThreshold);
    const maxConcurrentRuns = parseCount(formState.maxConcurrentRuns);
    const maxDailyRuns = parseCount(formState.maxDailyRuns);

    if (autoApproveThreshold === null) {
      setErrorMessage("Auto-approve confidence threshold must be between 0.00 and 1.00.");
      setSaveMessage(null);
      return;
    }

    if (maxConcurrentRuns === null || maxDailyRuns === null) {
      setErrorMessage("Concurrency and daily run limits must both be positive integers.");
      setSaveMessage(null);
      return;
    }

    setErrorMessage(null);
    setSaveMessage(null);

    startTransition(() => {
      void saveRepoSettings({
        repoId: repoIdValue,
        approvalPolicy: formState.approvalPolicy,
        autoApproveThreshold,
        maxConcurrentRuns,
        maxDailyRuns,
        customAreaLabels: formState.customAreaLabels,
        enabledEventTypes: formState.enabledEventTypes as Array<
          "issues.opened" | "issues.labeled" | "issue_comment.created"
        >,
      })
        .then(() => {
          setSaveMessage("Repository approval settings saved.");
        })
        .catch((error: unknown) => {
          setErrorMessage(
            error instanceof Error ? error.message : "Failed to save repository settings.",
          );
        });
    });
  };

  return (
    <div className="space-y-6">
      {settings.isDefault ? (
        <Notice tone="warning">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-200" />
          <span>
            Repo Butler is currently using default approval settings for this repository.
            Save this form to persist an explicit policy.
          </span>
        </Notice>
      ) : null}

      {saveMessage ? (
        <Notice tone="success">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
          <span>{saveMessage}</span>
        </Notice>
      ) : null}

      {errorMessage ? <Notice tone="error">{errorMessage}</Notice> : null}

      <Panel className="gap-6 p-6">
        <section className="space-y-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
              Approval policy
            </p>
            <h2 className="mt-2 text-xl font-semibold">Choose the maintainer gate</h2>
          </div>

          <div className="grid gap-3">
            {approvalPolicyOptions.map((option) => {
              const checked = formState.approvalPolicy === option.value;

              return (
                <label
                  key={option.value}
                  className={cn(
                    "cursor-pointer rounded-[22px] border p-4 transition",
                    checked
                      ? "border-accent/35 bg-accent/10"
                      : "border-border/80 bg-background/45 hover:border-accent/20",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <input
                      checked={checked}
                      className="mt-1 h-4 w-4 accent-[var(--accent)]"
                      name="approval-policy"
                      onChange={() => {
                        setFormState((current) =>
                          current
                            ? {
                                ...current,
                                approvalPolicy: option.value,
                              }
                            : current,
                        );
                      }}
                      type="radio"
                    />
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">{option.label}</p>
                      <p className="text-sm leading-7 text-muted-foreground">
                        {option.description}
                      </p>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <Field
            description="Confidence score required when auto-approval is enabled."
            disabled={formState.approvalPolicy !== "auto_approve"}
            label="Auto-approve threshold"
          >
            <input
              className={inputStyles}
              disabled={formState.approvalPolicy !== "auto_approve"}
              max="1"
              min="0"
              onChange={(event) => {
                const value = event.target.value;
                setFormState((current) =>
                  current
                    ? {
                        ...current,
                        autoApproveThreshold: value,
                      }
                    : current,
                );
              }}
              step="0.01"
              type="number"
              value={formState.autoApproveThreshold}
            />
          </Field>

          <Field
            description="Concurrent reproduction or verification runs allowed for this repository."
            label="Max concurrent runs"
          >
            <input
              className={inputStyles}
              min="1"
              onChange={(event) => {
                const value = event.target.value;
                setFormState((current) =>
                  current
                    ? {
                        ...current,
                        maxConcurrentRuns: value,
                      }
                    : current,
                );
              }}
              step="1"
              type="number"
              value={formState.maxConcurrentRuns}
            />
          </Field>

          <Field
            description="Upper bound on runs created in a rolling 24 hour window."
            label="Daily run limit"
          >
            <input
              className={inputStyles}
              min="1"
              onChange={(event) => {
                const value = event.target.value;
                setFormState((current) =>
                  current
                    ? {
                        ...current,
                        maxDailyRuns: value,
                      }
                    : current,
                );
              }}
              step="1"
              type="number"
              value={formState.maxDailyRuns}
            />
          </Field>
        </section>

        <section className="space-y-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
              Custom area labels
            </p>
            <h2 className="mt-2 text-xl font-semibold">Repository-specific taxonomy</h2>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-muted-foreground">
              Define reusable `area:*` labels that the triager can suggest alongside type and
              severity labels.
            </p>
          </div>

          <div className="rounded-[22px] border border-border/80 bg-background/45 p-4">
            <div className="flex flex-wrap gap-2">
              {formState.customAreaLabels.length > 0 ? (
                formState.customAreaLabels.map((label) => (
                  <button
                    key={label}
                    className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-panel/80 px-3 py-1.5 text-sm text-foreground transition hover:border-rose-400/35 hover:text-rose-200"
                    onClick={() => {
                      setFormState((current) =>
                        current
                          ? {
                              ...current,
                              customAreaLabels: current.customAreaLabels.filter(
                                (currentLabel) => currentLabel !== label,
                              ),
                            }
                          : current,
                      );
                    }}
                    type="button"
                  >
                    <Tag className="h-3.5 w-3.5 text-accent" />
                    {`area:${label}`}
                  </button>
                ))
              ) : (
                <p className="text-sm leading-7 text-muted-foreground">
                  No custom area labels defined yet.
                </p>
              )}
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <input
                className={cn(inputStyles, "flex-1")}
                onBlur={() => {
                  if (formState.areaInput.trim()) {
                    addAreaLabel(formState.areaInput);
                  }
                }}
                onChange={(event) => {
                  const value = event.target.value;
                  setFormState((current) =>
                    current
                      ? {
                          ...current,
                          areaInput: value,
                        }
                      : current,
                  );
                }}
                onKeyDown={handleAreaKeyDown}
                placeholder="Add an area label, e.g. parser"
                type="text"
                value={formState.areaInput}
              />
              <button
                className={buttonStyles({ className: "sm:w-auto" })}
                onClick={() => {
                  addAreaLabel(formState.areaInput);
                }}
                type="button"
              >
                Add label
              </button>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
              Event sources
            </p>
            <h2 className="mt-2 text-xl font-semibold">Enabled GitHub events</h2>
          </div>

          <div className="grid gap-3">
            {eventTypeOptions.map((option) => {
              const checked = formState.enabledEventTypes.includes(option.value);

              return (
                <label
                  key={option.value}
                  className={cn(
                    "cursor-pointer rounded-[22px] border p-4 transition",
                    checked
                      ? "border-accent/30 bg-accent/10"
                      : "border-border/80 bg-background/45 hover:border-accent/20",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <input
                      checked={checked}
                      className="mt-1 h-4 w-4 accent-[var(--accent)]"
                      onChange={() => {
                        setFormState((current) => {
                          if (!current) {
                            return current;
                          }

                          const enabledEventTypes = checked
                            ? current.enabledEventTypes.filter(
                                (eventType) => eventType !== option.value,
                              )
                            : [...current.enabledEventTypes, option.value];

                          return {
                            ...current,
                            enabledEventTypes,
                          };
                        });
                      }}
                      type="checkbox"
                    />
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">{option.label}</p>
                      <p className="text-sm leading-7 text-muted-foreground">
                        {option.description}
                      </p>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        </section>

        <div className="flex flex-col gap-3 border-t border-border/80 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm leading-7 text-muted-foreground">
            Repo Butler will keep the approval gate in front of reproduction until this
            repository’s policy explicitly allows the run to proceed.
          </p>
          <button
            className={buttonStyles({
              className: "w-full sm:w-auto",
            })}
            disabled={isPending}
            onClick={saveSettings}
            type="button"
          >
            {isPending ? (
              <>
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Saving
              </>
            ) : (
              "Save settings"
            )}
          </button>
        </div>
      </Panel>
    </div>
  );
}

function Field({
  children,
  description,
  disabled = false,
  label,
}: {
  children: ReactNode;
  description: string;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[22px] border border-border/80 bg-background/45 p-4",
        disabled && "opacity-70",
      )}
    >
      <p className="text-sm font-medium text-foreground">{label}</p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Notice({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "error" | "success" | "warning";
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-[22px] border px-4 py-4 text-sm leading-7",
        tone === "success" &&
          "border-emerald-500/20 bg-emerald-500/10 text-emerald-100",
        tone === "warning" &&
          "border-amber-500/20 bg-amber-500/10 text-amber-50",
        tone === "error" && "border-rose-500/20 bg-rose-500/10 text-rose-100",
      )}
    >
      {children}
    </div>
  );
}

const inputStyles =
  "w-full rounded-xl border border-border/80 bg-panel/80 px-4 py-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-accent/35 focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:bg-background/55";
