"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.businessResourceAuthMiddleware = businessResourceAuthMiddleware;
const api_keys_1 = require("../lib/api-keys");
const errors_1 = require("../lib/errors");
const prisma_1 = require("../lib/prisma");
const sessions_1 = require("../lib/sessions");
function isMode(value) {
    return value === "TEST" || value === "LIVE";
}
function readString(value) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function readDashboardContext(req) {
    const businessId = readString(req.query.businessId) ??
        readString(req.body?.businessId);
    const mode = readString(req.query.mode) ?? readString(req.body?.mode);
    if (!businessId) {
        throw new errors_1.ApiError(400, "businessId is required for dashboard access", [], "BUSINESS_ID_REQUIRED");
    }
    if (!isMode(mode)) {
        throw new errors_1.ApiError(400, "mode must be TEST or LIVE for dashboard access", [], "MODE_REQUIRED");
    }
    return { businessId, mode };
}
async function authenticateWithApiKey(token, req) {
    const apiKey = await prisma_1.prisma.apiKey.findUnique({
        where: { keyHash: (0, api_keys_1.hashApiKey)(token) },
        include: { business: true },
    });
    if (!apiKey || apiKey.revokedAt) {
        throw new errors_1.ApiError(401, "Invalid API key");
    }
    if (apiKey.expiresAt && apiKey.expiresAt <= new Date()) {
        throw new errors_1.ApiError(401, "API key has expired");
    }
    if (apiKey.business.status !== "ACTIVE") {
        throw new errors_1.ApiError(403, "Business is not active");
    }
    req.business = apiKey.business;
    req.apiKey = {
        id: apiKey.id,
        businessId: apiKey.businessId,
        name: apiKey.name,
        mode: apiKey.mode,
        prefix: apiKey.prefix,
        keyHash: apiKey.keyHash,
        lastUsedAt: apiKey.lastUsedAt,
        revokedAt: apiKey.revokedAt,
        expiresAt: apiKey.expiresAt,
        createdAt: apiKey.createdAt,
    };
    req.businessMode = apiKey.mode;
    await prisma_1.prisma.apiKey.update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() },
    });
}
async function authenticateWithMerchantSession(token, req) {
    const payload = (0, sessions_1.verifyMerchantSessionToken)(token);
    const session = await prisma_1.prisma.merchantSession.findUnique({
        where: { id: payload.sid },
        include: { user: true },
    });
    if (!session ||
        session.userId !== payload.sub ||
        session.revokedAt ||
        session.expiresAt <= new Date() ||
        session.user.status !== "ACTIVE") {
        throw new errors_1.ApiError(401, "Invalid merchant session");
    }
    const { businessId, mode } = readDashboardContext(req);
    const business = await prisma_1.prisma.business.findFirst({
        where: {
            id: businessId,
            status: "ACTIVE",
            members: {
                some: {
                    userId: session.userId,
                    role: { in: ["OWNER", "ADMIN", "DEVELOPER"] },
                },
            },
        },
    });
    if (!business) {
        throw new errors_1.ApiError(404, "Business not found", [], "BUSINESS_NOT_FOUND");
    }
    await prisma_1.prisma.merchantSession.update({
        where: { id: session.id },
        data: { lastUsedAt: new Date() },
    });
    req.business = business;
    req.businessMode = mode;
    req.merchantSession = session;
    req.merchantUser = session.user;
}
async function businessResourceAuthMiddleware(req, _res, next) {
    try {
        const token = (0, api_keys_1.extractBearerToken)(req.header("authorization"));
        if (!token) {
            throw new errors_1.ApiError(401, "Missing bearer token");
        }
        if (token.startsWith("sk_test_") || token.startsWith("sk_live_")) {
            await authenticateWithApiKey(token, req);
        }
        else {
            await authenticateWithMerchantSession(token, req);
        }
        next();
    }
    catch (error) {
        next(error instanceof errors_1.ApiError ? error : new errors_1.ApiError(401, "Invalid business resource auth"));
    }
}
