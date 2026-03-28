import Link from "next/link";
import {
  ArrowRight,
  Bot,
  Bug,
  CheckCircle2,
  ChevronRight,
  FlaskConical,
  GitBranch,
  Search,
  ShieldCheck,
  Workflow,
} from "lucide-react";

import { buttonStyles } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { TerminalFrame } from "@/components/ui/terminal";
import {
  DEMO_PIPELINE_LINES,
  FEATURE_PILLARS,
  HERO_TERMINAL_LINES,
  HOME_NAV_ITEMS,
  HOW_IT_WORKS_STEPS,
  METRICS,
  WHO_ITS_FOR,
} from "@/lib/constants";
import { cn } from "@/lib/utils";

const featureIcons = {
  triage: Search,
  reproduce: Bug,
  verify: ShieldCheck,
} as const;

export default function HomePage() {
  return (
    <main className="relative overflow-x-clip">
      <div className="absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(circle_at_top,rgba(249,115,22,0.14),transparent_58%)]" />

      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-4 lg:px-10">
          <Link href="/" className="flex items-center gap-3">
            <div className="rounded-2xl border border-border/80 bg-panel/85 p-2.5">
              <Bot className="h-5 w-5 text-accent" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">
                Repo Butler
              </p>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                issue triage pipeline
              </p>
            </div>
          </Link>

          <nav className="hidden items-center gap-8 md:flex">
            {HOME_NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground hover:text-foreground"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <Link href="/login" className={buttonStyles({ variant: "ghost" })}>
            Sign in
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 pb-16 pt-16 lg:px-10 lg:pb-24 lg:pt-20">
        <div className="grid gap-14 lg:grid-cols-[minmax(0,1.02fr)_minmax(0,0.98fr)] lg:items-center">
          <div className="space-y-8">
            <div className="section-label">
              <span className="h-2 w-2 rounded-full bg-accent" />
              Reproduction-first automation
            </div>
            <div className="space-y-5">
              <h1 className="max-w-4xl text-5xl font-semibold tracking-tight text-balance sm:text-6xl lg:text-[4rem]">
                Issue triage that ends with a deterministic repro, not another
                status update.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
                Repo Butler classifies incoming GitHub reports, boots the right
                environment, and posts verified failing artifacts back to the
                issue so maintainers can act immediately.
              </p>
            </div>
            <div className="flex">
              <Link href="/signup" className={buttonStyles({ size: "lg" })}>
                Install the GitHub App
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <p className="max-w-xl font-mono text-sm leading-7 text-muted-foreground">
              Planner, generator, and evaluator stay visible end to end, so a
              maintainer can audit each decision before anything lands in the
              issue thread.
            </p>
          </div>

          <TerminalFrame
            title="Pipeline preview"
            subtitle="planner → generator → evaluator"
            status="developer trace"
            lines={HERO_TERMINAL_LINES}
            footer={
              <div className="grid gap-3 px-5 py-4 sm:grid-cols-2">
                <div className="rounded-[20px] border border-border/80 bg-background/70 p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                    <Bug className="h-4 w-4 text-accent" />
                    Incoming issue
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    &ldquo;Search indexing stalls after rebasing a large
                    workspace.&rdquo;
                  </p>
                </div>
                <div className="rounded-[20px] border border-border/80 bg-background/70 p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                    Posted artifact
                  </div>
                  <p className="text-sm leading-6 text-muted-foreground">
                    `failing_test.spec.ts` attached with 3/3 deterministic
                    reruns.
                  </p>
                </div>
              </div>
            }
          />
        </div>
      </section>

      <section className="border-y border-border/70 bg-panel/[0.35]">
        <div className="mx-auto grid max-w-7xl gap-6 px-6 py-5 sm:grid-cols-3 lg:px-10">
          {METRICS.map((metric, index) => (
            <div
              key={metric.label}
              className={cn(
                "space-y-2",
                index > 0 &&
                  "border-t border-border/70 pt-5 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0",
              )}
            >
              <p className="font-mono text-2xl font-semibold text-foreground">
                {metric.value}
              </p>
              <p className="text-sm leading-6 text-muted-foreground">
                {metric.label}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section id="demo" className="section-rule">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
          <div className="mb-12 max-w-3xl space-y-4">
            <div className="section-label">
              <Workflow className="h-4 w-4 text-accent" />
              Product demo
            </div>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Show the pipeline, not just the promise.
              </h2>
              <p className="mt-4 text-base leading-8 text-muted-foreground">
                The primary demo now reads like the maintainer artifact itself:
                issue context on one side, pipeline output in the center, and
                the final posted result on the other.
              </p>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.12fr)_minmax(320px,0.88fr)]">
            <TerminalFrame
              title="repo-butler run"
              subtitle="owner/repo#142"
              status="maintainer-visible trace"
              lines={DEMO_PIPELINE_LINES}
            />

            <div className="space-y-4">
              <Panel className="gap-4 bg-panel/75 p-6">
                <div className="section-label">
                  <Bug className="h-4 w-4 text-accent" />
                  Input issue
                </div>
                <h3 className="text-xl font-semibold">
                  Search indexing stalls after rebasing a large workspace
                </h3>
                <p className="text-sm leading-7 text-muted-foreground">
                  Contributor reports a stall after rebasing. Repo Butler maps
                  the issue to a regression, proposes a cache-invalidation
                  hypothesis, and asks for maintainer approval before sandbox
                  execution.
                </p>
              </Panel>

              <Panel className="gap-4 bg-panel/75 p-6">
                <div className="section-label">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  Posted back to GitHub
                </div>
                <h3 className="text-xl font-semibold">
                  Deterministic artifact
                </h3>
                <div className="rounded-[20px] border border-border/80 bg-terminal/95 p-4 font-mono text-sm leading-7 text-[#c9d1d9]">
                  <p className="text-accent">
                    {">"} pnpm test failing_test.spec.ts
                  </p>
                  <p className="mt-3 text-muted-foreground">
                    3 reruns passed with identical failure output.
                  </p>
                  <p className="mt-2 text-muted-foreground">
                    Logs sanitized. Confidence score attached to the issue
                    comment.
                  </p>
                </div>
              </Panel>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="section-rule">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
          <div className="mb-12 max-w-3xl space-y-4">
            <div className="section-label">
              <FlaskConical className="h-4 w-4 text-accent" />
              Pipeline flow
            </div>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                Three stages, one readable path from issue to evidence.
              </h2>
              <p className="mt-4 text-base leading-8 text-muted-foreground">
                Each stage has a distinct job and handoff, so the UI reads like
                a pipeline instead of a stack of identical product cards.
              </p>
            </div>
          </div>

          <div className="relative grid gap-6 lg:grid-cols-3">
            <div className="pointer-events-none absolute left-[19%] right-[19%] top-12 hidden h-px bg-gradient-to-r from-transparent via-border/90 to-transparent lg:block" />
            {FEATURE_PILLARS.map((pillar, index) => {
              const Icon = featureIcons[pillar.slug];

              return (
                <Panel
                  key={pillar.slug}
                  className={cn(
                    "relative h-full gap-5 p-6",
                    index === 1 && "bg-panel-muted/40",
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border/80 bg-background/70">
                      <Icon className="h-5 w-5 text-accent" />
                    </div>
                    <span className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">
                      0{index + 1}
                    </span>
                  </div>
                  <div className="space-y-3">
                    <h3 className="text-2xl font-semibold">{pillar.title}</h3>
                    <p className="text-sm leading-7 text-muted-foreground">
                      {pillar.description}
                    </p>
                  </div>
                  <ul className="space-y-2 text-sm leading-7 text-muted-foreground">
                    {pillar.bullets.map((bullet) => (
                      <li key={bullet} className="flex items-start gap-3">
                        <span className="mt-2 h-1.5 w-1.5 rounded-full bg-accent" />
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                  {index < FEATURE_PILLARS.length - 1 ? (
                    <div className="pointer-events-none absolute -right-4 top-10 hidden lg:flex h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-background/85">
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  ) : null}
                </Panel>
              );
            })}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="section-rule">
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
          <div className="mb-12 max-w-3xl space-y-4">
            <div className="section-label">
              <GitBranch className="h-4 w-4 text-accent" />
              How it works
            </div>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
                A clean sequence from installation to verified output.
              </h2>
              <p className="mt-4 text-base leading-8 text-muted-foreground">
                The process is expressed as a horizontal stepper, not another
                trio of cards, so it reads like a system walkthrough instead of
                a marketing grid.
              </p>
            </div>
          </div>

          <ol className="grid gap-10 lg:grid-cols-4">
            {HOW_IT_WORKS_STEPS.map((step, index) => (
              <li key={step.title} className="relative pt-2">
                {index < HOW_IT_WORKS_STEPS.length - 1 ? (
                  <div className="absolute left-10 right-[-2.5rem] top-7 hidden h-px bg-border/80 lg:block" />
                ) : null}
                <div className="mb-5 flex items-center gap-4">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full border border-border/80 bg-panel font-mono text-sm">
                    {index + 1}
                  </span>
                  <span className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                    Step 0{index + 1}
                  </span>
                </div>
                <h3 className="text-xl font-semibold">{step.title}</h3>
                <p className="mt-3 text-sm leading-7 text-muted-foreground">
                  {step.description}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="operators" className="section-rule">
        <div className="mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-[0.9fr_1.1fr] lg:px-10">
          <div className="space-y-4">
            <div className="section-label">
              <ShieldCheck className="h-4 w-4 text-accent" />
              Who it&apos;s for
            </div>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              Built for teams that need proof before they move.
            </h2>
            <p className="text-base leading-8 text-muted-foreground">
              Repo Butler is designed for engineers who live inside issues,
              terminal output, and review threads. The UI keeps the reasoning
              terse and the evidence obvious.
            </p>
          </div>

          <div className="grid gap-10 lg:grid-cols-2 lg:border-l lg:border-border/70 lg:pl-12">
            {WHO_ITS_FOR.map((audience, index) => (
              <div
                key={audience.title}
                className={cn(
                  index > 0 && "lg:border-l lg:border-border/70 lg:pl-8",
                )}
              >
                <h3 className="text-2xl font-semibold">{audience.title}</h3>
                <p className="mt-4 text-sm leading-7 text-muted-foreground">
                  {audience.description}
                </p>
                <ul className="mt-6 space-y-3 text-sm leading-7 text-muted-foreground">
                  {audience.bullets.map((bullet) => (
                    <li key={bullet} className="flex items-start gap-3">
                      <span className="mt-2 h-1.5 w-1.5 rounded-full bg-accent" />
                      <span>{bullet}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section-rule border-b border-border/70">
        <div className="mx-auto max-w-7xl px-6 py-24 text-center lg:px-10">
          <div className="section-label justify-center">
            <span className="h-2 w-2 rounded-full bg-accent" />
            Ready to reduce repro toil
          </div>
          <h2 className="mt-5 text-4xl font-semibold tracking-tight sm:text-5xl">
            Let maintainers review evidence, not guesswork.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-8 text-muted-foreground">
            Connect the GitHub App, keep approvals in the loop, and send
            deterministic artifacts back to the issue thread with a UI that
            shows the pipeline clearly.
          </p>
          <div className="mt-8 flex justify-center">
            <Link href="/signup" className={buttonStyles({ size: "lg" })}>
              Get started
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
