import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FlaskConical,
  ShieldCheck,
  Tags,
} from "lucide-react";

import { Panel } from "@/components/ui/panel";

const STATUS_CARDS = [
  {
    title: "Queued issues",
    value: "14",
    description:
      "Reports waiting on the triager to classify severity and suggest labels.",
    icon: Tags,
  },
  {
    title: "Sandbox repros",
    value: "5",
    description:
      "Active generator runs iterating on deterministic failing artifacts.",
    icon: FlaskConical,
  },
  {
    title: "Verification passes",
    value: "9",
    description: "Runs that cleared 3 reruns and policy checks without flake.",
    icon: ShieldCheck,
  },
];

const ACTIVITY = [
  {
    title: "nextjs-monorepo#1842",
    stage: "Triager ready",
    detail:
      "High severity regression with maintainer approval required before sandbox launch.",
    tone: "warning",
  },
  {
    title: "eslint-plugin-x#77",
    stage: "Generator running",
    detail:
      "Environment bootstrap fell back from devcontainer to Dockerfile and recovered.",
    tone: "active",
  },
  {
    title: "vitepress#6311",
    stage: "Verifier complete",
    detail:
      "Fail-to-pass test and shell script posted back to the GitHub issue.",
    tone: "success",
  },
];

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <section className="grid gap-4 xl:grid-cols-3">
        {STATUS_CARDS.map((card) => {
          const Icon = card.icon;

          return (
            <Panel key={card.title} className="gap-4 bg-panel/75 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                    {card.title}
                  </p>
                  <p className="mt-3 font-mono text-3xl font-semibold text-foreground">
                    {card.value}
                  </p>
                </div>
                <div className="rounded-2xl border border-border/80 bg-background/70 p-2.5">
                  <Icon className="h-4 w-4 text-accent" />
                </div>
              </div>
              <p className="text-sm leading-7 text-muted-foreground">
                {card.description}
              </p>
            </Panel>
          );
        })}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Panel className="gap-5 bg-panel/75 p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">
                Recent pipeline activity
              </h2>
              <p className="text-sm text-muted-foreground">
                Pipeline activity and reproduction status at a glance.
              </p>
            </div>
            <Clock3 className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="space-y-3">
            {ACTIVITY.map((item) => (
              <div
                key={item.title}
                className="rounded-[20px] border border-border/80 bg-background/65 p-4"
              >
                <div className="mb-2 flex items-center justify-between gap-4">
                  <p className="font-medium">{item.title}</p>
                  <span className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    {item.stage}
                  </span>
                </div>
                <p className="text-sm leading-7 text-muted-foreground">
                  {item.detail}
                </p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="gap-5 bg-panel/75 p-6">
          <div>
            <h2 className="text-xl font-semibold">Approval gates</h2>
            <p className="text-sm text-muted-foreground">
              Control when a triaged issue may advance into sandbox
              reproduction.
            </p>
          </div>
          <div className="space-y-3 text-sm text-muted-foreground">
            <div className="flex items-start gap-3 rounded-[20px] border border-border/80 bg-background/65 p-4">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-400" />
              <p>Auto-approve low-risk docs and configuration regressions.</p>
            </div>
            <div className="flex items-start gap-3 rounded-[20px] border border-border/80 bg-background/65 p-4">
              <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-300" />
              <p>
                Require maintainer approval when the generator requests elevated
                tooling.
              </p>
            </div>
          </div>
        </Panel>
      </section>
    </div>
  );
}
