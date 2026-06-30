"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiKeysRouter = void 0;
const express_1 = require("express");
const api_keys_1 = require("../../lib/api-keys");
const async_handler_1 = require("../../lib/async-handler");
const audit_1 = require("../../lib/audit");
const errors_1 = require("../../lib/errors");
const prisma_1 = require("../../lib/prisma");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const api_keys_schema_1 = require("./api-keys.schema");
exports.apiKeysRouter = (0, express_1.Router)({ mergeParams: true });
async function requireKeyManagementAccess(businessId, userId) {
    const membership = await prisma_1.prisma.businessMember.findFirst({
        where: {
            businessId,
            userId,
            role: { in: ["OWNER", "ADMIN", "DEVELOPER"] },
        },
    });
    if (!membership) {
        throw new errors_1.ApiError(404, "Business not found");
    }
}
exports.apiKeysRouter.get("/", (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const businessId = String(req.params.businessId);
    await requireKeyManagementAccess(businessId, user.id);
    const apiKeys = await prisma_1.prisma.apiKey.findMany({
        where: { businessId },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            name: true,
            mode: true,
            prefix: true,
            expiresAt: true,
            lastUsedAt: true,
            revokedAt: true,
            createdAt: true,
        },
    });
    res.status(200).json({ apiKeys });
}));
exports.apiKeysRouter.post("/", (0, validate_middleware_1.validate)({ body: api_keys_schema_1.createApiKeySchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const businessId = String(req.params.businessId);
    await requireKeyManagementAccess(businessId, user.id);
    const generated = (0, api_keys_1.generateApiKey)(req.body.mode);
    const apiKey = await prisma_1.prisma.apiKey.create({
        data: {
            businessId,
            name: req.body.name,
            mode: req.body.mode,
            prefix: generated.prefix,
            keyHash: generated.hash,
            expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : undefined,
        },
        select: {
            id: true,
            name: true,
            mode: true,
            prefix: true,
            expiresAt: true,
            lastUsedAt: true,
            revokedAt: true,
            createdAt: true,
        },
    });
    await (0, audit_1.writeAuditLog)({
        businessId,
        action: "api_key.created",
        entity: "api_key",
        entityId: apiKey.id,
        metadata: { name: apiKey.name, mode: apiKey.mode, userId: user.id },
    });
    res.status(201).json({
        apiKey,
        secret: generated.key,
        warning: "Store this API key now. Recurr only stores its hash.",
    });
}));
exports.apiKeysRouter.post("/:id/revoke", (0, validate_middleware_1.validate)({ params: api_keys_schema_1.apiKeyIdParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const businessId = String(req.params.businessId);
    const id = String(req.params.id);
    await requireKeyManagementAccess(businessId, user.id);
    const existingApiKey = await prisma_1.prisma.apiKey.findFirst({
        where: { id, businessId },
    });
    if (!existingApiKey) {
        throw new errors_1.ApiError(404, "API key not found");
    }
    const apiKey = await prisma_1.prisma.apiKey.update({
        where: { id },
        data: { revokedAt: existingApiKey.revokedAt ?? new Date() },
        select: {
            id: true,
            name: true,
            mode: true,
            prefix: true,
            expiresAt: true,
            lastUsedAt: true,
            revokedAt: true,
            createdAt: true,
        },
    });
    await (0, audit_1.writeAuditLog)({
        businessId,
        action: "api_key.revoked",
        entity: "api_key",
        entityId: apiKey.id,
        metadata: { name: apiKey.name, mode: apiKey.mode, userId: user.id },
    });
    res.status(200).json({ apiKey });
}));
