import type { ReactNode } from "react";

import { EnsureConvexUser } from "@/components/EnsureConvexUser";
import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { organizationId, role, user } = await requireAuth();

  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined;

  return (
    <div className="min-h-screen bg-[#080a0f]">
      <EnsureConvexUser
        email={user.email}
        name={displayName}
        avatarUrl={user.profilePictureUrl ?? undefined}
      />
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-6 px-4 py-4 lg:flex-row lg:px-6">
        <Sidebar />
        <div className="flex min-h-[calc(100vh-2rem)] flex-1 flex-col gap-4">
          <Header organizationId={organizationId} role={role} user={user} />
          <main className="flex-1 rounded-[28px] border border-border/80 bg-panel/90 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.24)] sm:p-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
