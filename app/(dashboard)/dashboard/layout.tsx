import type { ReactNode } from "react";
import { withAuth } from "@workos-inc/authkit-nextjs";

import { Header } from "@/components/Header";
import { Sidebar } from "@/components/Sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const { user } = await withAuth({ ensureSignedIn: true });
  const firstName = user.firstName ?? user.email.split("@")[0];

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto flex min-h-screen w-full max-w-[1400px] flex-col gap-5 px-4 py-4 lg:flex-row lg:px-6">
        <Sidebar />
        <div className="flex min-h-[calc(100vh-2rem)] flex-1 flex-col gap-4">
          <Header
            title="Pipeline Overview"
            subtitle={`Tracking triage, reproduction, and verification for ${firstName}.`}
          />
          <div className="flex-1 rounded-[26px] border border-border/90 bg-panel/78 p-5 sm:p-6">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
