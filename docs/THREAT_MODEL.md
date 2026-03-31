# Threat Model

## Scope

This document covers the production security boundary for Repo Butler's webhook ingestion, control-plane orchestration, sandbox execution plane, artifact storage, and reporting pipeline.

## Trust Boundaries

- GitHub webhooks and issue content are untrusted input until verified.
- LLM output is untrusted and must not receive mutation-capable credentials.
- Sandbox execution is isolated from the control plane and receives no mutation tokens.
- Logs and stored artifacts must be redacted before persistence or display.

## Threats And Mitigations

| Threat | Severity | Mitigation |
| --- | --- | --- |
| Malicious code in repo executes during repro | High | Docker sandbox, network disabled by default, non-root execution, bounded wall-clock timeout, limited iterations |
| Token exfiltration via sandbox logs | High | Sandbox request validation, secret scanner on worker output, redaction before storage, no control-plane tokens in sandbox payloads |
| Model bypass (Claude creates PRs directly) | Medium | Token isolation policy keeps GitHub installation tokens and private keys in the control plane only |
| Webhook spoofing | Medium | HMAC SHA-256 verification with constant-time comparison before webhook dispatch |
| Resource exhaustion (fork bomb, memory abuse) | Medium | PID and process limits in sandbox runtime, bounded timeout, disabled network, rate limiting on ingestion and pipeline entry points |
| Dependency confusion attack | Medium | Pinned base images, lockfile-first installs, no automatic credential injection into untrusted dependency resolution |
| Audit log tampering | Low | Convex audit log inserts are append-only in application flow, with a path for external forwarding if stricter retention is required |
| Rate limit bypass | Low | Distributed rate-limit state in Convex with shared keys for webhook, triage, reproduction, Claude API, and GitHub API budgets |

## Security Assumptions

- `GITHUB_APP_WEBHOOK_SECRET`, `SANDBOX_WORKER_SECRET`, GitHub App credentials, and LLM API keys are stored only in control-plane environment configuration.
- Sandbox workers never mount writable secrets or receive mutation-capable tokens in requests.
- GitHub installation tokens are generated on demand in the control plane and are not embedded in clone URLs.

## Residual Risk

- Redaction is pattern-based. New secret formats require extending the scanner and redactor patterns.
- Audit logs are durable inside Convex, but regulatory retention requirements may still require external forwarding.
