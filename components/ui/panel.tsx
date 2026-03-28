import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-[26px] border border-border/90 bg-panel/[0.92]",
        className,
      )}
      {...props}
    />
  );
}
