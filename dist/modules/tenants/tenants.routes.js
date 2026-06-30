"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tenantsRouter = void 0;
const express_1 = require("express");
const api_keys_1 = require("../../lib/api-keys");
const async_handler_1 = require("../../lib/async-handler");
const audit_1 = require("../../lib/audit");
const errors_1 = require("../../lib/errors");
const prisma_1 = require("../../lib/prisma");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const tenants_schema_1 = require("./tenants.schema");
exports.tenantsRouter = (0, express_1.Router)();
exports.tenantsRouter.post("/", (0, validate_middleware_1.validate)({ body: tenants_schema_1.createTenantSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const existingTenant = await prisma_1.prisma.tenant.findUnique({
        where: { email: req.body.email },
    });
    if (existingTenant) {
        throw new errors_1.ApiError(409, "Tenant with this email already exists");
    }
    const apiKey = (0, api_keys_1.generateApiKey)();
    const verification = (0, api_keys_1.generateVerificationToken)();
    const name = req.body.type === "BUSINESS" ? req.body.businessName : req.body.legalName;
    const tenant = await prisma_1.prisma.tenant.create({
        data: {
            type: req.body.type,
            name,
            email: req.body.email,
            status: "PENDING_VERIFICATION",
            verificationTokenHash: verification.hash,
            verificationSentAt: new Date(),
            businessName: req.body.type === "BUSINESS" ? req.body.businessName : undefined,
            businessRegistrationNumber: req.body.type === "BUSINESS"
                ? req.body.businessRegistrationNumber
                : undefined,
            taxId: req.body.type === "BUSINESS" ? req.body.taxId : undefined,
            website: req.body.type === "BUSINESS" ? req.body.website : undefined,
            legalName: req.body.type === "INDIVIDUAL" ? req.body.legalName : undefined,
            contactName: req.body.contactName,
            contactPhone: req.body.contactPhone,
            country: req.body.country,
            apiKeys: {
                create: {
                    name: req.body.apiKeyName,
                    prefix: apiKey.prefix,
                    keyHash: apiKey.hash,
                },
            },
        },
    });
    await (0, audit_1.writeAuditLog)({
        tenantId: tenant.id,
        action: "tenant.created",
        entity: "tenant",
        entityId: tenant.id,
        metadata: { type: tenant.type, status: tenant.status },
    });
    res.status(201).json({
        tenant,
        apiKey: apiKey.key,
        verificationToken: verification.token,
        verificationUrl: `/api/v1/tenants/verify-email`,
        warning: "Store this API key now. Recurr only stores its hash. In production, the verification token is emailed instead of returned.",
    });
}));
exports.tenantsRouter.post("/verify-email", (0, validate_middleware_1.validate)({ body: tenants_schema_1.verifyTenantEmailSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const tenant = await prisma_1.prisma.tenant.findUnique({
        where: { email: req.body.email },
    });
    if (!tenant) {
        throw new errors_1.ApiError(404, "Tenant not found");
    }
    if (tenant.emailVerifiedAt && tenant.status === "ACTIVE") {
        res.status(200).json({
            tenant,
            verified: true,
        });
        return;
    }
    if (!tenant.verificationTokenHash) {
        throw new errors_1.ApiError(400, "No verification token is active for this tenant");
    }
    if ((0, api_keys_1.hashApiKey)(req.body.token) !== tenant.verificationTokenHash) {
        throw new errors_1.ApiError(400, "Invalid verification token");
    }
    const verifiedTenant = await prisma_1.prisma.tenant.update({
        where: { id: tenant.id },
        data: {
            status: "ACTIVE",
            emailVerifiedAt: new Date(),
            verificationTokenHash: null,
        },
    });
    await (0, audit_1.writeAuditLog)({
        tenantId: verifiedTenant.id,
        action: "tenant.email_verified",
        entity: "tenant",
        entityId: verifiedTenant.id,
    });
    res.status(200).json({
        tenant: verifiedTenant,
        verified: true,
    });
}));
