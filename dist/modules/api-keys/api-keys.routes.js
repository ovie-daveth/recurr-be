"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiKeysRouter = void 0;
const express_1 = require("express");
const api_keys_1 = require("../../lib/api-keys");
const async_handler_1 = require("../../lib/async-handler");
const audit_1 = require("../../lib/audit");
const errors_1 = require("../../lib/errors");
const prisma_1 = require("../../lib/prisma");
const tenant_middleware_1 = require("../../middlewares/tenant.middleware");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const api_keys_schema_1 = require("./api-keys.schema");
exports.apiKeysRouter = (0, express_1.Router)();
exports.apiKeysRouter.use(tenant_middleware_1.tenantMiddleware);
exports.apiKeysRouter.get("/", (0, async_handler_1.asyncHandler)(async (req, res) => {
    const tenant = (0, errors_1.requireTenant)(req);
    const apiKeys = await prisma_1.prisma.apiKey.findMany({
        where: { tenantId: tenant.id },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            name: true,
            prefix: true,
            lastUsedAt: true,
            revokedAt: true,
            createdAt: true,
        },
    });
    res.status(200).json({ apiKeys });
}));
exports.apiKeysRouter.post("/", (0, validate_middleware_1.validate)({ body: api_keys_schema_1.createApiKeySchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const tenant = (0, errors_1.requireTenant)(req);
    const generated = (0, api_keys_1.generateApiKey)();
    const apiKey = await prisma_1.prisma.apiKey.create({
        data: {
            tenantId: tenant.id,
            name: req.body.name,
            prefix: generated.prefix,
            keyHash: generated.hash,
        },
        select: {
            id: true,
            name: true,
            prefix: true,
            lastUsedAt: true,
            revokedAt: true,
            createdAt: true,
        },
    });
    await (0, audit_1.writeAuditLog)({
        tenantId: tenant.id,
        action: "api_key.created",
        entity: "api_key",
        entityId: apiKey.id,
        metadata: { name: apiKey.name },
    });
    res.status(201).json({
        apiKey,
        secret: generated.key,
        warning: "Store this API key now. Recurr only stores its hash.",
    });
}));
exports.apiKeysRouter.post("/:id/revoke", (0, validate_middleware_1.validate)({ params: api_keys_schema_1.apiKeyIdParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const tenant = (0, errors_1.requireTenant)(req);
    const id = String(req.params.id);
    if (req.apiKey?.id === id) {
        throw new errors_1.ApiError(400, "Create and switch to a replacement API key before revoking the key used by this request");
    }
    const existingApiKey = await prisma_1.prisma.apiKey.findFirst({
        where: {
            id,
            tenantId: tenant.id,
        },
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
            prefix: true,
            lastUsedAt: true,
            revokedAt: true,
            createdAt: true,
        },
    });
    await (0, audit_1.writeAuditLog)({
        tenantId: tenant.id,
        action: "api_key.revoked",
        entity: "api_key",
        entityId: apiKey.id,
        metadata: { name: apiKey.name },
    });
    res.status(200).json({ apiKey });
}));
