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
function getHeaderAny(req, names) {
    for (const name of names) {
        const value = getHeader(req, name);
        if (value?.trim()) {
            return { name, value: value.trim() };
        }
    }
    return { name: names[0], value: undefined };
}
function normalizeSecret(value) {
    const trimmed = value.trim();
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        return trimmed.slice(1, -1).trim();
    }
    return trimmed;
}
function getWebhookSecrets() {
    const values = [
        process.env.NOMBA_WEBHOOK_SECRET,
        process.env.NOMBA_WEBHOOK_SIGNING_KEY,
    ]
        .filter((value) => Boolean(value?.trim()))
        .map(normalizeSecret);
    const uniqueValues = [...new Set(values)];
    if (!uniqueValues.length) {
        throw new errors_1.ApiError(500, "NOMBA_WEBHOOK_SECRET is required", [], "WEBHOOK_CONFIG_ERROR");
    }
    return uniqueValues;
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
    const knownPrefix = /^(?:v1|sha256|hmac-sha256|hmacsha256)=/i.exec(preferredPart);
    const signature = knownPrefix
        ? preferredPart.slice(knownPrefix[0].length)
        : preferredPart;
    const normalized = signature.trim();
    return /^[a-f0-9]+$/i.test(normalized) ? normalized.toLowerCase() : normalized;
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
        return [digest.toString("hex").toLowerCase(), digest.toString("base64")];
    });
}
function createNombaRawBodySignatures(secret, rawBody) {
    const digest = crypto_1.default.createHmac("sha256", secret).update(rawBody).digest();
    return [digest.toString("hex").toLowerCase(), digest.toString("base64")];
}
function getRecord(value) {
    return value && typeof value === "object"
        ? value
        : undefined;
}
function getString(value) {
    if (typeof value === "string") {
        return value;
    }
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    return "";
}
function createNombaCanonicalString(rawBody, timestamp) {
    let payload;
    try {
        payload = JSON.parse(rawBody.toString("utf8"));
    }
    catch {
        return null;
    }
    const record = getRecord(payload);
    const data = getRecord(record?.data);
    const merchant = getRecord(data?.merchant);
    const transaction = getRecord(data?.transaction);
    if (!record || !data || !merchant || !transaction) {
        return null;
    }
    return [
        getString(record.event_type ?? record.event),
        getString(record.requestId),
        getString(merchant.userId),
        getString(merchant.walletId),
        getString(transaction.transactionId),
        getString(transaction.type),
        getString(transaction.time),
        getString(transaction.responseCode),
        timestamp,
    ].join(":");
}
function createNombaCanonicalSignatures(secret, rawBody, timestamp) {
    const canonicalString = createNombaCanonicalString(rawBody, timestamp);
    if (!canonicalString) {
        return [];
    }
    const digest = crypto_1.default
        .createHmac("sha256", secret)
        .update(canonicalString)
        .digest();
    return [digest.toString("base64"), digest.toString("hex").toLowerCase()];
}
function verifyNombaWebhookSignature(req) {
    const rawBody = req.body;
    if (!Buffer.isBuffer(rawBody)) {
        throw new errors_1.ApiError(400, "Webhook raw body is required", [], "WEBHOOK_RAW_BODY_REQUIRED");
    }
    const configuredSignatureHeader = process.env.NOMBA_WEBHOOK_SIGNATURE_HEADER || "nomba-signature";
    const configuredTimestampHeader = process.env.NOMBA_WEBHOOK_TIMESTAMP_HEADER || "nomba-timestamp";
    const signatureHeader = getHeaderAny(req, [
        configuredSignatureHeader,
        "nomba-signature",
    ]);
    const timestampHeader = getHeaderAny(req, [
        configuredTimestampHeader,
        "nomba-timestamp",
        "x-nomba-timestamp",
    ]);
    const signature = signatureHeader.value;
    const timestamp = timestampHeader.value;
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
    const secrets = getWebhookSecrets();
    const receivedSignature = normalizeSignature(signature);
    const expectedSignatures = secrets.flatMap((secret) => timestamp
        ? [
            ...createNombaCanonicalSignatures(secret, rawBody, timestamp),
            ...createSignatures(secret, timestamp, rawBody),
        ]
        : createNombaRawBodySignatures(secret, rawBody));
    const signatureIsValid = expectedSignatures.some((expected) => timingSafeStringEqual(expected, receivedSignature));
    if (!signatureIsValid) {
        console.warn("Invalid Nomba webhook signature", {
            signatureHeader: signatureHeader.name,
            timestampHeader: timestamp ? timestampHeader.name : null,
            receivedSignatureLength: receivedSignature.length,
            rawBodyBytes: rawBody.length,
            configuredSecretCount: secrets.length,
            expectedSignatureFormats: timestamp
                ? ["nomba-canonical-base64", "timestamp.raw-body", "raw-body"]
                : ["raw-body"],
            rawBodySha256: crypto_1.default.createHash("sha256").update(rawBody).digest("hex"),
        });
        throw new errors_1.ApiError(401, "Invalid webhook signature", [], "INVALID_WEBHOOK_SIGNATURE");
    }
    return {
        signature: receivedSignature,
        timestamp: timestampDate,
    };
}
