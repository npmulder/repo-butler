# Security

## Responsible Disclosure

Report suspected security vulnerabilities privately to the maintainers. Include:

- affected repository and environment,
- reproduction details or proof of concept,
- potential impact,
- any observed leaked credential material.

Do not open public GitHub issues for unpatched security findings.

## Security Practices

- Webhooks are accepted only after HMAC SHA-256 verification against the configured GitHub webhook secret.
- The control plane owns all privileged credentials. GitHub App private keys, installation tokens, Anthropic keys, sandbox worker secrets, and webhook secrets are never passed into the sandbox execution plane.
- Sandbox requests are validated before dispatch. Requests containing embedded credentials, bearer tokens, GitHub tokens, Anthropic keys, or private keys are rejected.
- Sandbox worker stdout and stderr are scanned for leaked credentials and redacted before hashes, tails, or artifacts are stored.
- Audit events are written for webhook validation, pipeline transitions, approval decisions, report posting, security violations, and rate-limit hits.
- Rate limits are enforced through shared Convex state for webhook ingestion, per-repo triage, per-repo reproduction, Claude API usage, and GitHub API usage.
- Sandbox execution runs without mounted secrets, defaults to disabled network access, and executes as non-root.

## Secret Management

- Keep production secrets in control-plane environment variables only.
- Do not embed credentials in repository clone URLs, repro artifacts, or generated test fixtures.
- Prefer short-lived installation tokens generated on demand over long-lived personal access tokens.
- Rotate any credential immediately if the scanner or audit trail indicates possible exposure.

## Operational Guidance

- Review critical audit events such as `security.secret_detected_in_logs`, `security.policy_violation`, and `security.rate_limit_hit`.
- Extend the secret scanner whenever a new credential format is introduced.
- Forward audit events to external retention systems when stronger immutability or retention guarantees are needed.
