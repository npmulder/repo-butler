export const sampleIssues = {
  clearBug: {
    number: 42,
    title: "Crash when parsing empty YAML file",
    body: `## Description
App crashes with ParseError when opening an empty .yaml file.

## Steps to Reproduce
1. Create an empty file test.yaml
2. Run \`myapp parse test.yaml\`
3. Observe crash

## Expected
Should handle empty files gracefully.

## Actual
\`\`\`
ParseError: unexpected end of input
  at Parser.parse (src/parser.ts:45)
\`\`\`

## Environment
- OS: Ubuntu 22.04
- Node: 20.x`,
    url: "https://github.com/test/repo/issues/42",
    author: "testuser",
    labels: [],
    createdAt: "2026-03-25T10:00:00Z",
  },
  featureRequest: {
    number: 43,
    title: "Add dark mode support",
    body: "It would be great if the app supported a dark mode theme. Many modern apps have this feature.",
    url: "https://github.com/test/repo/issues/43",
    author: "themer",
    labels: ["enhancement"],
    createdAt: "2026-03-25T11:00:00Z",
  },
  ambiguousBug: {
    number: 44,
    title: "Something is wrong with the API",
    body: "The API doesn't work sometimes. I think it might be a caching issue but I'm not sure.",
    url: "https://github.com/test/repo/issues/44",
    author: "vaguereporter",
    labels: [],
    createdAt: "2026-03-25T12:00:00Z",
  },
  docsIssue: {
    number: 45,
    title: "README install instructions are outdated",
    body: "The README says to run `npm install -g myapp` but the package was renamed to `@scope/myapp` in v3.0.",
    url: "https://github.com/test/repo/issues/45",
    author: "docsfixer",
    labels: ["documentation"],
    createdAt: "2026-03-25T13:00:00Z",
  },
} as const;
