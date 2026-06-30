"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.businessApiKeyMiddleware = businessApiKeyMiddleware;
const api_keys_1 = require("../lib/api-keys");
const errors_1 = require("../lib/errors");
const prisma_1 = require("../lib/prisma");
async function businessApiKeyMiddleware(req, _res, next) {
    try {
        const token = (0, api_keys_1.extractBearerToken)(req.header("authorization"));
        if (!token) {
            throw new errors_1.ApiError(401, "Missing bearer API key");
        }
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
        await prisma_1.prisma.apiKey.update({
            where: { id: apiKey.id },
            data: { lastUsedAt: new Date() },
        });
        next();
    }
    catch (error) {
        next(error);
    }
}
