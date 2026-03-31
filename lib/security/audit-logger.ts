export enum AuditEventType {
  WEBHOOK_RECEIVED = "webhook.received",
  WEBHOOK_VERIFIED = "webhook.verified",
  WEBHOOK_REJECTED = "webhook.rejected",
  TRIAGE_STARTED = "pipeline.triage_started",
  TRIAGE_COMPLETED = "pipeline.triage_completed",
  APPROVAL_REQUESTED = "pipeline.approval_requested",
  APPROVAL_GRANTED = "pipeline.approval_granted",
  APPROVAL_DENIED = "pipeline.approval_denied",
  REPRO_DISPATCHED = "pipeline.repro_dispatched",
  REPRO_COMPLETED = "pipeline.repro_completed",
  VERIFY_COMPLETED = "pipeline.verify_completed",
  REPORT_POSTED = "pipeline.report_posted",
  TOKEN_GENERATED = "security.token_generated",
  TOKEN_EXPIRED = "security.token_expired",
  SECRET_DETECTED = "security.secret_detected_in_logs",
  POLICY_VIOLATION = "security.policy_violation",
  RATE_LIMIT_HIT = "security.rate_limit_hit",
  SANDBOX_ESCAPE_ATTEMPT = "security.sandbox_escape_attempt",
  SETTINGS_CHANGED = "admin.settings_changed",
  REPO_ACTIVATED = "admin.repo_activated",
  REPO_DEACTIVATED = "admin.repo_deactivated",
}

export type AuditSeverity = "info" | "warning" | "critical";

export type AuditEvent = {
  type: AuditEventType;
  timestamp: number;
  actor: string;
  resource: {
    type: string;
    id: string;
  };
  details: Record<string, unknown>;
  severity: AuditSeverity;
  ip?: string;
};

const SENSITIVE_KEYS = ["token", "secret", "key", "password", "authorization"];
const CRITICAL_EVENTS = new Set<AuditEventType>([
  AuditEventType.SECRET_DETECTED,
  AuditEventType.SANDBOX_ESCAPE_ATTEMPT,
  AuditEventType.POLICY_VIOLATION,
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redactSensitiveValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValue(item));
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return redactSensitiveFields(value);
}

export function redactSensitiveFields(
  details: Record<string, unknown>,
): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(details)) {
    if (SENSITIVE_KEYS.some((sensitiveKey) => key.toLowerCase().includes(sensitiveKey))) {
      redacted[key] = "[REDACTED]";
      continue;
    }

    redacted[key] = redactSensitiveValue(value);
  }

  return redacted;
}

export function defaultAuditSeverity(type: AuditEventType): AuditSeverity {
  if (CRITICAL_EVENTS.has(type)) {
    return "critical";
  }

  if (type.startsWith("security.")) {
    return "warning";
  }

  return "info";
}

export function createAuditEvent(
  type: AuditEventType,
  actor: string,
  resource: AuditEvent["resource"],
  details: Record<string, unknown> = {},
  options?: {
    ip?: string;
    severity?: AuditSeverity;
  },
): AuditEvent {
  return {
    type,
    timestamp: Date.now(),
    actor,
    resource,
    details: redactSensitiveFields(details),
    severity: options?.severity ?? defaultAuditSeverity(type),
    ...(options?.ip ? { ip: options.ip } : {}),
  };
}

export function toAuditLogMutationArgs(event: AuditEvent) {
  return {
    type: event.type,
    timestamp: event.timestamp,
    actor: event.actor,
    resourceType: event.resource.type,
    resourceId: event.resource.id,
    details: event.details,
    severity: event.severity,
    ...(event.ip ? { ip: event.ip } : {}),
  };
}
