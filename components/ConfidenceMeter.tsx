import { cn } from "@/lib/utils";

function clampConfidence(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  return Math.min(Math.max(value, 0), 1);
}

export function ConfidenceMeter({
  confidence,
}: {
  confidence: number | null | undefined;
}) {
  const normalizedConfidence = clampConfidence(confidence);

  if (normalizedConfidence === null) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
            Confidence
          </span>
          <span className="text-sm text-muted-foreground">Unavailable</span>
        </div>
        <div className="h-2 rounded-full bg-background/80" />
      </div>
    );
  }

  const percentage = Math.round(normalizedConfidence * 100);
  const toneClass =
    normalizedConfidence < 0.3
      ? "from-rose-500 to-rose-300 text-rose-100"
      : normalizedConfidence < 0.7
        ? "from-amber-400 to-yellow-200 text-amber-100"
        : "from-emerald-500 to-lime-300 text-emerald-100";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
          Confidence
        </span>
        <span className="text-sm font-medium text-foreground">{percentage}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-background/80">
        <div
          className={cn("h-full rounded-full bg-gradient-to-r transition-all", toneClass)}
          data-testid="confidence-fill"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
