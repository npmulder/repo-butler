import type { Doc } from "@/convex/_generated/dataModel";
import { formatRunStatus } from "@/lib/formatting";
import { cn } from "@/lib/utils";

const statusStyles = {
  awaiting_approval: "border-amber-300/20 bg-amber-300/10 text-amber-100",
  cancelled: "border-slate-400/20 bg-slate-400/10 text-slate-200",
  completed: "border-emerald-400/20 bg-emerald-400/10 text-emerald-100",
  failed: "border-rose-400/20 bg-rose-400/10 text-rose-100",
  pending: "border-white/10 bg-white/5 text-slate-100",
  reproducing: "border-fuchsia-400/20 bg-fuchsia-400/10 text-fuchsia-100",
  triaging: "border-sky-400/20 bg-sky-400/10 text-sky-100",
  verifying: "border-cyan-300/20 bg-cyan-300/10 text-cyan-100",
} satisfies Record<Doc<"runs">["status"], string>;

export function StatusBadge({
  className,
  status,
}: {
  className?: string;
  status: Doc<"runs">["status"];
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium",
        statusStyles[status],
        className,
      )}
    >
      {formatRunStatus(status)}
    </span>
  );
}
