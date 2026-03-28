export const APP_META = {
  name: "Repo Butler",
  description:
    "AI-powered issue triage and automated bug reproduction for open-source maintainers",
};

export const HOME_NAV_ITEMS = [
  { label: "Demo", href: "#demo" },
  { label: "Features", href: "#features" },
  { label: "How it works", href: "#how-it-works" },
  { label: "Who it's for", href: "#operators" },
] as const;

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
    kind: "command",
    content: "repo-butler triage owner/repo#142",
    note: "planner",
  },
  {
    kind: "output",
    label: "classified",
    tone: "accent",
    content: "bug · severity: high · labels: needs-repro, flaky-risk",
  },
  {
    kind: "output",
    label: "hypothesis",
    tone: "muted",
    content:
      "race condition in the connection pool after the rebase invalidates cache state",
  },
  {
    kind: "output",
    label: "reproduced",
    tone: "success",
    content:
      "3/3 deterministic reruns with a failing test attached to the issue thread",
  },
] as const;

export const DEMO_PIPELINE_LINES = [
  {
    kind: "command",
    content: "repo-butler run owner/repo#142",
    note: "planner → generator → evaluator",
  },
  {
    kind: "output",
    label: "context",
    tone: "muted",
    content:
      "GitHub issue, recent commits, and workspace bootstrap hints collected from the repository.",
  },
  {
    kind: "output",
    label: "triage",
    tone: "accent",
    content:
      "Classified as a high-severity regression with maintainers notified before sandbox reproduction starts.",
  },
  {
    kind: "output",
    label: "reproduce",
    tone: "warning",
    content:
      "Devcontainer failed, Dockerfile fallback succeeded, and the generator synthesized a failing test from stderr feedback.",
  },
  {
    kind: "output",
    label: "verify",
    tone: "success",
    content:
      "Three clean reruns passed with zero flake tolerance, no network access, and no secrets surfaced in the output.",
  },
  {
    kind: "output",
    label: "posted",
    tone: "muted",
    content:
      "Issue updated with a failing test, execution notes, and a confidence summary for the maintainer.",
  },
] as const;

export const METRICS = [
  { value: "<10m", label: "issue report to first deterministic artifact" },
  { value: "3/3", label: "clean reruns required before verification passes" },
  {
    value: "0 secrets",
    label: "credential leakage tolerated in posted evidence",
  },
] as const;

export const FEATURE_PILLARS = [
  {
    slug: "triage",
    title: "Triage",
    description:
      "Turn vague reports into structured maintainer context before the expensive work begins.",
    bullets: [
      "Severity, labels, and ownership hints stay visible on the issue",
      "Approval gates control when sandbox work can begin",
      "Hypotheses are explicit instead of buried in logs",
    ],
  },
  {
    slug: "reproduce",
    title: "Reproduce",
    description:
      "Launch the most likely environment, learn from runtime feedback, and keep the artifact readable.",
    bullets: [
      "Fallbacks move from devcontainer to Dockerfile to bootstrap scripts",
      "Every retry explains what changed and why it changed",
      "Artifacts are ready for a maintainer to run locally",
    ],
  },
  {
    slug: "verify",
    title: "Verify",
    description:
      "Re-run the candidate artifact in a clean sandbox and only post what survives verification.",
    bullets: [
      "Three reruns with zero tolerated flake",
      "Network and secret checks gate anything that gets posted",
      "GitHub-ready summaries include confidence, logs, and the failing test",
    ],
  },
] as const;

export const HOW_IT_WORKS_STEPS = [
  {
    title: "Install the GitHub App",
    description:
      "Connect Repo Butler to the repositories where maintainers want structured triage and reproduction help.",
  },
  {
    title: "Approve the reproduction path",
    description:
      "The planner classifies the report and keeps human approval in the loop before risky sandbox work starts.",
  },
  {
    title: "Generate the artifact",
    description:
      "The generator bootstraps the workspace, reacts to stderr and test output, and converges on a failing artifact.",
  },
  {
    title: "Post verified evidence",
    description:
      "The evaluator reruns the artifact, enforces policy checks, and sends only deterministic evidence back to GitHub.",
  },
] as const;

export const WHO_ITS_FOR = [
  {
    title: "Open-source maintainers",
    description:
      "Use Repo Butler to turn high-volume issue queues into auditable repro attempts without disappearing into manual setup loops.",
    bullets: [
      "Keep contributor conversations grounded in concrete evidence",
      "See severity, confidence, and reproduction status at a glance",
      "Require approval before expensive or sensitive workflows run",
    ],
  },
  {
    title: "Engineering teams",
    description:
      "Use the same pipeline for internal bug intake so on-call engineers stop translating vague reports into ad hoc debugging sessions.",
    bullets: [
      "Standardize how bugs move from report to failing artifact",
      "Share reproducible evidence across product, QA, and infra",
      "Preserve a readable audit trail when automation takes action",
    ],
  },
] as const;
