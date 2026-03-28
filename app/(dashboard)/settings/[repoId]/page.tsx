import { ApprovalGateSettings } from "@/components/ApprovalGateSettings";
import { requireAuth } from "@/lib/auth";

export default async function RepoSettingsPage({
  params,
}: {
  params: Promise<{ repoId: string }> | { repoId: string };
}) {
  await requireAuth();

  const { repoId } = await params;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 py-6">
      <div className="space-y-3">
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
          Repository settings
        </p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Approval gate and label policy
        </h1>
        <p className="max-w-2xl text-sm leading-7 text-muted-foreground">
          Configure how triage results become reproduction runs, which maintainer
          approvals are required, and the per-repository safety limits that keep
          the pipeline bounded.
        </p>
      </div>

      <ApprovalGateSettings repoId={repoId} />
    </div>
  );
}
