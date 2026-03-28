const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /(?:GITHUB_TOKEN|GH_TOKEN|GITHUB_APP_PRIVATE_KEY)=\S+/gi,
  /(?:sk-|sk_test_|sk_live_)\S+/g,
  /ghp_[A-Za-z0-9_]{36}/g,
  /ghs_[A-Za-z0-9_]{36}/g,
  /github_pat_[A-Za-z0-9_]{22}_[A-Za-z0-9_]{59}/g,
  /(?:Bearer|token)\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /-----BEGIN(?: [A-Z0-9]+)? PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z0-9]+)? PRIVATE KEY-----/g,
  /(?:password|secret|credential|api_key)\s*[:=]\s*\S+/gi,
];

export function redactSecrets(text: string): string {
  let redacted = text;

  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }

  return redacted;
}

export function redactEnvVars(text: string, envVarNames: string[]): string {
  let redacted = text;

  for (const name of envVarNames) {
    const value = process.env[name];

    if (!value || value.length <= 4) {
      continue;
    }

    redacted = redacted.replaceAll(value, `[${name}:REDACTED]`);
  }

  return redacted;
}
