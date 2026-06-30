"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateApiKey = generateApiKey;
exports.hashApiKey = hashApiKey;
exports.generateVerificationToken = generateVerificationToken;
exports.extractBearerToken = extractBearerToken;
const crypto_1 = __importDefault(require("crypto"));
function generateApiKey(mode = "TEST") {
    const prefix = mode === "LIVE"
        ? process.env.LIVE_API_KEY_PREFIX || "sk_live"
        : process.env.API_KEY_PREFIX || "sk_test";
    const secret = crypto_1.default.randomBytes(32).toString("base64url");
    const key = `${prefix}_${secret}`;
    return {
        key,
        prefix,
        hash: hashApiKey(key),
    };
}
function hashApiKey(key) {
    return crypto_1.default.createHash("sha256").update(key).digest("hex");
}
function generateVerificationToken() {
    const token = crypto_1.default.randomBytes(24).toString("base64url");
    return {
        token,
        hash: hashApiKey(token),
    };
}
function extractBearerToken(header) {
    if (!header) {
        return null;
    }
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) {
        return null;
    }
    return token;
}
