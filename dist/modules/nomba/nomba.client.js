"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nombaClient = exports.NombaClient = void 0;
const errors_1 = require("../../lib/errors");
let cachedToken = null;
function shouldDebugNomba() {
    return process.env.NOMBA_DEBUG === "true";
}
function redactSensitive(value) {
    if (Array.isArray(value)) {
        return value.map((item) => redactSensitive(item));
    }
    if (!value || typeof value !== "object") {
        return value;
    }
    const sensitiveKeys = new Set([
        "authorization",
        "access_token",
        "accessToken",
        "refresh_token",
        "refreshToken",
        "token",
        "client_secret",
        "clientSecret",
        "secret",
        "signature",
    ]);
    return Object.fromEntries(Object.entries(value).map(([key, entryValue]) => [
        key,
        sensitiveKeys.has(key) || sensitiveKeys.has(key.toLowerCase())
            ? "[REDACTED]"
            : redactSensitive(entryValue),
    ]));
}
function logNombaDebug(label, data) {
    if (!shouldDebugNomba()) {
        return;
    }
    console.log(`[NOMBA_DEBUG] ${label}`, JSON.stringify(redactSensitive(data), null, 2));
}
function nombaBaseUrl() {
    return (process.env.NOMBA_BASE_URL || "https://sandbox.nomba.com").replace(/\/+$/, "");
}
function apiPath(path) {
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    const base = nombaBaseUrl();
    if (base.endsWith("/v1") ||
        cleanPath.startsWith("/v1/") ||
        cleanPath.startsWith("/sandbox/")) {
        return cleanPath;
    }
    return `/v1${cleanPath}`;
}
function buildUrl(path) {
    return `${nombaBaseUrl()}${apiPath(path)}`;
}
function requiredEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new errors_1.ApiError(500, `${name} is required for Nomba API calls`, [{ env: name }], "NOMBA_CONFIGURATION_REQUIRED");
    }
    return value;
}
function extractAccessToken(payload) {
    const data = payload && typeof payload === "object"
        ? payload.data
        : undefined;
    const record = data && typeof data === "object"
        ? data
        : payload;
    const token = record?.access_token ?? record?.accessToken ?? record?.token;
    if (typeof token !== "string" || !token.trim()) {
        return undefined;
    }
    return token.trim();
}
function extractExpiresInSeconds(payload) {
    const data = payload && typeof payload === "object"
        ? payload.data
        : undefined;
    const record = data && typeof data === "object"
        ? data
        : payload;
    const expiresIn = record?.expires_in ?? record?.expiresIn;
    if (typeof expiresIn === "number" && Number.isFinite(expiresIn)) {
        return expiresIn;
    }
    const expiresAt = record?.expiresAt ?? record?.expires_at;
    if (typeof expiresAt === "string") {
        const expiresAtMs = Date.parse(expiresAt);
        if (Number.isFinite(expiresAtMs)) {
            return Math.max(1, Math.floor((expiresAtMs - Date.now()) / 1000));
        }
    }
    return 3600;
}
async function parseNombaResponse(response) {
    const text = await response.text();
    if (!text) {
        return undefined;
    }
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}
class NombaClient {
    async issueToken() {
        const accountId = requiredEnv("NOMBA_ACCOUNT_ID");
        const payload = {
            grant_type: "client_credentials",
            client_id: requiredEnv("NOMBA_CLIENT_ID"),
            client_secret: requiredEnv("NOMBA_CLIENT_SECRET"),
        };
        const response = await fetch(buildUrl(process.env.NOMBA_TOKEN_ISSUE_PATH || "/auth/token/issue"), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                accountId,
            },
            body: JSON.stringify(payload),
        });
        const body = await parseNombaResponse(response);
        logNombaDebug("token.issue", {
            method: "POST",
            url: buildUrl(process.env.NOMBA_TOKEN_ISSUE_PATH || "/auth/token/issue"),
            requestBody: payload,
            responseStatus: response.status,
            responseBody: body,
        });
        if (!response.ok) {
            throw new errors_1.ApiError(502, "Nomba token issue request failed", [{ status: response.status, body }], "NOMBA_TOKEN_REQUEST_FAILED");
        }
        const accessToken = extractAccessToken(body);
        if (!accessToken) {
            throw new errors_1.ApiError(502, "Nomba token response did not include an access token", [{ body }], "NOMBA_TOKEN_RESPONSE_INVALID");
        }
        const expiresInSeconds = extractExpiresInSeconds(body);
        cachedToken = {
            accessToken,
            expiresAt: Date.now() + expiresInSeconds * 1000,
        };
        return cachedToken;
    }
    async getAccessToken() {
        const refreshWindowMs = Number(process.env.NOMBA_TOKEN_REFRESH_WINDOW_MS || 5 * 60 * 1000);
        if (cachedToken && cachedToken.expiresAt - Date.now() > refreshWindowMs) {
            return cachedToken.accessToken;
        }
        const token = await this.issueToken();
        return token.accessToken;
    }
    async request(path, options = {}) {
        const accountId = requiredEnv("NOMBA_ACCOUNT_ID");
        const authenticated = options.authenticated ?? true;
        const headers = {
            "Content-Type": "application/json",
            accountId,
        };
        if (authenticated) {
            headers.Authorization = `Bearer ${await this.getAccessToken()}`;
        }
        const url = buildUrl(path);
        logNombaDebug("request", {
            method: options.method ?? "GET",
            url,
            requestBody: options.body,
            authenticated,
        });
        const response = await fetch(url, {
            method: options.method ?? "GET",
            headers,
            ...(typeof options.body === "undefined"
                ? {}
                : { body: JSON.stringify(options.body) }),
        });
        const body = await parseNombaResponse(response);
        logNombaDebug("response", {
            method: options.method ?? "GET",
            url,
            responseStatus: response.status,
            responseBody: body,
        });
        if (!response.ok) {
            throw new errors_1.ApiError(502, "Nomba API request failed", [{ path, status: response.status, body }], "NOMBA_API_REQUEST_FAILED");
        }
        return body;
    }
}
exports.NombaClient = NombaClient;
exports.nombaClient = new NombaClient();
