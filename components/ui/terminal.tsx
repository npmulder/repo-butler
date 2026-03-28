import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type TerminalTone = "accent" | "muted" | "success" | "warning";

export type TerminalLine =
  | {
      kind: "command";
      content: string;
      note?: string;
    }
  | {
      kind: "output";
      label: string;
      content: string;
      tone?: TerminalTone;
    };

function toneClasses(tone: TerminalTone = "muted") {
  if (tone === "accent") {
    return "border-accent/35 bg-accent/10 text-accent";
  }

  if (tone === "success") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  }

  if (tone === "warning") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  }

  return "border-border/80 bg-panel/70 text-muted-foreground";
}

export function TerminalFrame({
  className,
  footer,
  lines,
  status = "live run",
  subtitle,
  title,
}: {
  className?: string;
  footer?: ReactNode;
  lines: ReadonlyArray<TerminalLine>;
  status?: string;
  subtitle?: string;
  title: string;
}) {
  return (
    <div className={cn("terminal-shell", className)}>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/80 px-5 py-4">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#f85149]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#d29922]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#3fb950]" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">
              {title}
            </p>
            {subtitle ? (
              <p className="truncate font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>
        <span className="inline-flex items-center rounded-full border border-border/80 bg-panel/70 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          {status}
        </span>
      </div>

      <div className="space-y-3 px-5 py-5 font-mono text-sm leading-6 text-[#c9d1d9]">
        {lines.map((line, index) =>
          line.kind === "command" ? (
            <div
              key={`${line.kind}-${index}`}
              className="flex flex-wrap items-center gap-3"
            >
              <span className="text-accent">{">"}</span>
              <span className="flex-1 text-pretty">{line.content}</span>
              {line.note ? (
                <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                  {line.note}
                </span>
              ) : null}
            </div>
          ) : (
            <div
              key={`${line.kind}-${line.label}`}
              className="grid gap-3 border-t border-white/[0.03] pt-3 first:border-t-0 first:pt-0 sm:grid-cols-[132px_1fr]"
            >
              <span
                className={cn(
                  "inline-flex h-fit rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.24em]",
                  toneClasses(line.tone),
                )}
              >
                {line.label}
              </span>
              <p className="text-pretty text-[#c9d1d9]">{line.content}</p>
            </div>
          ),
        )}
      </div>

      {footer ? (
        <div className="border-t border-border/80 bg-panel/45">{footer}</div>
      ) : null}
    </div>
  );
}
