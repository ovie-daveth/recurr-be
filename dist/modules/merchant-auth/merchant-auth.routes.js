"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.merchantAuthRouter = void 0;
const express_1 = require("express");
const api_keys_1 = require("../../lib/api-keys");
const async_handler_1 = require("../../lib/async-handler");
const audit_1 = require("../../lib/audit");
const errors_1 = require("../../lib/errors");
const passwords_1 = require("../../lib/passwords");
const prisma_1 = require("../../lib/prisma");
const sessions_1 = require("../../lib/sessions");
const merchant_session_middleware_1 = require("../../middlewares/merchant-session.middleware");
const rate_limit_middleware_1 = require("../../middlewares/rate-limit.middleware");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const merchant_auth_schema_1 = require("./merchant-auth.schema");
exports.merchantAuthRouter = (0, express_1.Router)();
exports.merchantAuthRouter.post("/signup", rate_limit_middleware_1.merchantSignupRateLimit, (0, validate_middleware_1.validate)({ body: merchant_auth_schema_1.merchantSignupSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const existingUser = await prisma_1.prisma.merchantUser.findUnique({
        where: { email: req.body.email },
    });
    if (existingUser) {
        throw new errors_1.ApiError(409, "Merchant user with this email already exists");
    }
    const verification = (0, api_keys_1.generateVerificationToken)();
    const passwordHash = await (0, passwords_1.hashPassword)(req.body.password);
    const businessName = req.body.type === "BUSINESS" ? req.body.businessName : req.body.legalName;
    const result = await prisma_1.prisma.$transaction(async (tx) => {
        const user = await tx.merchantUser.create({
            data: {
                email: req.body.email,
                name: req.body.name,
                passwordHash,
                status: "PENDING_VERIFICATION",
                verificationTokenHash: verification.hash,
                verificationSentAt: new Date(),
            },
        });
        const business = await tx.business.create({
            data: {
                ownerUserId: user.id,
                type: req.body.type,
                name: businessName,
                status: "PENDING_VERIFICATION",
                businessName: req.body.type === "BUSINESS" ? req.body.businessName : undefined,
                businessRegistrationNumber: req.body.type === "BUSINESS"
                    ? req.body.businessRegistrationNumber
                    : undefined,
                taxId: req.body.type === "BUSINESS" ? req.body.taxId : undefined,
                website: req.body.type === "BUSINESS" ? req.body.website : undefined,
                legalName: req.body.type === "INDIVIDUAL" ? req.body.legalName : undefined,
                contactName: req.body.contactName,
                contactEmail: req.body.email,
                contactPhone: req.body.contactPhone,
                country: req.body.country,
                members: {
                    create: {
                        userId: user.id,
                        role: "OWNER",
                    },
                },
            },
        });
        return { user, business };
    });
    await (0, audit_1.writeAuditLog)({
        businessId: result.business.id,
        action: "merchant_user.signup",
        entity: "merchant_user",
        entityId: result.user.id,
        metadata: { email: result.user.email },
    });
    res.status(201).json({
        user: {
            id: result.user.id,
            email: result.user.email,
            name: result.user.name,
            status: result.user.status,
        },
        business: result.business,
        verificationToken: verification.token,
        verificationUrl: "/api/v1/merchants/verify-email",
        warning: "Merchant is pending email verification. In production, the verification token is emailed instead of returned.",
    });
}));
exports.merchantAuthRouter.post("/verify-email", (0, validate_middleware_1.validate)({ body: merchant_auth_schema_1.merchantVerifyEmailSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = await prisma_1.prisma.merchantUser.findUnique({
        where: { email: req.body.email },
    });
    if (!user) {
        throw new errors_1.ApiError(404, "Merchant user not found");
    }
    if (user.status === "ACTIVE" || user.emailVerifiedAt) {
        throw new errors_1.ApiError(400, "Merchant email is already verified");
    }
    if (!user.verificationTokenHash) {
        throw new errors_1.ApiError(400, "No verification token is active for this merchant");
    }
    if ((0, api_keys_1.hashApiKey)(req.body.token) !== user.verificationTokenHash) {
        throw new errors_1.ApiError(400, "Invalid verification token");
    }
    const result = await prisma_1.prisma.$transaction(async (tx) => {
        const activeUser = await tx.merchantUser.update({
            where: { id: user.id },
            data: {
                status: "ACTIVE",
                emailVerifiedAt: new Date(),
                verificationTokenHash: null,
            },
        });
        await tx.business.updateMany({
            where: {
                ownerUserId: user.id,
                status: "PENDING_VERIFICATION",
            },
            data: { status: "ACTIVE" },
        });
        const businesses = await tx.business.findMany({
            where: { ownerUserId: user.id },
            orderBy: { createdAt: "asc" },
        });
        return { activeUser, businesses };
    });
    for (const business of result.businesses) {
        await (0, audit_1.writeAuditLog)({
            businessId: business.id,
            action: "merchant_user.email_verified",
            entity: "merchant_user",
            entityId: result.activeUser.id,
        });
    }
    const token = (0, sessions_1.createMerchantSessionToken)({
        userId: result.activeUser.id,
    });
    res.status(200).json({
        token,
        tokenType: "Bearer",
        user: {
            id: result.activeUser.id,
            email: result.activeUser.email,
            name: result.activeUser.name,
            status: result.activeUser.status,
        },
        businesses: result.businesses,
    });
}));
exports.merchantAuthRouter.post("/login", (0, validate_middleware_1.validate)({ body: merchant_auth_schema_1.merchantLoginSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = await prisma_1.prisma.merchantUser.findUnique({
        where: { email: req.body.email },
    });
    if (!user) {
        throw new errors_1.ApiError(401, "Invalid email or password");
    }
    if (user.status !== "ACTIVE") {
        throw new errors_1.ApiError(403, "Merchant account is not active");
    }
    const passwordIsValid = await (0, passwords_1.verifyPassword)(req.body.password, user.passwordHash);
    if (!passwordIsValid) {
        throw new errors_1.ApiError(401, "Invalid email or password");
    }
    const updatedUser = await prisma_1.prisma.merchantUser.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
    });
    const businesses = await prisma_1.prisma.business.findMany({
        where: {
            members: {
                some: { userId: user.id },
            },
        },
        orderBy: { createdAt: "asc" },
    });
    for (const business of businesses) {
        await (0, audit_1.writeAuditLog)({
            businessId: business.id,
            action: "merchant_user.login",
            entity: "merchant_user",
            entityId: user.id,
            metadata: { email: user.email },
        });
    }
    const token = (0, sessions_1.createMerchantSessionToken)({
        userId: user.id,
    });
    res.status(200).json({
        token,
        tokenType: "Bearer",
        user: {
            id: updatedUser.id,
            email: updatedUser.email,
            name: updatedUser.name,
            status: updatedUser.status,
            lastLoginAt: updatedUser.lastLoginAt,
        },
        businesses,
    });
}));
exports.merchantAuthRouter.get("/me", merchant_session_middleware_1.merchantSessionMiddleware, (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const businesses = await prisma_1.prisma.business.findMany({
        where: {
            members: {
                some: { userId: user.id },
            },
        },
        orderBy: { createdAt: "asc" },
    });
    res.status(200).json({
        user: {
            id: user.id,
            email: user.email,
            name: user.name,
            status: user.status,
            lastLoginAt: user.lastLoginAt,
        },
        businesses,
    });
}));
