"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhooksRouter = void 0;
const crypto_1 = __importDefault(require("crypto"));
const express_1 = require("express");
const zod_1 = require("zod");
const client_1 = require("../../generated/prisma/client");
const async_handler_1 = require("../../lib/async-handler");
const errors_1 = require("../../lib/errors");
const pagination_1 = require("../../lib/pagination");
const prisma_1 = require("../../lib/prisma");
const responses_1 = require("../../lib/responses");
const merchant_session_middleware_1 = require("../../middlewares/merchant-session.middleware");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const nomba_webhook_processor_1 = require("./nomba-webhook.processor");
const nomba_webhook_security_1 = require("./nomba-webhook.security");
exports.webhooksRouter = (0, express_1.Router)();
const listWebhookEventsQuerySchema = pagination_1.paginationQuerySchema.extend({
    provider: zod_1.z.string().trim().default("nomba"),
    mode: zod_1.z.enum(["TEST", "LIVE"]).optional(),
    status: zod_1.z.enum(["RECEIVED", "PROCESSED", "FAILED"]).optional(),
    eventType: zod_1.z.string().trim().optional(),
    providerEventId: zod_1.z.string().trim().optional(),
});
const webhookEventParamsSchema = zod_1.z.object({
    id: zod_1.z.uuid(),
});
function rawBodyToString(rawBody) {
    return rawBody.toString("utf8");
}
function hashRawBody(rawBody) {
    return crypto_1.default.createHash("sha256").update(rawBody).digest("hex");
}
function sanitizeHeaders(headers) {
    const sanitized = {};
    for (const [key, value] of Object.entries(headers)) {
        if (key.toLowerCase() === "authorization") {
            continue;
        }
        if (typeof value === "undefined") {
            continue;
        }
        sanitized[key] = value;
    }
    return sanitized;
}
function getStringProperty(value, keys) {
    if (!value || typeof value !== "object") {
        return undefined;
    }
    const record = value;
    for (const key of keys) {
        const property = record[key];
        if (typeof property === "string" && property.trim()) {
            return property.trim();
        }
    }
    return undefined;
}
function getProviderEventIdHeader(headers) {
    const headerName = process.env.NOMBA_WEBHOOK_EVENT_ID_HEADER || "x-nomba-event-id";
    const value = headers[headerName.toLowerCase()];
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }
    if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) {
        return value[0].trim();
    }
    return undefined;
}
function extractNombaEventBasics(payload) {
    const requestId = getStringProperty(payload, ["requestId"]);
    const eventType = getStringProperty(payload, ["event", "event_type"]);
    if (!requestId) {
        throw new errors_1.ApiError(400, "Nomba webhook payload must include requestId", [], "NOMBA_WEBHOOK_REQUEST_ID_REQUIRED");
    }
    if (!eventType) {
        throw new errors_1.ApiError(400, "Nomba webhook payload must include event or event_type", [], "NOMBA_WEBHOOK_EVENT_REQUIRED");
    }
    return { requestId, eventType };
}
function getNombaWebhookMode() {
    return process.env.NOMBA_WEBHOOK_MODE === "LIVE" ? "LIVE" : "TEST";
}
function shouldDebugNomba() {
    return process.env.NOMBA_DEBUG === "true";
}
function logNombaWebhookDebug(data) {
    if (!shouldDebugNomba()) {
        return;
    }
    console.log("[NOMBA_DEBUG] webhook.received", JSON.stringify(data, null, 2));
}
exports.webhooksRouter.get("/events", merchant_session_middleware_1.merchantSessionMiddleware, (0, validate_middleware_1.validate)({ query: listWebhookEventsQuerySchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const query = req.validatedQuery;
    const events = await prisma_1.prisma.webhookEvent.findMany({
        where: {
            provider: query.provider,
            ...(query.mode ? { mode: query.mode } : {}),
            ...(query.status ? { status: query.status } : {}),
            ...(query.eventType ? { eventType: query.eventType } : {}),
            ...(query.providerEventId
                ? { providerEventId: query.providerEventId }
                : {}),
            ...((0, pagination_1.dateRangeFilter)(query) ? { receivedAt: (0, pagination_1.dateRangeFilter)(query) } : {}),
        },
        orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
        ...(0, pagination_1.paginationArgs)(query),
    });
    const page = (0, pagination_1.paginateResults)(events, query.limit);
    (0, responses_1.sendSuccess)(res, 200, "Webhook events returned", {
        webhookEvents: page.data,
        pagination: page.pagination,
    });
}));
exports.webhooksRouter.get("/events/:id", merchant_session_middleware_1.merchantSessionMiddleware, (0, validate_middleware_1.validate)({ params: webhookEventParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const event = await prisma_1.prisma.webhookEvent.findUnique({
        where: { id: String(req.params.id) },
    });
    if (!event) {
        throw new errors_1.ApiError(404, "Webhook event not found");
    }
    (0, responses_1.sendSuccess)(res, 200, "Webhook event returned", { webhookEvent: event });
}));
exports.webhooksRouter.post("/nomba", (0, async_handler_1.asyncHandler)(async (req, res) => {
    if (!Buffer.isBuffer(req.body)) {
        throw new errors_1.ApiError(400, "Webhook raw body is required", [], "WEBHOOK_RAW_BODY_REQUIRED");
    }
    const verification = (0, nomba_webhook_security_1.verifyNombaWebhookSignature)(req);
    const rawBody = req.body;
    const rawBodyHash = hashRawBody(rawBody);
    const rawBodyText = rawBodyToString(rawBody);
    let payload;
    try {
        payload = JSON.parse(rawBodyText);
    }
    catch {
        throw new errors_1.ApiError(400, "Webhook payload must be valid JSON", [], "INVALID_WEBHOOK_JSON");
    }
    const nombaEvent = extractNombaEventBasics(payload);
    const providerEventId = getProviderEventIdHeader(req.headers) ?? nombaEvent.requestId;
    const eventType = nombaEvent.eventType;
    const mode = getNombaWebhookMode();
    logNombaWebhookDebug({
        mode,
        providerEventId,
        eventType,
        rawBodyHash,
        payload,
    });
    try {
        const event = await prisma_1.prisma.webhookEvent.create({
            data: {
                provider: "nomba",
                mode,
                providerEventId,
                eventType,
                rawBody: rawBodyText,
                rawBodyHash,
                payload: payload,
                headers: sanitizeHeaders(req.headers),
                signature: verification.signature,
                providerSentAt: verification.timestamp,
                status: "RECEIVED",
            },
        });
        await (0, nomba_webhook_processor_1.processNombaWebhookEvent)({
            eventId: event.id,
            mode,
            eventType,
            payload,
        });
        (0, responses_1.sendSuccess)(res, 200, "Webhook accepted", {
            received: true,
            duplicate: false,
            eventId: event.id,
            providerEventId: event.providerEventId,
            eventType: event.eventType,
        });
    }
    catch (error) {
        if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002") {
            const existingEvent = await prisma_1.prisma.webhookEvent.findUnique({
                where: {
                    provider_mode_providerEventId: {
                        provider: "nomba",
                        mode,
                        providerEventId,
                    },
                },
            });
            (0, responses_1.sendSuccess)(res, 200, "Duplicate webhook ignored", {
                received: true,
                duplicate: true,
                eventId: existingEvent?.id,
                providerEventId,
                eventType: existingEvent?.eventType ?? eventType,
            });
            return;
        }
        throw error;
    }
}));
