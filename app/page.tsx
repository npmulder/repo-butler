import Link from "next/link";
import {
  ArrowRight,
  Bug,
  CheckCircle2,
  FlaskConical,
  GitBranch,
  ShieldCheck,
  Sparkles,
  Tags,
  Terminal,
  Workflow,
} from "lucide-react";

import { buttonStyles } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { FEATURE_PILLARS, HOW_IT_WORKS_STEPS, HERO_TERMINAL_LINES, METRICS } from "@/lib/constants";
import { cn } from "@/lib/utils";

const featureIcons = {
  triage: Tags,
  reproduce: FlaskConical,
  verify: ShieldCheck,
} as const;

export default function HomePage() {
  return (
    <main className="relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-[32rem] bg-[radial-gradient(circle_at_top,rgba(249,115,22,0.14),transparent_55%)]" />
      <section className="mx-auto flex min-h-screen w-full max-w-7xl flex-col justify-center gap-16 px-6 py-20 lg:px-10">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-panel/80 px-3 py-1.5 text-xs uppercase tracking-[0.24em] text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-accent" />
              Reproduction-first issue triage
            </div>
            <div className="space-y-5">
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
                AI-powered issue triage and automated bug reproduction for maintainers.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
                Repo Butler turns vague GitHub bug reports into structured triage artifacts, failing tests,
                and deterministic verification evidence so maintainers stop burning hours on manual
                reproduction.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/signup" className={buttonStyles({ size: "lg" })}>
                Get started
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="#how-it-works"
                className={buttonStyles({ variant: "ghost", size: "lg" })}
              >
                See how it works
              </Link>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {METRICS.map((metric) => (
                <Panel key={metric.label} className="gap-2 p-4">
                  <span className="font-mono text-2xl font-semibold text-foreground">
                    {metric.value}
                  </span>
                  <span className="text-sm text-muted-foreground">{metric.label}</span>
                </Panel>
              ))}
            </div>
          </div>

          <Panel className="relative overflow-hidden p-0">
            <div className="border-b border-border/80 bg-panel/90 px-5 py-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <div className="flex items-center gap-2 font-mono">
                  <Terminal className="h-4 w-4 text-accent" />
                  planner → generator → evaluator
                </div>
                <span className="rounded-full border border-border px-2 py-1 font-mono text-[11px] uppercase tracking-[0.18em]">
                  live run
                </span>
              </div>
            </div>
            <div className="space-y-3 bg-[#090b10] px-5 py-5 font-mono text-sm leading-6 text-slate-300">
              {HERO_TERMINAL_LINES.map((line) => (
                <div key={line.label} className="grid grid-cols-[auto_1fr] gap-3">
                  <span
                    className={cn(
                      "inline-flex h-fit rounded border px-2 py-0.5 text-[10px] uppercase tracking-[0.22em]",
                      line.tone === "accent" && "border-accent/30 bg-accent/10 text-accent",
                      line.tone === "success" &&
                        "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
                      line.tone === "muted" && "border-border/60 bg-panel/70 text-muted-foreground",
                    )}
                  >
                    {line.label}
                  </span>
                  <p className="text-pretty">{line.content}</p>
                </div>
              ))}
            </div>
            <div className="grid gap-3 border-t border-border/80 bg-panel/90 px-5 py-4 sm:grid-cols-2">
              <div className="rounded-xl border border-border/80 bg-background/70 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                  <Bug className="h-4 w-4 text-accent" />
                  Incoming issue
                </div>
                <p className="text-sm text-muted-foreground">
                  “Search indexing stalls after rebasing a large workspace.”
                </p>
              </div>
              <div className="rounded-xl border border-border/80 bg-background/70 p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  Posted artifact
                </div>
                <p className="text-sm text-muted-foreground">
                  `failing_test.spec.ts` attached with 3/3 deterministic reruns.
                </p>
              </div>
            </div>
          </Panel>
        </div>
      </section>

      <section id="features" className="mx-auto w-full max-w-7xl px-6 pb-8 lg:px-10">
        <div className="mb-8 flex items-center gap-3 text-sm uppercase tracking-[0.24em] text-muted-foreground">
          <Workflow className="h-4 w-4 text-accent" />
          Pipeline pillars
        </div>
        <div className="grid gap-5 lg:grid-cols-3">
          {FEATURE_PILLARS.map((pillar) => {
            const Icon = featureIcons[pillar.slug];

            return (
              <Panel key={pillar.slug} className="h-full gap-5 p-6">
                <div className="flex items-center justify-between">
                  <div className="rounded-2xl border border-accent/20 bg-accent/10 p-3">
                    <Icon className="h-5 w-5 text-accent" />
                  </div>
                  <span className="font-mono text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    {pillar.kicker}
                  </span>
                </div>
                <div className="space-y-3">
                  <h2 className="text-2xl font-semibold">{pillar.title}</h2>
                  <p className="text-sm leading-7 text-muted-foreground">{pillar.description}</p>
                </div>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  {pillar.bullets.map((bullet) => (
                    <li key={bullet} className="flex items-start gap-2">
                      <span className="mt-1 h-1.5 w-1.5 rounded-full bg-accent" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            );
          })}
        </div>
      </section>

      <section id="how-it-works" className="mx-auto w-full max-w-7xl px-6 py-20 lg:px-10">
        <div className="mb-10 flex items-center gap-3 text-sm uppercase tracking-[0.24em] text-muted-foreground">
          <GitBranch className="h-4 w-4 text-accent" />
          How it works
        </div>
        <div className="grid gap-5 lg:grid-cols-3">
          {HOW_IT_WORKS_STEPS.map((step, index) => (
            <Panel key={step.title} className="gap-4 p-6">
              <span className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
                Step 0{index + 1}
              </span>
              <h2 className="text-xl font-semibold">{step.title}</h2>
              <p className="text-sm leading-7 text-muted-foreground">{step.description}</p>
            </Panel>
          ))}
        </div>
      </section>
    </main>
  );
}
