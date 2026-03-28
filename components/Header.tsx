import { UserMenu } from "./UserMenu";

type HeaderProps = {
  organizationId?: string | null;
  role?: string | null;
  user: {
    email: string;
    firstName: string | null;
    lastName: string | null;
    profilePictureUrl: string | null;
  };
};

export function Header({ organizationId, role, user }: HeaderProps) {
  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;

  return (
    <header className="flex flex-col gap-4 rounded-[28px] border border-border/80 bg-panel/90 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.24em] text-muted-foreground">
          Authenticated workspace
        </p>
        <h1 className="mt-2 text-2xl font-semibold">Repo Butler</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Signed in as {displayName}. WorkOS protects the dashboard shell while
          the Convex-backed workspace stays available to authenticated users.
        </p>
      </div>
      <UserMenu organizationId={organizationId} role={role} user={user} />
    </header>
  );
}
