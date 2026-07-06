import { Prisma } from "../generated/prisma/client";
import { prisma } from "./prisma";

type LogLevel = "info" | "warn" | "error";

type MetricName =
  | "billing.due_subscriptions_found"
  | "billing.invoices_created"
  | "payments.charges_succeeded"
  | "payments.charges_failed"
  | "dunning.retries_scheduled"
  | "dunning.exhausted"
  | "webhooks.delivery_failed"
  | "cleanup.portal_sessions_expired"
  | "cleanup.payment_processing_invoices_failed"
  | "cleanup.incomplete_subscriptions_cancelled"
  | "cleanup.idempotency_keys_deleted";

type MetricLabels = Record<string, string | number | boolean | null | undefined>;

type MetricEntry = {
  name: MetricName;
  labels: Record<string, string>;
  value: number;
};

const counters = new Map<string, MetricEntry>();

function normalizeLabels(labels: MetricLabels = {}) {
  return Object.fromEntries(
    Object.entries(labels)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [key, String(value)])
      .sort(([left], [right]) => left.localeCompare(right))
  );
}

function metricKey(name: MetricName, labels: Record<string, string>) {
  return `${name}:${JSON.stringify(labels)}`;
}

export function incrementMetric(
  name: MetricName,
  labels: MetricLabels = {},
  value = 1
) {
  const normalizedLabels = normalizeLabels(labels);
  const key = metricKey(name, normalizedLabels);
  const existing = counters.get(key);

  if (existing) {
    existing.value += value;
    return existing;
  }

  const entry = { name, labels: normalizedLabels, value };
  counters.set(key, entry);
  return entry;
}

export function observeEvent(
  level: LogLevel,
  event: string,
  details: Record<string, unknown> = {}
) {
  const payload = {
    event,
    at: new Date().toISOString(),
    ...details,
  };
  const message = JSON.stringify(payload);

  if (level === "error") {
    console.error(message);
  } else if (level === "warn") {
    console.warn(message);
  } else {
    console.info(message);
  }

  void persistOperationalLog(level, event, details).catch((error) => {
    console.error(
      JSON.stringify({
        event: "operational_log.persist_failed",
        at: new Date().toISOString(),
        sourceEvent: event,
        failureReason:
          error instanceof Error ? error.message : "Operational log persist failed",
      })
    );
  });
}

function severityFromLevel(level: LogLevel) {
  return level.toUpperCase() as "INFO" | "WARN" | "ERROR";
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function modeValue(value: unknown) {
  return value === "TEST" || value === "LIVE" ? value : undefined;
}

function inferEntity(details: Record<string, unknown>) {
  const orderedKeys = [
    ["subscription", "subscriptionId"],
    ["invoice", "invoiceId"],
    ["payment_attempt", "paymentAttemptId"],
    ["dunning_attempt", "dunningAttemptId"],
    ["webhook_delivery", "deliveryId"],
    ["webhook_event", "eventId"],
    ["customer", "customerId"],
    ["payment_method", "paymentMethodId"],
  ] as const;

  for (const [entityType, key] of orderedKeys) {
    const entityId = stringValue(details[key]);
    if (entityId) {
      return { entityType, entityId };
    }
  }

  return {};
}

async function persistOperationalLog(
  level: LogLevel,
  event: string,
  details: Record<string, unknown>
) {
  const businessId = stringValue(details.businessId);
  if (!businessId) {
    return;
  }

  const inferred = inferEntity(details);
  const explicitEntityType = stringValue(details.entityType);
  const explicitEntityId = stringValue(details.entityId);

  await prisma.operationalLog.create({
    data: {
      businessId,
      mode: modeValue(details.mode),
      severity: severityFromLevel(level),
      event,
      entityType: explicitEntityType ?? inferred.entityType,
      entityId: explicitEntityId ?? inferred.entityId,
      requestId: stringValue(details.requestId),
      message: stringValue(details.message) ?? stringValue(details.failureReason),
      details: details as Prisma.InputJsonValue,
    },
  });
}

export function getMetricsSnapshot() {
  const aggregate = new Map<MetricName, number>();

  for (const entry of counters.values()) {
    aggregate.set(entry.name, (aggregate.get(entry.name) ?? 0) + entry.value);
  }

  return {
    generatedAt: new Date().toISOString(),
    counters: Object.fromEntries([...aggregate.entries()].sort()),
  };
}
