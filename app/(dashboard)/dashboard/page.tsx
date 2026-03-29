import { DashboardFilters } from "@/components/DashboardFilters";
import { IssueFeed } from "@/components/IssueFeed";

export default function DashboardPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="space-y-3">
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
          Dashboard
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">
          Issue triage queue
        </h1>
        <p className="max-w-4xl text-base leading-7 text-muted-foreground">
          Monitor incoming reports, review structured triage output, and decide
          which runs should advance into sandbox reproduction.
        </p>
      </div>

      <DashboardFilters />
      <IssueFeed />
    </div>
  );
}
