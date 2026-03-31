export type RateLimitConfig = {
  maxRequests: number;
  windowMs: number;
};

export type RateLimitName =
  | "webhookIngestion"
  | "triagePerRepo"
  | "reproPerRepo"
  | "claudeApiCalls"
  | "githubApiCalls";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
};

export type RateLimitEvent = {
  timestamp: number;
};

export type RateLimitStore = {
  listEventsSince(
    key: string,
    since: number,
    limit: number,
  ): Promise<ReadonlyArray<RateLimitEvent>>;
  insertEvent(event: { key: string; timestamp: number }): Promise<void>;
};

export const RATE_LIMITS: Record<RateLimitName, RateLimitConfig> = {
  webhookIngestion: { maxRequests: 100, windowMs: 60_000 },
  triagePerRepo: { maxRequests: 50, windowMs: 3_600_000 },
  reproPerRepo: { maxRequests: 20, windowMs: 3_600_000 },
  claudeApiCalls: { maxRequests: 200, windowMs: 3_600_000 },
  githubApiCalls: { maxRequests: 500, windowMs: 3_600_000 },
};

function sortEvents(events: ReadonlyArray<RateLimitEvent>) {
  return [...events].sort((left, right) => left.timestamp - right.timestamp);
}

function computeResetAt(
  events: ReadonlyArray<RateLimitEvent>,
  config: RateLimitConfig,
  now: number,
) {
  return events.length > 0
    ? events[0]!.timestamp + config.windowMs
    : now + config.windowMs;
}

export function buildRateLimitKey(name: RateLimitName, scope = "global") {
  return `${name}:${scope}`;
}

export function evaluateRateLimitWindow(
  events: ReadonlyArray<RateLimitEvent>,
  config: RateLimitConfig,
  now = Date.now(),
): RateLimitResult {
  const sortedEvents = sortEvents(events);
  const allowed = sortedEvents.length < config.maxRequests;
  const remaining = Math.max(
    0,
    config.maxRequests - sortedEvents.length - (allowed ? 1 : 0),
  );

  return {
    allowed,
    remaining,
    resetAt: computeResetAt(sortedEvents, config, now),
  };
}

export async function checkRateLimit(
  store: RateLimitStore,
  key: string,
  config: RateLimitConfig,
  now = Date.now(),
): Promise<RateLimitResult> {
  const windowStart = now - config.windowMs;
  const recentEvents = await store.listEventsSince(
    key,
    windowStart,
    config.maxRequests + 1,
  );
  const result = evaluateRateLimitWindow(recentEvents, config, now);

  if (result.allowed) {
    await store.insertEvent({ key, timestamp: now });
  }

  return result;
}
