import Link, { type LinkProps } from "next/link";
import type { AnchorHTMLAttributes, ReactNode } from "react";

import { cn } from "@/lib/utils";

type ButtonVariant = "primary" | "ghost";
type ButtonSize = "md" | "lg";

export function buttonStyles({
  variant = "primary",
  size = "md",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-xl border text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    variant === "primary" &&
      "border-accent bg-accent text-[#0d1117] hover:bg-[#fb8c42]",
    variant === "ghost" &&
      "border-border/80 bg-panel/55 text-foreground hover:border-white/15 hover:bg-white/[0.04]",
    size === "md" && "h-11 px-4",
    size === "lg" && "h-12 px-6 text-base",
    className,
  );
}

type ButtonLinkProps<RouteType extends string = string> = LinkProps<RouteType> &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
    children: ReactNode;
    variant?: ButtonVariant;
    size?: ButtonSize;
  };

export function ButtonLink<RouteType extends string>({
  children,
  className,
  size,
  variant,
  ...props
}: ButtonLinkProps<RouteType>) {
  return (
    <Link className={buttonStyles({ variant, size, className })} {...props}>
      {children}
    </Link>
  );
}
