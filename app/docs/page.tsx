import { BookOpenText, ShieldCheck } from "lucide-react";

import { ButtonLink } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";

const docsHighlights = [
  "Authenticate with WorkOS before entering any `/dashboard/*` route.",
  "Use the hosted AuthKit callback to land in `/dashboard` after sign-in.",
  "Open `/dashboard/profile` to inspect the active WorkOS identity.",
] as const;

export default function DocsPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-16 lg:px-10">
      <div className="inline-flex w-fit items-center gap-2 rounded-full border border-border/80 bg-panel/80 px-3 py-1.5 text-xs uppercase tracking-[0.24em] text-muted-foreground">
        <BookOpenText className="h-3.5 w-3.5 text-accent" />
        Public docs
      </div>
      <div className="space-y-4">
        <h1 className="max-w-4xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Public documentation stays open while dashboard routes require auth.
        </h1>
        <p className="max-w-3xl text-lg leading-8 text-muted-foreground">
          This route is intentionally unauthenticated so onboarding notes,
          runbooks, and rollout guidance remain shareable outside the protected
          workspace shell.
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <Panel className="gap-4 p-6">
          {docsHighlights.map((line) => (
            <p key={line} className="text-sm leading-7 text-muted-foreground">
              {line}
            </p>
          ))}
        </Panel>
        <Panel className="gap-4 p-6">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="h-4 w-4 text-accent" />
            Route protection
          </div>
          <p className="text-sm leading-7 text-muted-foreground">
            `/`, `/docs`, and `/pricing` stay public. Every `/dashboard/*` route
            redirects through WorkOS when the session is missing or expired.
          </p>
        </Panel>
      </div>
      <ButtonLink href="/" size="lg">
        Back to the landing page
      </ButtonLink>
    </main>
  );
}
