import { FlaskConical, History, ShieldCheck } from "lucide-react";

import { Panel } from "@/components/ui/panel";

export default function RunsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Runs</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Triage, reproduction, and verification history.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="gap-3 p-5">
          <History className="h-5 w-5 text-accent" />
          <h2 className="text-lg font-medium">Timeline</h2>
          <p className="text-sm leading-7 text-muted-foreground">
            Review each issue’s Planner → Generator → Evaluator run history and status transitions.
          </p>
        </Panel>
        <Panel className="gap-3 p-5">
          <FlaskConical className="h-5 w-5 text-accent" />
          <h2 className="text-lg font-medium">Artifacts</h2>
          <p className="text-sm leading-7 text-muted-foreground">
            List generated failing tests, deterministic scripts, and runtime notes from sandbox attempts.
          </p>
        </Panel>
        <Panel className="gap-3 p-5">
          <ShieldCheck className="h-5 w-5 text-accent" />
          <h2 className="text-lg font-medium">Verification evidence</h2>
          <p className="text-sm leading-7 text-muted-foreground">
            Preserve rerun counts, flake checks, and policy compliance outcomes before reporting back.
          </p>
        </Panel>
      </div>
    </div>
  );
}
