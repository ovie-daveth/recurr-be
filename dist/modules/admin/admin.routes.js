"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminRouter = void 0;
const express_1 = require("express");
const async_handler_1 = require("../../lib/async-handler");
const errors_1 = require("../../lib/errors");
const pagination_1 = require("../../lib/pagination");
const prisma_1 = require("../../lib/prisma");
const responses_1 = require("../../lib/responses");
const merchant_session_middleware_1 = require("../../middlewares/merchant-session.middleware");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const mailer_1 = require("../../lib/mailer");
const admin_schema_1 = require("./admin.schema");
exports.adminRouter = (0, express_1.Router)();
exports.adminRouter.use(merchant_session_middleware_1.merchantSessionMiddleware);
exports.adminRouter.use((0, async_handler_1.asyncHandler)(async (req, _res, next) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const admin = await prisma_1.prisma.merchantUser.findUnique({
        where: { id: user.id },
        select: { isPlatformAdmin: true },
    });
    if (!admin?.isPlatformAdmin) {
        throw new errors_1.ApiError(403, "Platform administrator access is required");
    }
    next();
}));
const merchantSummarySelect = {
    id: true,
    email: true,
    name: true,
    status: true,
    isPlatformAdmin: true,
    deletedAt: true,
    emailVerifiedAt: true,
    lastLoginAt: true,
    createdAt: true,
    updatedAt: true,
    ownedBusinesses: {
        select: {
            id: true,
            name: true,
            status: true,
            type: true,
            createdAt: true,
        },
        orderBy: { createdAt: "asc" },
    },
};
async function findTargetMerchant(merchantId) {
    const merchant = await prisma_1.prisma.merchantUser.findUnique({
        where: { id: merchantId },
        select: {
            id: true,
            email: true,
            name: true,
            status: true,
            isPlatformAdmin: true,
            deletedAt: true,
            ownedBusinesses: {
                select: { id: true },
            },
        },
    });
    if (!merchant) {
        throw new errors_1.ApiError(404, "Merchant not found");
    }
    if (merchant.isPlatformAdmin) {
        throw new errors_1.ApiError(409, "Platform administrator accounts cannot be changed here");
    }
    if (merchant.deletedAt) {
        throw new errors_1.ApiError(409, "Deleted merchants cannot be changed");
    }
    return merchant;
}
async function recordAdminAction(input) {
    await prisma_1.prisma.adminActionLog.create({
        data: {
            actorUserId: input.actorUserId,
            targetUserId: input.targetUserId,
            action: input.action,
            entityId: input.entityId,
            details: input.details,
        },
    });
}
exports.adminRouter.get("/merchants", (0, validate_middleware_1.validate)({ query: admin_schema_1.listMerchantsQuerySchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const query = req.validatedQuery;
    const search = query.search;
    const merchants = await prisma_1.prisma.merchantUser.findMany({
        where: {
            ...(query.status === "DELETED"
                ? { deletedAt: { not: null } }
                : {
                    deletedAt: null,
                    ...(query.status ? { status: query.status } : {}),
                }),
            ...(search
                ? {
                    OR: [
                        { email: { contains: search, mode: "insensitive" } },
                        { name: { contains: search, mode: "insensitive" } },
                        {
                            ownedBusinesses: {
                                some: { name: { contains: search, mode: "insensitive" } },
                            },
                        },
                    ],
                }
                : {}),
        },
        select: merchantSummarySelect,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...(0, pagination_1.paginationArgs)(query),
    });
    const page = (0, pagination_1.paginateResults)(merchants, query.limit);
    (0, responses_1.sendSuccess)(res, 200, "Merchants returned", {
        merchants: page.data,
        pagination: page.pagination,
    });
}));
exports.adminRouter.get("/merchants/:merchantId", (0, validate_middleware_1.validate)({ params: admin_schema_1.merchantIdParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const merchant = await prisma_1.prisma.merchantUser.findUnique({
        where: { id: String(req.params.merchantId) },
        select: {
            ...merchantSummarySelect,
            memberships: {
                select: {
                    role: true,
                    business: {
                        select: {
                            id: true,
                            name: true,
                            status: true,
                            type: true,
                        },
                    },
                },
            },
            sessions: {
                select: {
                    id: true,
                    userAgent: true,
                    ipAddress: true,
                    lastUsedAt: true,
                    expiresAt: true,
                    revokedAt: true,
                    createdAt: true,
                },
                orderBy: { createdAt: "desc" },
                take: 20,
            },
            _count: {
                select: {
                    passwordResetTokens: true,
                    adminActionsPerformed: true,
                    adminActionsReceived: true,
                },
            },
        },
    });
    if (!merchant) {
        throw new errors_1.ApiError(404, "Merchant not found");
    }
    const businessIds = merchant.ownedBusinesses.map((business) => business.id);
    const apiKeys = await prisma_1.prisma.apiKey.findMany({
        where: { businessId: { in: businessIds } },
        select: {
            id: true,
            businessId: true,
            name: true,
            mode: true,
            prefix: true,
            lastUsedAt: true,
            revokedAt: true,
            expiresAt: true,
            createdAt: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    (0, responses_1.sendSuccess)(res, 200, "Merchant returned", { merchant, apiKeys });
}));
exports.adminRouter.post("/merchants/:merchantId/suspend", (0, validate_middleware_1.validate)({ params: admin_schema_1.merchantIdParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const actor = (0, errors_1.requireMerchantUser)(req);
    const merchant = await findTargetMerchant(String(req.params.merchantId));
    const now = new Date();
    await prisma_1.prisma.$transaction(async (tx) => {
        await tx.merchantUser.update({
            where: { id: merchant.id },
            data: { status: "DISABLED" },
        });
        await tx.business.updateMany({
            where: { ownerUserId: merchant.id },
            data: { status: "SUSPENDED" },
        });
        await tx.merchantSession.updateMany({
            where: { userId: merchant.id, revokedAt: null },
            data: { revokedAt: now },
        });
        await tx.merchantPasswordResetToken.updateMany({
            where: { userId: merchant.id, usedAt: null },
            data: { usedAt: now },
        });
        await tx.adminActionLog.create({
            data: {
                actorUserId: actor.id,
                targetUserId: merchant.id,
                action: "merchant.suspended",
                details: { affectedBusinessCount: merchant.ownedBusinesses.length },
            },
        });
    });
    (0, responses_1.sendSuccess)(res, 200, "Merchant suspended", {
        merchantId: merchant.id,
        status: "DISABLED",
        affectedBusinessCount: merchant.ownedBusinesses.length,
    });
}));
exports.adminRouter.post("/merchants/:merchantId/delete", (0, validate_middleware_1.validate)({ params: admin_schema_1.merchantIdParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const actor = (0, errors_1.requireMerchantUser)(req);
    const merchant = await findTargetMerchant(String(req.params.merchantId));
    const now = new Date();
    await prisma_1.prisma.$transaction(async (tx) => {
        await tx.merchantUser.update({
            where: { id: merchant.id },
            data: { status: "DISABLED", deletedAt: now },
        });
        await tx.business.updateMany({
            where: { ownerUserId: merchant.id },
            data: { status: "SUSPENDED" },
        });
        await tx.merchantSession.updateMany({
            where: { userId: merchant.id, revokedAt: null },
            data: { revokedAt: now },
        });
        await tx.apiKey.updateMany({
            where: {
                revokedAt: null,
                business: { ownerUserId: merchant.id },
            },
            data: { revokedAt: now },
        });
        await tx.merchantPasswordResetToken.updateMany({
            where: { userId: merchant.id, usedAt: null },
            data: { usedAt: now },
        });
        await tx.adminActionLog.create({
            data: {
                actorUserId: actor.id,
                targetUserId: merchant.id,
                action: "merchant.soft_deleted",
                details: { affectedBusinessCount: merchant.ownedBusinesses.length },
            },
        });
    });
    (0, responses_1.sendSuccess)(res, 200, "Merchant soft-deleted; records were retained", {
        merchantId: merchant.id,
        deletedAt: now,
        affectedBusinessCount: merchant.ownedBusinesses.length,
    });
}));
exports.adminRouter.post("/merchants/:merchantId/businesses/:businessId/api-keys/:apiKeyId/revoke", (0, validate_middleware_1.validate)({ params: admin_schema_1.merchantApiKeyParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const actor = (0, errors_1.requireMerchantUser)(req);
    const merchant = await findTargetMerchant(String(req.params.merchantId));
    const apiKey = await prisma_1.prisma.apiKey.findFirst({
        where: {
            id: String(req.params.apiKeyId),
            businessId: String(req.params.businessId),
            business: { ownerUserId: merchant.id },
        },
        select: {
            id: true,
            businessId: true,
            name: true,
            mode: true,
            prefix: true,
            revokedAt: true,
        },
    });
    if (!apiKey) {
        throw new errors_1.ApiError(404, "Merchant API key not found");
    }
    const updatedApiKey = await prisma_1.prisma.$transaction(async (tx) => {
        const revokedAt = apiKey.revokedAt ?? new Date();
        const updated = await tx.apiKey.update({
            where: { id: apiKey.id },
            data: { revokedAt },
            select: {
                id: true,
                businessId: true,
                name: true,
                mode: true,
                prefix: true,
                revokedAt: true,
            },
        });
        await tx.adminActionLog.create({
            data: {
                actorUserId: actor.id,
                targetUserId: merchant.id,
                action: "merchant.api_key_revoked",
                entityId: apiKey.id,
                details: { businessId: apiKey.businessId, mode: apiKey.mode },
            },
        });
        return updated;
    });
    (0, responses_1.sendSuccess)(res, 200, "Merchant API key revoked", { apiKey: updatedApiKey });
}));
exports.adminRouter.post("/merchants/:merchantId/email", (0, validate_middleware_1.validate)({ params: admin_schema_1.merchantIdParamsSchema, body: admin_schema_1.adminEmailSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const actor = (0, errors_1.requireMerchantUser)(req);
    const merchant = await findTargetMerchant(String(req.params.merchantId));
    await (0, mailer_1.sendAdminMessage)({
        to: merchant.email,
        merchantName: merchant.name,
        subject: req.body.subject,
        message: req.body.message,
    });
    await recordAdminAction({
        actorUserId: actor.id,
        targetUserId: merchant.id,
        action: "merchant.email_sent",
        details: { subject: req.body.subject },
    });
    (0, responses_1.sendSuccess)(res, 200, "Email sent to merchant", {
        merchantId: merchant.id,
        recipient: merchant.email,
        sent: true,
    });
}));
