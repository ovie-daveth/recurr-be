"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tenantsRouter = void 0;
const express_1 = require("express");
const api_keys_1 = require("../../lib/api-keys");
const async_handler_1 = require("../../lib/async-handler");
const audit_1 = require("../../lib/audit");
const errors_1 = require("../../lib/errors");
const passwords_1 = require("../../lib/passwords");
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
    const existingMerchantUser = await prisma_1.prisma.merchantUser.findUnique({
        where: { email: req.body.email },
    });
    if (existingMerchantUser) {
        throw new errors_1.ApiError(409, "Merchant user with this email already exists");
    }
    const verification = (0, api_keys_1.generateVerificationToken)();
    const passwordHash = await (0, passwords_1.hashPassword)(req.body.ownerPassword);
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
            users: {
                create: {
                    email: req.body.email,
                    name: req.body.contactName,
                    passwordHash,
                    role: "OWNER",
                    status: "PENDING_VERIFICATION",
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
    await (0, audit_1.writeAuditLog)({
        tenantId: tenant.id,
        action: "merchant_user.created",
        entity: "merchant_user",
        metadata: { email: req.body.email, role: "OWNER" },
    });
    res.status(201).json({
        tenant,
        verificationToken: verification.token,
        verificationUrl: `/api/v1/tenants/verify-email`,
        warning: "Tenant is pending email verification. In production, the verification token is emailed instead of returned. The first API key is issued only after verification.",
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
            apiKey: null,
            warning: "Tenant is already verified. Existing API keys cannot be revealed again.",
        });
        return;
    }
    if (!tenant.verificationTokenHash) {
        throw new errors_1.ApiError(400, "No verification token is active for this tenant");
    }
    if ((0, api_keys_1.hashApiKey)(req.body.token) !== tenant.verificationTokenHash) {
        throw new errors_1.ApiError(400, "Invalid verification token");
    }
    const generatedApiKey = (0, api_keys_1.generateApiKey)();
    const result = await prisma_1.prisma.$transaction(async (tx) => {
        const verifiedTenant = await tx.tenant.update({
            where: { id: tenant.id },
            data: {
                status: "ACTIVE",
                emailVerifiedAt: new Date(),
                verificationTokenHash: null,
                users: {
                    updateMany: {
                        where: {
                            email: tenant.email,
                            role: "OWNER",
                            status: "PENDING_VERIFICATION",
                        },
                        data: {
                            status: "ACTIVE",
                            emailVerifiedAt: new Date(),
                        },
                    },
                },
            },
        });
        const apiKey = await tx.apiKey.create({
            data: {
                tenantId: tenant.id,
                name: req.body.apiKeyName,
                prefix: generatedApiKey.prefix,
                keyHash: generatedApiKey.hash,
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
        return { verifiedTenant, apiKey };
    });
    await (0, audit_1.writeAuditLog)({
        tenantId: result.verifiedTenant.id,
        action: "tenant.email_verified",
        entity: "tenant",
        entityId: result.verifiedTenant.id,
    });
    await (0, audit_1.writeAuditLog)({
        tenantId: result.verifiedTenant.id,
        action: "api_key.created",
        entity: "api_key",
        entityId: result.apiKey.id,
        metadata: { name: result.apiKey.name, reason: "email_verification" },
    });
    res.status(200).json({
        tenant: result.verifiedTenant,
        verified: true,
        apiKey: result.apiKey,
        secret: generatedApiKey.key,
        warning: "Store this API key now. Recurr only stores its hash.",
    });
}));
