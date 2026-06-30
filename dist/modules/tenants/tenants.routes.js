"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tenantsRouter = void 0;
const express_1 = require("express");
const api_keys_js_1 = require("../../lib/api-keys.js");
const async_handler_js_1 = require("../../lib/async-handler.js");
const audit_js_1 = require("../../lib/audit.js");
const errors_js_1 = require("../../lib/errors.js");
const prisma_js_1 = require("../../lib/prisma.js");
const validate_middleware_js_1 = require("../../middlewares/validate.middleware.js");
const tenants_schema_js_1 = require("./tenants.schema.js");
exports.tenantsRouter = (0, express_1.Router)();
exports.tenantsRouter.post("/", (0, validate_middleware_js_1.validate)({ body: tenants_schema_js_1.createTenantSchema }), (0, async_handler_js_1.asyncHandler)(async (req, res) => {
    const existingTenant = await prisma_js_1.prisma.tenant.findUnique({
        where: { email: req.body.email },
    });
    if (existingTenant) {
        throw new errors_js_1.ApiError(409, "Tenant with this email already exists");
    }
    const apiKey = (0, api_keys_js_1.generateApiKey)();
    const tenant = await prisma_js_1.prisma.tenant.create({
        data: {
            name: req.body.name,
            email: req.body.email,
            apiKeys: {
                create: {
                    name: req.body.apiKeyName,
                    prefix: apiKey.prefix,
                    keyHash: apiKey.hash,
                },
            },
        },
    });
    await (0, audit_js_1.writeAuditLog)({
        tenantId: tenant.id,
        action: "tenant.created",
        entity: "tenant",
        entityId: tenant.id,
    });
    res.status(201).json({
        tenant,
        apiKey: apiKey.key,
        warning: "Store this API key now. Recurr only stores its hash.",
    });
}));
