"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tenantMiddleware = tenantMiddleware;
const api_keys_1 = require("../lib/api-keys");
const errors_1 = require("../lib/errors");
const prisma_1 = require("../lib/prisma");
async function tenantMiddleware(req, _res, next) {
    try {
        const token = (0, api_keys_1.extractBearerToken)(req.header("authorization"));
        if (!token) {
            throw new errors_1.ApiError(401, "Missing bearer API key");
        }
        const keyHash = (0, api_keys_1.hashApiKey)(token);
        const apiKey = await prisma_1.prisma.apiKey.findUnique({
            where: { keyHash },
            include: { tenant: true },
        });
        if (!apiKey || apiKey.revokedAt) {
            throw new errors_1.ApiError(401, "Invalid API key");
        }
        if (apiKey.tenant.status !== "ACTIVE") {
            throw new errors_1.ApiError(403, "Tenant is not active");
        }
        req.tenant = apiKey.tenant;
        req.apiKey = {
            id: apiKey.id,
            tenantId: apiKey.tenantId,
            name: apiKey.name,
            prefix: apiKey.prefix,
            keyHash: apiKey.keyHash,
            lastUsedAt: apiKey.lastUsedAt,
            revokedAt: apiKey.revokedAt,
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
