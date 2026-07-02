"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateWebhookSigningSecret = generateWebhookSigningSecret;
exports.emitMerchantWebhook = emitMerchantWebhook;
exports.sendWebhookEndpointTest = sendWebhookEndpointTest;
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = require("../../lib/prisma");
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
        return prisma_1.prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: {
                attempts: { increment: 1 },
                status: delivered ? "DELIVERED" : "FAILED",
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
        return prisma_1.prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: {
                attempts: { increment: 1 },
                status: "FAILED",
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
