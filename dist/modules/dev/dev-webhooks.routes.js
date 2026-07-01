"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.devWebhooksRouter = void 0;
const crypto_1 = __importDefault(require("crypto"));
const express_1 = require("express");
const async_handler_1 = require("../../lib/async-handler");
const errors_1 = require("../../lib/errors");
const prisma_1 = require("../../lib/prisma");
const responses_1 = require("../../lib/responses");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const nomba_webhook_processor_1 = require("../webhooks/nomba-webhook.processor");
const dev_webhooks_schema_1 = require("./dev-webhooks.schema");
exports.devWebhooksRouter = (0, express_1.Router)();
exports.devWebhooksRouter.use((req, _res, next) => {
    if (process.env.NODE_ENV === "production") {
        next(new errors_1.ApiError(404, "Not found"));
        return;
    }
    next();
});
function webhookSecret() {
    return (process.env.NOMBA_WEBHOOK_SECRET ||
        process.env.NOMBA_WEBHOOK_SIGNING_KEY ||
        "NombaHackathon2026");
}
function signRawBody(rawBody) {
    return crypto_1.default.createHmac("sha256", webhookSecret()).update(rawBody).digest("hex");
}
function getNombaWebhookMode() {
    return process.env.NOMBA_WEBHOOK_MODE === "LIVE" ? "LIVE" : "TEST";
}
exports.devWebhooksRouter.post("/nomba/simulate", (0, validate_middleware_1.validate)({ body: dev_webhooks_schema_1.simulateNombaWebhookSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const input = req.body;
    const requestId = input.requestId ?? crypto_1.default.randomUUID();
    const orderReference = input.orderReference ?? input.merchantTxRef.replace(/^recur_attempt_/, "ord_");
    const transactionId = input.transactionId ?? `WEB-ONLINE_C-dev-${crypto_1.default.randomUUID()}`;
    const majorAmount = input.amountMinor / 100;
    const eventType = input.eventType;
    const mode = input.mode ?? getNombaWebhookMode();
    const payload = {
        event_type: eventType,
        requestId,
        data: {
            merchant: {
                userId: process.env.NOMBA_ACCOUNT_ID || "dev-account",
            },
            transaction: {
                fee: 0,
                type: "online_checkout",
                transactionId,
                merchantTxRef: input.merchantTxRef,
                transactionAmount: majorAmount,
                time: new Date().toISOString(),
            },
            order: {
                amount: majorAmount,
                orderId: crypto_1.default.randomUUID(),
                accountId: process.env.NOMBA_ACCOUNT_ID || "dev-account",
                customerEmail: input.customerEmail ?? "dev@example.com",
                orderReference,
                paymentMethod: "card_payment",
                currency: input.currency,
            },
        },
    };
    const rawBody = JSON.stringify(payload);
    const signature = signRawBody(rawBody);
    const rawBodyHash = crypto_1.default.createHash("sha256").update(rawBody).digest("hex");
    const event = await prisma_1.prisma.webhookEvent.create({
        data: {
            provider: "nomba",
            mode,
            providerEventId: requestId,
            eventType,
            rawBody,
            rawBodyHash,
            payload: payload,
            headers: {
                "nomba-signature": signature,
                "nomba-signature-algorithm": "HmacSHA256",
                "nomba-timestamp": new Date().toISOString(),
                "x-dev-simulated": "true",
            },
            signature,
            providerSentAt: new Date(),
            status: "RECEIVED",
        },
    });
    await (0, nomba_webhook_processor_1.processNombaWebhookEvent)({
        eventId: event.id,
        mode,
        eventType,
        payload,
        skipTransactionVerification: input.skipTransactionVerification,
    });
    const processedEvent = await prisma_1.prisma.webhookEvent.findUnique({
        where: { id: event.id },
    });
    (0, responses_1.sendSuccess)(res, 201, "Nomba webhook simulated", {
        event: processedEvent,
        signedRequest: {
            url: "/api/v1/webhooks/nomba",
            headers: {
                "Content-Type": "application/json",
                "nomba-signature": signature,
                "nomba-signature-algorithm": "HmacSHA256",
            },
            body: payload,
        },
    });
}));
