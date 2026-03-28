"use client";

/* eslint-disable @next/next/no-img-element */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Building2, ChevronDown, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { useAuth } from "@workos-inc/authkit-nextjs/components";

type UserMenuProps = {
  organizationId?: string | null;
  role?: string | null;
  user: {
    email: string;
    firstName: string | null;
    lastName: string | null;
    profilePictureUrl: string | null;
  };
};

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function UserMenu({ organizationId, role, user }: UserMenuProps) {
  const [busy, setBusy] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const { signOut } = useAuth();
  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;
  const initials = getInitials(displayName) || "RB";

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen]);

  return (
    <div className="relative min-w-[18rem]" ref={menuRef}>
      <button
        aria-controls={isOpen ? "user-menu-panel" : undefined}
        aria-expanded={isOpen}
        className="flex w-full items-center justify-between rounded-2xl border border-border/80 bg-background/70 px-4 py-3 text-left transition hover:border-accent/30 hover:bg-background"
        onClick={() => setIsOpen((open) => !open)}
        type="button"
      >
        <div className="flex min-w-0 items-center gap-3">
          {user.profilePictureUrl ? (
            <img
              alt={`${displayName} avatar`}
              className="h-11 w-11 rounded-full object-cover"
              src={user.profilePictureUrl}
            />
          ) : (
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-accent/20 bg-accent/10 text-sm font-semibold text-accent">
              {initials}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{displayName}</p>
            <p className="truncate text-xs text-muted-foreground">
              {user.email}
            </p>
          </div>
        </div>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {isOpen ? (
        <div
          id="user-menu-panel"
          className="absolute right-0 z-10 mt-3 w-full rounded-[28px] border border-border/80 bg-panel/95 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.24)] backdrop-blur"
        >
          <div className="space-y-3 text-sm text-muted-foreground">
            <div className="flex items-start gap-3 rounded-2xl border border-border/80 bg-background/60 px-3 py-3">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <div>
                <p className="font-medium text-foreground">
                  {role ?? "Authenticated operator"}
                </p>
                <p className="mt-1 leading-5">
                  WorkOS session is active and the dashboard shell is
                  protected.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-2xl border border-border/80 bg-background/60 px-3 py-3">
              <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <div>
                <p className="font-medium text-foreground">Organization</p>
                <p className="mt-1 break-all leading-5">
                  {organizationId ?? "No organization selected"}
                </p>
              </div>
            </div>
            <Link
              className="flex items-center gap-3 rounded-2xl border border-border/80 bg-background/60 px-3 py-3 text-foreground transition hover:border-accent/30 hover:text-accent"
              href="/dashboard/profile"
              onClick={() => setIsOpen(false)}
            >
              <UserRound className="h-4 w-4 shrink-0" />
              <span>Profile</span>
            </Link>
            <button
              className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-border/80 bg-background/70 px-4 py-2.5 text-sm font-medium text-foreground transition hover:border-accent/30 hover:text-accent disabled:cursor-not-allowed disabled:opacity-70"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await signOut({ returnTo: "/" });
                } finally {
                  setBusy(false);
                }
              }}
              type="button"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
