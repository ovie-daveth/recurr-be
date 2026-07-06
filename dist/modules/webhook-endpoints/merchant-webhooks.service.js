"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateWebhookSigningSecret = generateWebhookSigningSecret;
exports.emitMerchantWebhook = emitMerchantWebhook;
exports.sendWebhookEndpointTest = sendWebhookEndpointTest;
exports.runDueWebhookDeliveries = runDueWebhookDeliveries;
const crypto_1 = __importDefault(require("crypto"));
const advisory_lock_1 = require("../../lib/advisory-lock");
const prisma_1 = require("../../lib/prisma");
const DEFAULT_RETRY_DELAYS_MINUTES = [1, 5, 30, 120, 720];
function retryDelaysMinutes() {
    const configured = process.env.WEBHOOK_RETRY_DELAYS_MINUTES;
    if (!configured) {
        return DEFAULT_RETRY_DELAYS_MINUTES;
    }
    const parsed = configured
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0);
    return parsed.length ? parsed : DEFAULT_RETRY_DELAYS_MINUTES;
}
function addMinutes(date, minutes) {
    const next = new Date(date);
    next.setMinutes(next.getMinutes() + minutes);
    return next;
}
function nextRetryDate(attempts) {
    const delayMinutes = retryDelaysMinutes()[attempts - 1];
    return delayMinutes ? addMinutes(new Date(), delayMinutes) : null;
}
function generateEventId() {
    return `evt_${crypto_1.default.randomUUID()}`;
}
function generateWebhookSigningSecret() {
    return `whsec_${crypto_1.default.randomBytes(32).toString("base64url")}`;
}
function signPayload(input) {
    return crypto_1.default
        .createHmac("sha256", input.secret)
        .update(`${input.timestamp}.${input.rawBody}`)
        .digest("hex");
}
function responseBodyPreview(body) {
    return body.length > 1000 ? body.slice(0, 1000) : body;
}
async function postWithTimeout(input) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
        return await fetch(input.url, {
            method: "POST",
            headers: input.headers,
            body: input.rawBody,
            signal: controller.signal,
        });
    }
    finally {
        clearTimeout(timeout);
    }
}
async function deliverToEndpoint(input) {
    const rawBody = JSON.stringify(input.payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = signPayload({
        secret: input.endpoint.secret,
        timestamp,
        rawBody,
    });
    const delivery = await prisma_1.prisma.webhookDelivery.create({
        data: {
            businessId: input.endpoint.businessId,
            endpointId: input.endpoint.id,
            eventId: input.payload.id,
            eventType: input.payload.type,
            payload: input.payload,
            status: "PENDING",
        },
    });
    try {
        const response = await postWithTimeout({
            url: input.endpoint.url,
            rawBody,
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "Recurr-Webhooks/1.0",
                "X-Recurr-Event": input.payload.type,
                "X-Recurr-Delivery": delivery.id,
                "X-Recurr-Timestamp": timestamp,
                "X-Recurr-Signature": signature,
            },
        });
        const responseText = await response.text().catch(() => "");
        const delivered = response.status >= 200 && response.status < 300;
        const attempts = delivery.attempts + 1;
        const nextAttemptAt = delivered ? null : nextRetryDate(attempts);
        return prisma_1.prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: {
                attempts,
                status: delivered ? "DELIVERED" : nextAttemptAt ? "RETRYING" : "FAILED",
                nextAttemptAt,
                lastAttemptAt: new Date(),
                deliveredAt: delivered ? new Date() : null,
                lastStatusCode: response.status,
                lastResponseBody: responseBodyPreview(responseText),
                failureReason: delivered
                    ? null
                    : `Endpoint returned HTTP ${response.status}`,
            },
        });
    }
    catch (error) {
        const attempts = delivery.attempts + 1;
        const nextAttemptAt = nextRetryDate(attempts);
        return prisma_1.prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: {
                attempts,
                status: nextAttemptAt ? "RETRYING" : "FAILED",
                nextAttemptAt,
                lastAttemptAt: new Date(),
                failureReason: error instanceof Error ? error.message : "Webhook delivery failed",
            },
        });
    }
}
async function emitMerchantWebhook(input) {
    const payload = {
        id: generateEventId(),
        type: input.type,
        businessId: input.businessId,
        data: input.data,
        createdAt: new Date().toISOString(),
    };
    const endpoints = await prisma_1.prisma.webhookEndpoint.findMany({
        where: {
            businessId: input.businessId,
            status: "ACTIVE",
            OR: [{ events: { has: "*" } }, { events: { has: input.type } }],
        },
    });
    await Promise.all(endpoints.map((endpoint) => deliverToEndpoint({ endpoint, payload })));
    return { event: payload, endpointCount: endpoints.length };
}
async function sendWebhookEndpointTest(input) {
    const endpoint = await prisma_1.prisma.webhookEndpoint.findFirst({
        where: {
            id: input.endpointId,
            businessId: input.businessId,
            status: "ACTIVE",
        },
    });
    if (!endpoint) {
        return null;
    }
    const payload = {
        id: generateEventId(),
        type: "webhook_endpoint.test",
        businessId: input.businessId,
        data: {
            message: "Recurr webhook endpoint test",
            endpointId: endpoint.id,
        },
        createdAt: new Date().toISOString(),
    };
    return deliverToEndpoint({ endpoint, payload });
}
async function redeliverExistingDelivery(input) {
    const claim = await prisma_1.prisma.$transaction(async (tx) => {
        const locked = await (0, advisory_lock_1.tryAcquireTransactionAdvisoryLock)(tx, (0, advisory_lock_1.advisoryLockKey)("webhook-delivery", input.deliveryId));
        if (!locked) {
            return null;
        }
        const delivery = await tx.webhookDelivery.findUnique({
            where: { id: input.deliveryId },
            include: { endpoint: true },
        });
        if (!delivery) {
            return null;
        }
        if (delivery.status === "RETRYING" &&
            delivery.nextAttemptAt &&
            delivery.nextAttemptAt.getTime() <= Date.now()) {
            const claimedDelivery = await tx.webhookDelivery.update({
                where: { id: delivery.id },
                data: { nextAttemptAt: null },
                include: { endpoint: true },
            });
            return claimedDelivery;
        }
        return delivery;
    });
    if (!claim) {
        return null;
    }
    const delivery = claim;
    if (delivery.status === "DELIVERED") {
        return delivery;
    }
    if (delivery.endpoint.status !== "ACTIVE") {
        return prisma_1.prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: {
                status: "FAILED",
                failureReason: "Webhook endpoint is not active",
                nextAttemptAt: null,
            },
        });
    }
    const rawBody = JSON.stringify(delivery.payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = signPayload({
        secret: delivery.endpoint.secret,
        timestamp,
        rawBody,
    });
    try {
        const response = await postWithTimeout({
            url: delivery.endpoint.url,
            rawBody,
            headers: {
                "Content-Type": "application/json",
                "User-Agent": "Recurr-Webhooks/1.0",
                "X-Recurr-Event": delivery.eventType,
                "X-Recurr-Delivery": delivery.id,
                "X-Recurr-Timestamp": timestamp,
                "X-Recurr-Signature": signature,
            },
        });
        const responseText = await response.text().catch(() => "");
        const delivered = response.status >= 200 && response.status < 300;
        const attempts = delivery.attempts + 1;
        const nextAttemptAt = delivered ? null : nextRetryDate(attempts);
        return prisma_1.prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: {
                attempts,
                status: delivered ? "DELIVERED" : nextAttemptAt ? "RETRYING" : "FAILED",
                nextAttemptAt,
                lastAttemptAt: new Date(),
                deliveredAt: delivered ? new Date() : delivery.deliveredAt,
                lastStatusCode: response.status,
                lastResponseBody: responseBodyPreview(responseText),
                failureReason: delivered
                    ? null
                    : `Endpoint returned HTTP ${response.status}`,
            },
        });
    }
    catch (error) {
        const attempts = delivery.attempts + 1;
        const nextAttemptAt = nextRetryDate(attempts);
        return prisma_1.prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: {
                attempts,
                status: nextAttemptAt ? "RETRYING" : "FAILED",
                nextAttemptAt,
                lastAttemptAt: new Date(),
                failureReason: error instanceof Error ? error.message : "Webhook delivery failed",
            },
        });
    }
}
async function runDueWebhookDeliveries(input) {
    const now = input.now ?? new Date();
    const limit = input.limit ?? 50;
    const deliveries = await prisma_1.prisma.webhookDelivery.findMany({
        where: {
            ...(input.businessId ? { businessId: input.businessId } : {}),
            ...(input.endpointId ? { endpointId: input.endpointId } : {}),
            status: "RETRYING",
            nextAttemptAt: { lte: now },
        },
        orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
        take: limit,
        select: { id: true },
    });
    const results = [];
    for (const delivery of deliveries) {
        try {
            const webhookDelivery = await redeliverExistingDelivery({
                deliveryId: delivery.id,
            });
            results.push({
                deliveryId: delivery.id,
                status: webhookDelivery?.status ?? "FAILED",
            });
        }
        catch (error) {
            results.push({
                deliveryId: delivery.id,
                status: "FAILED",
                reason: error instanceof Error ? error.message : "Webhook retry processing failed",
            });
        }
    }
    return {
        processedAt: now,
        count: results.length,
        results,
    };
}
