"use client";

import { useState } from "react";
import { LoaderCircle, MessageSquareMore, Play, XCircle } from "lucide-react";
import { useMutation } from "convex/react";

import type { Id } from "@/convex/_generated/dataModel";
import { api } from "@/convex/_generated/api";
import { buttonStyles } from "@/components/ui/button";

type ApprovalAction = "approve" | "reject" | "request_info";

const actionLabels = {
  approve: "Approve",
  reject: "Reject",
  request_info: "Request info",
} satisfies Record<ApprovalAction, string>;

const actionIcons = {
  approve: Play,
  reject: XCircle,
  request_info: MessageSquareMore,
} satisfies Record<ApprovalAction, typeof Play>;

export function ApprovalActions({ runId }: { runId: Id<"runs"> }) {
  const processApproval = useMutation(api.approvalGate.processApproval);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<ApprovalAction | null>(null);

  async function handleAction(action: ApprovalAction) {
    setError(null);
    setPendingAction(action);

    try {
      await processApproval({ action, runId });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Approval update failed.",
      );
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="space-y-3 rounded-[22px] border border-border/80 bg-background/55 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-foreground">Approval gate</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Decide whether this triage result can advance into sandbox
            reproduction.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["approve", "request_info", "reject"] as const).map((action) => {
          const Icon = actionIcons[action];
          const isPending = pendingAction === action;

          return (
            <button
              key={action}
              className={buttonStyles({
                variant: action === "approve" ? "primary" : "ghost",
                className:
                  action === "reject"
                    ? "border-rose-400/20 bg-rose-400/10 text-rose-100 hover:bg-rose-400/15"
                    : action === "request_info"
                      ? "border-amber-300/20 bg-amber-300/10 text-amber-100 hover:bg-amber-300/15"
                      : undefined,
              })}
              disabled={pendingAction !== null}
              onClick={() => void handleAction(action)}
              type="button"
            >
              {isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Icon className="h-4 w-4" />
              )}
              {actionLabels[action]}
            </button>
          );
        })}
      </div>

      {error ? <p className="text-sm text-rose-200">{error}</p> : null}
    </div>
  );
}
