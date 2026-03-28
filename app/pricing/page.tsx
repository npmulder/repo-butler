import { CreditCard, ShieldCheck } from "lucide-react";

import { ButtonLink } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";

const plans = [
  {
    label: "Starter",
    detail: "Protected dashboard access, issue triage visibility, and core repo onboarding.",
  },
  {
    label: "Team",
    detail: "Shared workspaces, role-aware controls, and audit-friendly authentication flows.",
  },
  {
    label: "Enterprise",
    detail: "Custom identity setup, compliance controls, and dedicated rollout support.",
  },
] as const;

export default function PricingPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-16 lg:px-10">
      <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border/80 bg-panel/80 px-3 py-1.5 text-xs uppercase tracking-[0.24em] text-muted-foreground">
        <CreditCard className="h-3.5 w-3.5 text-accent" />
        Pricing
      </div>
      <div className="space-y-4">
        <h1 className="max-w-4xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Repo Butler access starts with a protected operator workspace.
        </h1>
        <p className="max-w-3xl text-lg leading-8 text-muted-foreground">
          Pricing is still pre-launch, but this public page remains reachable
          while authenticated routes are protected by WorkOS.
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        {plans.map((plan) => (
          <Panel key={plan.label} className="gap-4 p-6">
            <div className="flex items-center justify-between">
              <p className="text-xl font-semibold">{plan.label}</p>
              <ShieldCheck className="h-4 w-4 text-accent" />
            </div>
            <p className="text-sm leading-7 text-muted-foreground">
              {plan.detail}
            </p>
          </Panel>
        ))}
      </div>
      <ButtonLink href="/dashboard" size="lg">
        Open the protected dashboard
      </ButtonLink>
    </main>
  );
}
