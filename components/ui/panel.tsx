import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-[24px] border border-border/80 bg-panel/85 shadow-[0_24px_80px_rgba(0,0,0,0.16)] backdrop-blur",
        className,
      )}
      {...props}
    />
  );
}
