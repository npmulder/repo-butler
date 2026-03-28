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
    "inline-flex items-center justify-center gap-2 rounded-full border text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    variant === "primary" &&
      "border-accent/40 bg-accent px-5 text-slate-950 hover:bg-orange-400",
    variant === "ghost" &&
      "border-border/80 bg-panel/80 px-5 text-foreground hover:border-accent/30 hover:text-accent",
    size === "md" && "h-11",
    size === "lg" && "h-12 px-6 text-base",
    className,
  );
}

type ButtonLinkProps = LinkProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
    children: ReactNode;
    variant?: ButtonVariant;
    size?: ButtonSize;
  };

export function ButtonLink({
  children,
  className,
  size,
  variant,
  ...props
}: ButtonLinkProps) {
  return (
    <Link className={buttonStyles({ variant, size, className })} {...props}>
      {children}
    </Link>
  );
}
