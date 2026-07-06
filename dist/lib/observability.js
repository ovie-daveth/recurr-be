"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.incrementMetric = incrementMetric;
exports.observeEvent = observeEvent;
exports.getMetricsSnapshot = getMetricsSnapshot;
const prisma_1 = require("./prisma");
const counters = new Map();
function normalizeLabels(labels = {}) {
    return Object.fromEntries(Object.entries(labels)
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => [key, String(value)])
        .sort(([left], [right]) => left.localeCompare(right)));
}
function metricKey(name, labels) {
    return `${name}:${JSON.stringify(labels)}`;
}
function incrementMetric(name, labels = {}, value = 1) {
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
function observeEvent(level, event, details = {}) {
    const payload = {
        event,
        at: new Date().toISOString(),
        ...details,
    };
    const message = JSON.stringify(payload);
    if (level === "error") {
        console.error(message);
    }
    else if (level === "warn") {
        console.warn(message);
    }
    else {
        console.info(message);
    }
    void persistOperationalLog(level, event, details).catch((error) => {
        console.error(JSON.stringify({
            event: "operational_log.persist_failed",
            at: new Date().toISOString(),
            sourceEvent: event,
            failureReason: error instanceof Error ? error.message : "Operational log persist failed",
        }));
    });
}
function severityFromLevel(level) {
    return level.toUpperCase();
}
function stringValue(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function modeValue(value) {
    return value === "TEST" || value === "LIVE" ? value : undefined;
}
function inferEntity(details) {
    const orderedKeys = [
        ["subscription", "subscriptionId"],
        ["invoice", "invoiceId"],
        ["payment_attempt", "paymentAttemptId"],
        ["dunning_attempt", "dunningAttemptId"],
        ["webhook_delivery", "deliveryId"],
        ["webhook_event", "eventId"],
        ["customer", "customerId"],
        ["payment_method", "paymentMethodId"],
    ];
    for (const [entityType, key] of orderedKeys) {
        const entityId = stringValue(details[key]);
        if (entityId) {
            return { entityType, entityId };
        }
    }
    return {};
}
async function persistOperationalLog(level, event, details) {
    const businessId = stringValue(details.businessId);
    if (!businessId) {
        return;
    }
    const inferred = inferEntity(details);
    const explicitEntityType = stringValue(details.entityType);
    const explicitEntityId = stringValue(details.entityId);
    await prisma_1.prisma.operationalLog.create({
        data: {
            businessId,
            mode: modeValue(details.mode),
            severity: severityFromLevel(level),
            event,
            entityType: explicitEntityType ?? inferred.entityType,
            entityId: explicitEntityId ?? inferred.entityId,
            requestId: stringValue(details.requestId),
            message: stringValue(details.message) ?? stringValue(details.failureReason),
            details: details,
        },
    });
}
function getMetricsSnapshot() {
    const aggregate = new Map();
    for (const entry of counters.values()) {
        aggregate.set(entry.name, (aggregate.get(entry.name) ?? 0) + entry.value);
    }
    return {
        generatedAt: new Date().toISOString(),
        counters: Object.fromEntries([...aggregate.entries()].sort()),
    };
}
