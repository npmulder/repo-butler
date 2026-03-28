export const APP_META = {
  name: "Repo Butler",
  description: "AI-powered issue triage and automated bug reproduction for open-source maintainers",
};

export const DASHBOARD_NAV_ITEMS = [
  {
    title: "Overview",
    href: "/dashboard",
    description: "Pipeline activity and reproduction status at a glance",
  },
  {
    title: "Repos",
    href: "/dashboard/repos",
    description: "Connected repositories and GitHub App installations",
  },
  {
    title: "Runs",
    href: "/dashboard/runs",
    description: "Triage, reproduction, and verification history",
  },
  {
    title: "Settings",
    href: "/dashboard/settings",
    description: "Team, notifications, and approval preferences",
  },
] as const;

export const HERO_TERMINAL_LINES = [
  {
    label: "triager",
    tone: "accent",
    content:
      "severity=high · category=build-regression · labels=needs-repro, flaky-risk · hypothesis=workspace cache invalidation after rebase",
  },
  {
    label: "reproducer",
    tone: "muted",
    content:
      "sandbox bootstrap: devcontainer unavailable → Dockerfile detected → deterministic script synthesized from runtime feedback",
  },
  {
    label: "verifier",
    tone: "success",
    content:
      "clean-room replay: 3 reruns passed with 0% flake · no network access · no secrets surfaced · artifact posted to GitHub",
  },
] as const;

export const METRICS = [
  { value: "3x", label: "reruns required before verification passes" },
  { value: "0%", label: "flake tolerance for posted reproduction artifacts" },
  { value: "<10m", label: "from vague issue to actionable maintainer evidence" },
] as const;

export const FEATURE_PILLARS = [
  {
    slug: "triage",
    kicker: "Planner",
    title: "Triage",
    description:
      "Classify incoming issues with AI-generated severity, category, label suggestions, and a concrete reproduction hypothesis before the expensive work begins.",
    bullets: [
      "Structured issue artifacts for maintainers and automation",
      "Approval gates before sandbox reproduction proceeds",
      "Consistent taxonomy for bugs, regressions, and unsupported reports",
    ],
  },
  {
    slug: "reproduce",
    kicker: "Generator",
    title: "Reproduce",
    description:
      "Launch sandboxed reproduction runs that attempt environment setup automatically, learn from runtime feedback, and produce failing tests or deterministic scripts.",
    bullets: [
      "Environment strategy from devcontainer to Dockerfile to bootstrap scripts",
      "Iterative refinement loop driven by stderr, exit codes, and test output",
      "Artifacts optimized for maintainers to run locally without guesswork",
    ],
  },
  {
    slug: "verify",
    kicker: "Evaluator",
    title: "Verify",
    description:
      "Re-run the candidate artifact in a clean sandbox, enforce determinism checks, validate policy compliance, and report evidence back to the GitHub issue.",
    bullets: [
      "Three reruns with zero tolerated flake",
      "No-network and no-secrets policy checks before posting",
      "GitHub-ready summaries with logs, scripts, and confidence signals",
    ],
  },
] as const;

export const HOW_IT_WORKS_STEPS = [
  {
    title: "Install the GitHub App on your repo",
    description:
      "Repo Butler connects to selected repositories, captures issue context, and prepares each workspace for sandbox-safe execution.",
  },
  {
    title: "Issues are automatically triaged and queued for reproduction",
    description:
      "The planner classifies severity, suggests labels, and routes approved issues into the reproducer with an initial hypothesis.",
  },
  {
    title: "Verified reproduction artifacts are posted back to the issue",
    description:
      "The evaluator confirms determinism, checks policy compliance, and sends maintainers concrete evidence instead of vague status updates.",
  },
] as const;
