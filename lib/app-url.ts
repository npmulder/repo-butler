const DEFAULT_APP_URL = "http://localhost:3000";

export function normalizeAppUrl(candidate: string | undefined): string | null {
  if (!candidate) {
    return null;
  }

  const trimmed = candidate.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const withProtocol = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;

    return new URL(withProtocol).origin;
  } catch {
    return null;
  }
}

function firstNormalizedAppUrl(
  ...candidates: Array<string | undefined>
): string | null {
  for (const candidate of candidates) {
    const normalized = normalizeAppUrl(candidate);

    if (normalized) {
      return normalized;
    }
  }

  return null;
}

export function getRepoButlerAppUrl(): string {
  return (
    firstNormalizedAppUrl(
      process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
      process.env.VERCEL_BRANCH_URL,
      process.env.VERCEL_PROJECT_PRODUCTION_URL,
      process.env.VERCEL_URL,
    ) ?? DEFAULT_APP_URL
  );
}

export function getDashboardBaseUrl(): string {
  return (
    firstNormalizedAppUrl(
      process.env.APP_URL,
      process.env.PREVIEW_APP_URL,
      process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
      process.env.VERCEL_BRANCH_URL,
      process.env.VERCEL_PROJECT_PRODUCTION_URL,
      process.env.VERCEL_URL,
    ) ?? DEFAULT_APP_URL
  );
}
