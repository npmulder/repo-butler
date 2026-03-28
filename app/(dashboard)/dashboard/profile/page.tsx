/* eslint-disable @next/next/no-img-element */

import { requireAuth } from "@/lib/auth";

function formatDate(value: string | null | undefined) {
  if (!value) {
    return "Unavailable";
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default async function ProfilePage() {
  const { organizationId, permissions, role, user } = await requireAuth();
  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div className="space-y-3">
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
          Profile
        </p>
        <h1 className="text-4xl font-semibold tracking-tight">
          Authenticated operator details
        </h1>
        <p className="max-w-3xl text-base leading-7 text-muted-foreground">
          WorkOS identity fields are available in server components and surfaced
          here for profile and downstream access-control work.
        </p>
      </div>

      <section className="grid gap-4 rounded-[28px] border border-border/80 bg-background/60 p-6 sm:grid-cols-2 sm:p-8">
        <div className="sm:col-span-2">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            {user.profilePictureUrl ? (
              <img
                alt={`${displayName} avatar`}
                className="h-20 w-20 rounded-full object-cover"
                src={user.profilePictureUrl}
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full border border-accent/20 bg-accent/10 text-2xl font-semibold text-accent">
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-2xl font-semibold">{displayName}</p>
              <p className="mt-1 text-sm text-muted-foreground">{user.email}</p>
            </div>
          </div>
        </div>
        <Field label="User ID" value={user.id} mono />
        <Field label="First name" value={user.firstName ?? "Unavailable"} />
        <Field label="Last name" value={user.lastName ?? "Unavailable"} />
        <Field label="Email verified" value={user.emailVerified ? "Yes" : "No"} />
        <Field
          label="Organization"
          value={organizationId ?? "No organization selected"}
        />
        <Field label="Role" value={role ?? "Authenticated operator"} />
        <Field
          label="Permissions"
          value={permissions?.length ? permissions.join(", ") : "No permissions"}
        />
        <Field label="Created" value={formatDate(user.createdAt)} />
        <Field label="Updated" value={formatDate(user.updatedAt)} />
        <Field
          className="sm:col-span-2"
          label="Profile picture URL"
          value={user.profilePictureUrl ?? "Unavailable"}
        />
      </section>
    </div>
  );
}

function Field({
  className,
  label,
  mono = false,
  value,
}: {
  className?: string;
  label: string;
  mono?: boolean;
  value: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-border/80 bg-panel/70 px-4 py-4 ${className ?? ""}`.trim()}
    >
      <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {label}
      </dt>
      <dd
        className={`mt-2 break-all text-sm ${mono ? "font-mono" : ""}`.trim()}
      >
        {value}
      </dd>
    </div>
  );
}
