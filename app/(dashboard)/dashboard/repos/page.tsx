import { GitBranch, Link2, ShieldCheck } from "lucide-react";

import { Panel } from "@/components/ui/panel";

export default function ReposPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Repositories</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Connected repositories and GitHub App installations.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="gap-3 p-5">
          <GitBranch className="h-5 w-5 text-accent" />
          <h2 className="text-lg font-medium">Installation health</h2>
          <p className="text-sm leading-7 text-muted-foreground">
            Surface which repos have the GitHub App installed, synced, and ready for issue ingestion.
          </p>
        </Panel>
        <Panel className="gap-3 p-5">
          <Link2 className="h-5 w-5 text-accent" />
          <h2 className="text-lg font-medium">Connection status</h2>
          <p className="text-sm leading-7 text-muted-foreground">
            Track webhook reachability, default branch detection, and repository metadata refresh.
          </p>
        </Panel>
        <Panel className="gap-3 p-5">
          <ShieldCheck className="h-5 w-5 text-accent" />
          <h2 className="text-lg font-medium">Policy defaults</h2>
          <p className="text-sm leading-7 text-muted-foreground">
            Preview approval gates, sandbox restrictions, and reporting behavior per repository.
          </p>
        </Panel>
      </div>
    </div>
  );
}
