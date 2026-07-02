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
const responses_1 = require("../../lib/responses");
const sessions_1 = require("../../lib/sessions");
const mailer_1 = require("../../lib/mailer");
const merchant_session_middleware_1 = require("../../middlewares/merchant-session.middleware");
const rate_limit_middleware_1 = require("../../middlewares/rate-limit.middleware");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const merchant_auth_schema_1 = require("./merchant-auth.schema");
exports.merchantAuthRouter = (0, express_1.Router)();
function getRequestIp(req) {
    return req.ip || req.socket.remoteAddress;
}
function getPasswordResetTokenTtlMinutes() {
    const parsed = Number(process.env.MERCHANT_PASSWORD_RESET_TOKEN_TTL_MINUTES);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 30;
}
function getPasswordResetExpiryDate() {
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + getPasswordResetTokenTtlMinutes());
    return expiresAt;
}
async function createTrackedMerchantSession(input) {
    const refreshToken = (0, sessions_1.generateMerchantRefreshToken)();
    const refreshTokenHash = (0, sessions_1.hashMerchantRefreshToken)(refreshToken);
    const refreshTokenExpiresAt = (0, sessions_1.getMerchantRefreshTokenExpiryDate)();
    const session = await prisma_1.prisma.merchantSession.create({
        data: {
            userId: input.userId,
            refreshTokenHash,
            userAgent: input.userAgent,
            ipAddress: input.ipAddress,
            expiresAt: refreshTokenExpiresAt,
            rotatedFromSessionId: input.rotatedFromSessionId,
        },
    });
    const accessToken = (0, sessions_1.createMerchantSessionToken)({
        userId: input.userId,
        sessionId: session.id,
    });
    return {
        accessToken,
        token: accessToken,
        tokenType: "Bearer",
        expiresIn: (0, sessions_1.getMerchantAccessTokenTtlSeconds)(),
        refreshToken,
        refreshTokenExpiresAt,
        refreshTokenTtlDays: (0, sessions_1.getMerchantRefreshTokenTtlDays)(),
        session: {
            id: session.id,
            userAgent: session.userAgent,
            ipAddress: session.ipAddress,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
        },
    };
}
async function verifyMerchantEmail(email, token, req) {
    const user = await prisma_1.prisma.merchantUser.findUnique({
        where: { email },
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
    if ((0, api_keys_1.hashApiKey)(token) !== user.verificationTokenHash) {
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
    const auth = await createTrackedMerchantSession({
        userId: result.activeUser.id,
        userAgent: req.header("user-agent"),
        ipAddress: getRequestIp(req),
    });
    return {
        ...auth,
    };
}
exports.merchantAuthRouter.post("/signup", rate_limit_middleware_1.merchantSignupRateLimit, (0, validate_middleware_1.validate)({ body: merchant_auth_schema_1.merchantSignupSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const existingUser = await prisma_1.prisma.merchantUser.findUnique({
        where: { email: req.body.email },
    });
    if (existingUser) {
        throw new errors_1.ApiError(409, "Merchant user with this email already exists");
    }
    const verification = (0, api_keys_1.generateVerificationToken)();
    const passwordHash = await (0, passwords_1.hashPassword)(req.body.password);
    const merchantName = req.body.type === "BUSINESS" ? req.body.name : req.body.legalName;
    const businessName = req.body.type === "BUSINESS"
        ? req.body.businessName
        : req.body.displayName ?? req.body.legalName;
    const contactName = req.body.type === "BUSINESS" ? req.body.contactName : req.body.legalName;
    const result = await prisma_1.prisma.$transaction(async (tx) => {
        const user = await tx.merchantUser.create({
            data: {
                email: req.body.email,
                name: merchantName,
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
                contactName,
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
    const verificationUrl = (0, mailer_1.buildMerchantVerificationUrl)(result.user.email, verification.token);
    (0, responses_1.sendSuccess)(res, 201, "Merchant signup created. Verify email to continue.", {
        emailVerificationSent: false,
        verificationUrl,
        verificationToken: verification.token,
        warning: "Testing mode: email delivery is disabled and the verification token is returned in the API response.",
    });
}));
exports.merchantAuthRouter.get("/verify-email", (0, validate_middleware_1.validate)({ query: merchant_auth_schema_1.merchantVerifyEmailSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const query = req.validatedQuery;
    const result = await verifyMerchantEmail(query.email, query.token, req);
    (0, responses_1.sendSuccess)(res, 200, "Merchant email verified", result);
}));
exports.merchantAuthRouter.post("/verify-email", (0, validate_middleware_1.validate)({ body: merchant_auth_schema_1.merchantVerifyEmailSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const result = await verifyMerchantEmail(req.body.email, req.body.token, req);
    (0, responses_1.sendSuccess)(res, 200, "Merchant email verified", result);
}));
exports.merchantAuthRouter.post("/login", (0, validate_middleware_1.validate)({ body: merchant_auth_schema_1.merchantLoginSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = await prisma_1.prisma.merchantUser.findUnique({
        where: { email: req.body.email },
    });
    if (!user) {
        throw new errors_1.ApiError(401, "Invalid email or password", [], "INVALID_CREDENTIALS");
    }
    if (user.status !== "ACTIVE") {
        throw new errors_1.ApiError(403, "Merchant account is not active", [], "MERCHANT_ACCOUNT_INACTIVE");
    }
    const passwordIsValid = await (0, passwords_1.verifyPassword)(req.body.password, user.passwordHash);
    if (!passwordIsValid) {
        throw new errors_1.ApiError(401, "Invalid email or password", [], "INVALID_CREDENTIALS");
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
    const auth = await createTrackedMerchantSession({
        userId: user.id,
        userAgent: req.header("user-agent"),
        ipAddress: getRequestIp(req),
    });
    (0, responses_1.sendSuccess)(res, 200, "Merchant logged in", {
        ...auth,
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
exports.merchantAuthRouter.post("/forgot-password", (0, validate_middleware_1.validate)({ body: merchant_auth_schema_1.merchantForgotPasswordSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = await prisma_1.prisma.merchantUser.findUnique({
        where: { email: req.body.email },
    });
    if (user && user.status !== "DISABLED") {
        const reset = (0, api_keys_1.generateVerificationToken)();
        const expiresAt = getPasswordResetExpiryDate();
        await prisma_1.prisma.$transaction(async (tx) => {
            await tx.merchantPasswordResetToken.updateMany({
                where: {
                    userId: user.id,
                    usedAt: null,
                    expiresAt: { gt: new Date() },
                },
                data: { usedAt: new Date() },
            });
            await tx.merchantPasswordResetToken.create({
                data: {
                    userId: user.id,
                    tokenHash: reset.hash,
                    expiresAt,
                },
            });
        });
        const resetUrl = (0, mailer_1.buildMerchantPasswordResetUrl)(user.email, reset.token);
        (0, responses_1.sendSuccess)(res, 200, "Password reset token created", {
            message: "Testing mode: email delivery is disabled and the reset token is returned in the API response.",
            resetEmailSent: false,
            resetUrl,
            resetToken: reset.token,
            expiresAt,
        });
        return;
    }
    (0, responses_1.sendSuccess)(res, 200, "Password reset link sent if account exists", {
        message: "If a merchant account exists for this email, a password reset link has been sent.",
    });
}));
exports.merchantAuthRouter.post("/reset-password", (0, validate_middleware_1.validate)({ body: merchant_auth_schema_1.merchantResetPasswordSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = await prisma_1.prisma.merchantUser.findUnique({
        where: { email: req.body.email },
    });
    if (!user) {
        throw new errors_1.ApiError(400, "Invalid or expired password reset token");
    }
    const resetTokenHash = (0, api_keys_1.hashApiKey)(req.body.token);
    const resetToken = await prisma_1.prisma.merchantPasswordResetToken.findUnique({
        where: { tokenHash: resetTokenHash },
    });
    if (!resetToken ||
        resetToken.userId !== user.id ||
        resetToken.usedAt ||
        resetToken.expiresAt <= new Date()) {
        throw new errors_1.ApiError(400, "Invalid or expired password reset token");
    }
    const passwordHash = await (0, passwords_1.hashPassword)(req.body.password);
    await prisma_1.prisma.$transaction(async (tx) => {
        await tx.merchantPasswordResetToken.update({
            where: { id: resetToken.id },
            data: { usedAt: new Date() },
        });
        await tx.merchantUser.update({
            where: { id: user.id },
            data: { passwordHash },
        });
        await tx.merchantSession.updateMany({
            where: {
                userId: user.id,
                revokedAt: null,
            },
            data: { revokedAt: new Date() },
        });
    });
    const businesses = await prisma_1.prisma.business.findMany({
        where: {
            members: {
                some: { userId: user.id },
            },
        },
        select: { id: true },
    });
    for (const business of businesses) {
        await (0, audit_1.writeAuditLog)({
            businessId: business.id,
            action: "merchant_user.password_reset",
            entity: "merchant_user",
            entityId: user.id,
            metadata: { email: user.email },
        });
    }
    (0, responses_1.sendSuccess)(res, 200, "Password reset successfully", {
        message: "Password reset successfully. Please log in again.",
    });
}));
exports.merchantAuthRouter.post("/refresh", (0, validate_middleware_1.validate)({ body: merchant_auth_schema_1.merchantRefreshSessionSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const refreshTokenHash = (0, sessions_1.hashMerchantRefreshToken)(req.body.refreshToken);
    const existingSession = await prisma_1.prisma.merchantSession.findUnique({
        where: { refreshTokenHash },
        include: { user: true },
    });
    if (!existingSession ||
        existingSession.revokedAt ||
        existingSession.expiresAt <= new Date() ||
        existingSession.user.status !== "ACTIVE") {
        throw new errors_1.ApiError(401, "Invalid refresh token", [], "INVALID_REFRESH_TOKEN");
    }
    await prisma_1.prisma.merchantSession.update({
        where: { id: existingSession.id },
        data: {
            revokedAt: new Date(),
            lastUsedAt: new Date(),
        },
    });
    const auth = await createTrackedMerchantSession({
        userId: existingSession.userId,
        userAgent: req.header("user-agent") || existingSession.userAgent || undefined,
        ipAddress: getRequestIp(req) || existingSession.ipAddress || undefined,
        rotatedFromSessionId: existingSession.id,
    });
    (0, responses_1.sendSuccess)(res, 200, "Merchant session refreshed", {
        ...auth,
        user: {
            id: existingSession.user.id,
            email: existingSession.user.email,
            name: existingSession.user.name,
            status: existingSession.user.status,
        },
    });
}));
exports.merchantAuthRouter.post("/logout", merchant_session_middleware_1.merchantSessionMiddleware, (0, validate_middleware_1.validate)({ body: merchant_auth_schema_1.merchantLogoutSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const sessionIds = new Set();
    if (req.merchantSession) {
        sessionIds.add(req.merchantSession.id);
    }
    if (req.body.refreshToken) {
        const refreshTokenHash = (0, sessions_1.hashMerchantRefreshToken)(req.body.refreshToken);
        const refreshSession = await prisma_1.prisma.merchantSession.findUnique({
            where: { refreshTokenHash },
        });
        if (refreshSession && refreshSession.userId === req.merchantUser?.id) {
            sessionIds.add(refreshSession.id);
        }
    }
    await prisma_1.prisma.merchantSession.updateMany({
        where: {
            id: { in: Array.from(sessionIds) },
            revokedAt: null,
        },
        data: { revokedAt: new Date() },
    });
    (0, responses_1.sendSuccess)(res, 200, "Merchant logged out", { loggedOut: true });
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
    (0, responses_1.sendSuccess)(res, 200, "Merchant user returned", {
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
exports.merchantAuthRouter.patch("/me", merchant_session_middleware_1.merchantSessionMiddleware, (0, validate_middleware_1.validate)({ body: merchant_auth_schema_1.updateMerchantProfileSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    if (Object.keys(req.body).length === 0) {
        throw new errors_1.ApiError(400, "At least one field is required", [], "EMPTY_UPDATE");
    }
    const updatedUser = await prisma_1.prisma.merchantUser.update({
        where: { id: user.id },
        data: {
            name: req.body.name,
        },
    });
    const businesses = await prisma_1.prisma.business.findMany({
        where: {
            members: {
                some: { userId: user.id },
            },
        },
        select: { id: true },
    });
    for (const business of businesses) {
        await (0, audit_1.writeAuditLog)({
            businessId: business.id,
            action: "merchant_user.updated",
            entity: "merchant_user",
            entityId: user.id,
            metadata: { fields: Object.keys(req.body) },
        });
    }
    (0, responses_1.sendSuccess)(res, 200, "Merchant profile updated", {
        user: {
            id: updatedUser.id,
            email: updatedUser.email,
            name: updatedUser.name,
            status: updatedUser.status,
            lastLoginAt: updatedUser.lastLoginAt,
        },
    });
}));
