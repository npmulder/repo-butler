import { RepoSelector } from "@/components/RepoSelector";
import { getInstallationUrl } from "@/lib/github";

export default function ReposPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="space-y-3">
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
          Repositories
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">
          Connect GitHub repositories to Repo Butler
        </h1>
        <p className="max-w-4xl text-base leading-7 text-muted-foreground">
          Install the GitHub App on personal or organization repositories, then
          review which repositories remain active for triage and reproduction
          workflows.
        </p>
      </div>

      <RepoSelector installationUrl={getInstallationUrl()} />
    </div>
  );
}
