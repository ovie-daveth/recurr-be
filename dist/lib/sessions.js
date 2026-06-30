"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMerchantAccessTokenTtlSeconds = getMerchantAccessTokenTtlSeconds;
exports.getMerchantRefreshTokenTtlDays = getMerchantRefreshTokenTtlDays;
exports.createMerchantSessionToken = createMerchantSessionToken;
exports.generateMerchantRefreshToken = generateMerchantRefreshToken;
exports.hashMerchantRefreshToken = hashMerchantRefreshToken;
exports.getMerchantRefreshTokenExpiryDate = getMerchantRefreshTokenExpiryDate;
exports.verifyMerchantSessionToken = verifyMerchantSessionToken;
const crypto_1 = __importDefault(require("crypto"));
const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 60 * 15;
const DEFAULT_REFRESH_TOKEN_TTL_DAYS = 30;
function parsePositiveInt(value, fallback) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function getMerchantAccessTokenTtlSeconds() {
    return parsePositiveInt(process.env.MERCHANT_ACCESS_TOKEN_TTL_SECONDS, DEFAULT_ACCESS_TOKEN_TTL_SECONDS);
}
function getMerchantRefreshTokenTtlDays() {
    return parsePositiveInt(process.env.MERCHANT_REFRESH_TOKEN_TTL_DAYS, DEFAULT_REFRESH_TOKEN_TTL_DAYS);
}
function getSessionSecret() {
    const secret = process.env.MERCHANT_SESSION_SECRET || process.env.JWT_SECRET;
    if (!secret) {
        throw new Error("MERCHANT_SESSION_SECRET or JWT_SECRET is required");
    }
    return secret;
}
function base64UrlEncode(value) {
    return Buffer.from(value).toString("base64url");
}
function base64UrlJson(value) {
    return base64UrlEncode(JSON.stringify(value));
}
function createMerchantSessionToken(input) {
    const header = { alg: "HS256", typ: "JWT" };
    const payload = {
        sub: input.userId,
        sid: input.sessionId,
        exp: Math.floor(Date.now() / 1000) + getMerchantAccessTokenTtlSeconds(),
        typ: "merchant_access",
    };
    const unsignedToken = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
    const signature = crypto_1.default
        .createHmac("sha256", getSessionSecret())
        .update(unsignedToken)
        .digest("base64url");
    return `${unsignedToken}.${signature}`;
}
function generateMerchantRefreshToken() {
    return `mrt_${crypto_1.default.randomBytes(48).toString("base64url")}`;
}
function hashMerchantRefreshToken(token) {
    return crypto_1.default.createHash("sha256").update(token).digest("hex");
}
function getMerchantRefreshTokenExpiryDate() {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + getMerchantRefreshTokenTtlDays());
    return expiresAt;
}
function verifyMerchantSessionToken(token) {
    const [encodedHeader, encodedPayload, signature] = token.split(".");
    if (!encodedHeader || !encodedPayload || !signature) {
        throw new Error("Invalid session token");
    }
    const unsignedToken = `${encodedHeader}.${encodedPayload}`;
    const expectedSignature = crypto_1.default
        .createHmac("sha256", getSessionSecret())
        .update(unsignedToken)
        .digest("base64url");
    const expectedBuffer = Buffer.from(expectedSignature);
    const actualBuffer = Buffer.from(signature);
    if (expectedBuffer.length !== actualBuffer.length ||
        !crypto_1.default.timingSafeEqual(expectedBuffer, actualBuffer)) {
        throw new Error("Invalid session token");
    }
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (payload.exp < Math.floor(Date.now() / 1000)) {
        throw new Error("Session token expired");
    }
    if (!payload.sub || !payload.sid || payload.typ !== "merchant_access") {
        throw new Error("Invalid session token");
    }
    return payload;
}
