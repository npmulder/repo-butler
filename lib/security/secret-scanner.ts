export type SecretFinding = {
  type: string;
  location: string;
  lineNumber?: number;
};

export type ScanResult = {
  clean: boolean;
  findings: SecretFinding[];
};

export const SECRET_PATTERNS: ReadonlyArray<{
  type: string;
  pattern: RegExp;
}> = [
  { type: "GitHub PAT", pattern: /ghp_[A-Za-z0-9]{36}/g },
  { type: "GitHub App token", pattern: /ghs_[A-Za-z0-9]{36}/g },
  {
    type: "GitHub fine-grained token",
    pattern: /github_pat_[A-Za-z0-9_]{22}_[A-Za-z0-9_]{59}/g,
  },
  { type: "Anthropic API key", pattern: /sk-ant-[A-Za-z0-9-]+/g },
  { type: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/g },
  {
    type: "Private key",
    pattern: /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----/g,
  },
  {
    type: "Generic secret assignment",
    pattern:
      /(?<![A-Za-z0-9_])(?:secret|password|token|key|api[_-]?key)(?![A-Za-z0-9_])\s*[:=]\s*["'][A-Za-z0-9/+_.=-]{8,}["']/gi,
  },
];

function toGlobalPattern(pattern: RegExp) {
  return pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
}

function lineNumberAt(content: string, index: number) {
  return content.slice(0, index).split(/\r?\n/).length;
}

export function scanForSecrets(content: string, source: string): ScanResult {
  const findings: SecretFinding[] = [];

  for (const { type, pattern } of SECRET_PATTERNS) {
    for (const match of content.matchAll(toGlobalPattern(pattern))) {
      if (match.index === undefined) {
        continue;
      }

      findings.push({
        type,
        location: source,
        lineNumber: lineNumberAt(content, match.index),
      });
    }
  }

  return {
    clean: findings.length === 0,
    findings,
  };
}

export function redactSecrets(content: string) {
  let redacted = content;

  for (const { pattern } of SECRET_PATTERNS) {
    redacted = redacted.replace(toGlobalPattern(pattern), "[REDACTED]");
  }

  return redacted;
}
