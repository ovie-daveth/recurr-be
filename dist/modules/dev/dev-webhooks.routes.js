"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.devWebhooksRouter = void 0;
const crypto_1 = __importDefault(require("crypto"));
const express_1 = require("express");
const async_handler_1 = require("../../lib/async-handler");
const prisma_1 = require("../../lib/prisma");
const responses_1 = require("../../lib/responses");
const merchant_session_middleware_1 = require("../../middlewares/merchant-session.middleware");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const nomba_webhook_processor_1 = require("../webhooks/nomba-webhook.processor");
const dev_webhooks_schema_1 = require("./dev-webhooks.schema");
exports.devWebhooksRouter = (0, express_1.Router)();
function webhookSecret() {
    return (process.env.NOMBA_WEBHOOK_SECRET ||
        process.env.NOMBA_WEBHOOK_SIGNING_KEY ||
        "NombaHackathon2026");
}
async function requireMerchantSession(req, res, next) {
    await (0, merchant_session_middleware_1.merchantSessionMiddleware)(req, res, next);
}
function getNombaWebhookMode() {
    return process.env.NOMBA_WEBHOOK_MODE === "LIVE" ? "LIVE" : "TEST";
}
function signNombaCanonicalPayload(payload, timestamp) {
    const canonical = [
        payload.event_type,
        payload.requestId,
        payload.data.merchant.userId,
        payload.data.merchant.walletId,
        payload.data.transaction.transactionId,
        payload.data.transaction.type,
        payload.data.transaction.time,
        payload.data.transaction.responseCode ?? "",
        timestamp,
    ].join(":");
    return crypto_1.default
        .createHmac("sha256", webhookSecret())
        .update(canonical)
        .digest("base64");
}
exports.devWebhooksRouter.post("/nomba/simulate", requireMerchantSession, (0, validate_middleware_1.validate)({ body: dev_webhooks_schema_1.simulateNombaWebhookSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const input = req.body;
    const requestId = input.requestId ?? crypto_1.default.randomUUID();
    const orderReference = input.orderReference ??
        input.merchantTxRef?.replace(/^recur_attempt_/, "ord_") ??
        crypto_1.default.randomUUID();
    const transactionId = input.transactionId ?? `WEB-ONLINE_C-dev-${crypto_1.default.randomUUID()}`;
    const majorAmount = input.amountMinor / 100;
    const eventType = input.eventType;
    const mode = input.mode ?? getNombaWebhookMode();
    const now = new Date();
    const transactionTime = now.toISOString();
    const timestamp = Math.floor(now.getTime() / 1000).toString();
    const nombaCustomerId = input.nombaCustomerId ?? `cus_${crypto_1.default.randomUUID().replace(/-/g, "")}`;
    const tokenKey = input.tokenKey ?? input.cardId ?? `tok_${crypto_1.default.randomUUID().replace(/-/g, "")}`;
    const payload = {
        event_type: eventType,
        requestId,
        data: {
            amount: input.amountMinor,
            currency: input.currency,
            merchant: {
                userId: process.env.NOMBA_ACCOUNT_ID || "dev-account",
                walletId: process.env.NOMBA_WALLET_ID || process.env.NOMBA_ACCOUNT_ID || "dev-wallet",
            },
            transaction: {
                fee: 0,
                type: "online_checkout",
                transactionId,
                merchantTxRef: input.merchantTxRef,
                transactionAmount: majorAmount,
                responseCode: eventType === "payment_success" ? "00" : "99",
                time: transactionTime,
            },
            order: {
                amount: majorAmount,
                orderId: crypto_1.default.randomUUID(),
                accountId: process.env.NOMBA_ACCOUNT_ID || "dev-account",
                customerId: nombaCustomerId,
                customerEmail: input.customerEmail ?? "dev@example.com",
                orderReference,
                paymentMethod: "card_payment",
                currency: input.currency,
            },
            paymentMethod: {
                tokenKey,
                cardId: tokenKey,
                customerId: nombaCustomerId,
                brand: input.cardBrand ?? "visa",
                last4: input.cardLast4 ?? "6666",
            },
        },
    };
    const rawBody = JSON.stringify(payload);
    const signature = signNombaCanonicalPayload(payload, timestamp);
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
                "nomba-signature-version": "1.0.0",
                "nomba-timestamp": timestamp,
                "x-dev-simulated": "true",
            },
            signature,
            providerSentAt: now,
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
                "nomba-signature-version": "1.0.0",
                "nomba-timestamp": timestamp,
            },
            body: payload,
        },
    });
}));
