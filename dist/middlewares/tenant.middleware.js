"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tenantMiddleware = tenantMiddleware;
const api_keys_js_1 = require("../lib/api-keys.js");
const errors_js_1 = require("../lib/errors.js");
const prisma_js_1 = require("../lib/prisma.js");
async function tenantMiddleware(req, _res, next) {
    try {
        const token = (0, api_keys_js_1.extractBearerToken)(req.header("authorization"));
        if (!token) {
            throw new errors_js_1.ApiError(401, "Missing bearer API key");
        }
        const keyHash = (0, api_keys_js_1.hashApiKey)(token);
        const apiKey = await prisma_js_1.prisma.apiKey.findUnique({
            where: { keyHash },
            include: { tenant: true },
        });
        if (!apiKey || apiKey.revokedAt) {
            throw new errors_js_1.ApiError(401, "Invalid API key");
        }
        if (apiKey.tenant.status !== "ACTIVE") {
            throw new errors_js_1.ApiError(403, "Tenant is not active");
        }
        req.tenant = apiKey.tenant;
        await prisma_js_1.prisma.apiKey.update({
            where: { id: apiKey.id },
            data: { lastUsedAt: new Date() },
        });
        next();
    }
    catch (error) {
        next(error);
    }
}
