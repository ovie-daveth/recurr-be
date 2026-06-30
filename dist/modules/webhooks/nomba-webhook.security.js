"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyNombaWebhookSignature = verifyNombaWebhookSignature;
const crypto_1 = __importDefault(require("crypto"));
const errors_1 = require("../../lib/errors");
function getHeader(req, name) {
    const value = req.header(name);
    return Array.isArray(value) ? value[0] : value;
}
function getWebhookSecret() {
    const value = process.env.NOMBA_WEBHOOK_SECRET || process.env.NOMBA_WEBHOOK_SIGNING_KEY;
    if (!value) {
        throw new errors_1.ApiError(500, "NOMBA_WEBHOOK_SECRET is required", [], "WEBHOOK_CONFIG_ERROR");
    }
    return value;
}
function getToleranceSeconds() {
    const value = Number(process.env.NOMBA_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS);
    return Number.isInteger(value) && value > 0 ? value : 300;
}
function parseWebhookTimestamp(value) {
    if (/^\d+$/.test(value)) {
        const numeric = Number(value);
        const milliseconds = value.length >= 13 ? numeric : numeric * 1000;
        return new Date(milliseconds);
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new errors_1.ApiError(401, "Invalid webhook timestamp", [], "INVALID_WEBHOOK_TIMESTAMP");
    }
    return parsed;
}
function normalizeSignature(value) {
    const trimmed = value.trim();
    const parts = trimmed.split(",");
    const preferredPart = parts.find((part) => part.startsWith("v1=")) ?? parts[0];
    const signature = preferredPart.includes("=")
        ? preferredPart.slice(preferredPart.indexOf("=") + 1)
        : preferredPart;
    return signature.trim();
}
function timingSafeStringEqual(left, right) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }
    return crypto_1.default.timingSafeEqual(leftBuffer, rightBuffer);
}
function createSignatures(secret, timestamp, rawBody) {
    const payloads = [
        rawBody,
        Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]),
        Buffer.concat([Buffer.from(timestamp), rawBody]),
    ];
    return payloads.flatMap((payload) => {
        const digest = crypto_1.default.createHmac("sha256", secret).update(payload).digest();
        return [digest.toString("hex"), digest.toString("base64")];
    });
}
function verifyNombaWebhookSignature(req) {
    const rawBody = req.body;
    if (!Buffer.isBuffer(rawBody)) {
        throw new errors_1.ApiError(400, "Webhook raw body is required", [], "WEBHOOK_RAW_BODY_REQUIRED");
    }
    const signatureHeader = process.env.NOMBA_WEBHOOK_SIGNATURE_HEADER || "nomba-signature";
    const timestampHeader = process.env.NOMBA_WEBHOOK_TIMESTAMP_HEADER || "x-nomba-timestamp";
    const signature = getHeader(req, signatureHeader);
    const timestamp = getHeader(req, timestampHeader);
    if (!signature) {
        throw new errors_1.ApiError(401, "Missing webhook signature", [], "MISSING_WEBHOOK_SIGNATURE");
    }
    if (process.env.NOMBA_WEBHOOK_REQUIRE_TIMESTAMP === "true" && !timestamp) {
        throw new errors_1.ApiError(401, "Missing webhook timestamp", [], "MISSING_WEBHOOK_TIMESTAMP");
    }
    let timestampDate;
    if (timestamp) {
        timestampDate = parseWebhookTimestamp(timestamp);
        const ageSeconds = Math.abs(Date.now() - timestampDate.getTime()) / 1000;
        if (ageSeconds > getToleranceSeconds()) {
            throw new errors_1.ApiError(401, "Webhook timestamp is outside tolerance", [], "WEBHOOK_TIMESTAMP_EXPIRED");
        }
    }
    const secret = getWebhookSecret();
    const receivedSignature = normalizeSignature(signature);
    const expectedSignatures = timestamp
        ? createSignatures(secret, timestamp, rawBody)
        : [
            crypto_1.default.createHmac("sha256", secret).update(rawBody).digest("hex"),
            crypto_1.default.createHmac("sha256", secret).update(rawBody).digest("base64"),
        ];
    const signatureIsValid = expectedSignatures.some((expected) => timingSafeStringEqual(expected, receivedSignature));
    if (!signatureIsValid) {
        throw new errors_1.ApiError(401, "Invalid webhook signature", [], "INVALID_WEBHOOK_SIGNATURE");
    }
    return {
        signature: receivedSignature,
        timestamp: timestampDate,
    };
}
