"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.portalRouter = void 0;
const express_1 = require("express");
const api_keys_1 = require("../../lib/api-keys");
const async_handler_1 = require("../../lib/async-handler");
const audit_1 = require("../../lib/audit");
const errors_1 = require("../../lib/errors");
const pagination_1 = require("../../lib/pagination");
const prisma_1 = require("../../lib/prisma");
const responses_1 = require("../../lib/responses");
const business_api_key_middleware_1 = require("../../middlewares/business-api-key.middleware");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const portal_schema_1 = require("./portal.schema");
exports.portalRouter = (0, express_1.Router)();
function buildPortalUrl(token) {
    const baseUrl = process.env.PORTAL_BASE_URL ||
        process.env.FRONTEND_BASE_URL ||
        process.env.APP_BASE_URL ||
        "http://localhost:5173";
    const url = new URL(`/portal/session/${token}`, baseUrl);
    return url.toString();
}
function addMinutes(date, minutes) {
    const next = new Date(date);
    next.setMinutes(next.getMinutes() + minutes);
    return next;
}
function publicPaymentMethod(paymentMethod) {
    return {
        id: paymentMethod.id,
        type: paymentMethod.type,
        status: paymentMethod.status,
        provider: paymentMethod.provider,
        brand: paymentMethod.brand,
        last4: paymentMethod.last4,
        expMonth: paymentMethod.expMonth,
        expYear: paymentMethod.expYear,
        reusable: paymentMethod.reusable,
        createdAt: paymentMethod.createdAt,
        updatedAt: paymentMethod.updatedAt,
    };
}
exports.portalRouter.post("/sessions", business_api_key_middleware_1.businessApiKeyMiddleware, (0, validate_middleware_1.validate)({ body: portal_schema_1.createPortalSessionSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const apiKey = (0, errors_1.requireApiKey)(req);
    const customer = await prisma_1.prisma.customer.findFirst({
        where: {
            id: req.body.customerId,
            businessId: business.id,
            mode: apiKey.mode,
        },
    });
    if (!customer) {
        throw new errors_1.ApiError(404, "Customer not found");
    }
    if (customer.status !== "ACTIVE") {
        throw new errors_1.ApiError(409, "Customer is not active", [], "CUSTOMER_NOT_ACTIVE");
    }
    const generated = (0, api_keys_1.generateVerificationToken)();
    const expiresAt = addMinutes(new Date(), req.body.expiresInMinutes);
    const portalSession = await prisma_1.prisma.portalSession.create({
        data: {
            businessId: business.id,
            customerId: customer.id,
            mode: apiKey.mode,
            tokenHash: generated.hash,
            returnUrl: req.body.returnUrl,
            expiresAt,
            metadata: req.body.metadata,
        },
        select: {
            id: true,
            businessId: true,
            customerId: true,
            mode: true,
            status: true,
            returnUrl: true,
            expiresAt: true,
            usedAt: true,
            revokedAt: true,
            metadata: true,
            createdAt: true,
            updatedAt: true,
        },
    });
    await (0, audit_1.writeAuditLog)({
        businessId: business.id,
        action: "portal_session.created",
        entity: "portal_session",
        entityId: portalSession.id,
        metadata: {
            customerId: customer.id,
            mode: apiKey.mode,
        },
    });
    (0, responses_1.sendSuccess)(res, 201, "Portal session created", {
        portalSession,
        url: buildPortalUrl(generated.token),
        token: generated.token,
        warning: "Return the URL to the subscriber. The raw token is only returned once.",
    });
}));
exports.portalRouter.get("/sessions", business_api_key_middleware_1.businessApiKeyMiddleware, (0, validate_middleware_1.validate)({ query: portal_schema_1.listPortalSessionsQuerySchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const apiKey = (0, errors_1.requireApiKey)(req);
    const query = req.validatedQuery;
    const sessions = await prisma_1.prisma.portalSession.findMany({
        where: {
            businessId: business.id,
            mode: apiKey.mode,
            ...(query.status ? { status: query.status } : {}),
            ...(query.customerId ? { customerId: query.customerId } : {}),
            ...((0, pagination_1.dateRangeFilter)(query) ? { createdAt: (0, pagination_1.dateRangeFilter)(query) } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...(0, pagination_1.paginationArgs)(query),
        select: {
            id: true,
            businessId: true,
            customerId: true,
            mode: true,
            status: true,
            returnUrl: true,
            expiresAt: true,
            usedAt: true,
            revokedAt: true,
            metadata: true,
            createdAt: true,
            updatedAt: true,
        },
    });
    const page = (0, pagination_1.paginateResults)(sessions, query.limit);
    (0, responses_1.sendSuccess)(res, 200, "Portal sessions returned", {
        portalSessions: page.data,
        pagination: page.pagination,
    });
}));
exports.portalRouter.post("/sessions/:id/revoke", business_api_key_middleware_1.businessApiKeyMiddleware, (0, validate_middleware_1.validate)({ params: portal_schema_1.portalSessionIdParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const apiKey = (0, errors_1.requireApiKey)(req);
    const existing = await prisma_1.prisma.portalSession.findFirst({
        where: {
            id: String(req.params.id),
            businessId: business.id,
            mode: apiKey.mode,
        },
    });
    if (!existing) {
        throw new errors_1.ApiError(404, "Portal session not found");
    }
    const portalSession = await prisma_1.prisma.portalSession.update({
        where: { id: existing.id },
        data: {
            status: "REVOKED",
            revokedAt: existing.revokedAt ?? new Date(),
        },
    });
    await (0, audit_1.writeAuditLog)({
        businessId: business.id,
        action: "portal_session.revoked",
        entity: "portal_session",
        entityId: portalSession.id,
        metadata: { mode: apiKey.mode },
    });
    (0, responses_1.sendSuccess)(res, 200, "Portal session revoked", { portalSession });
}));
exports.portalRouter.get("/sessions/:token", (0, validate_middleware_1.validate)({ params: portal_schema_1.portalSessionTokenParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const tokenHash = (0, api_keys_1.hashApiKey)(String(req.params.token));
    const portalSession = await prisma_1.prisma.portalSession.findUnique({
        where: { tokenHash },
    });
    if (!portalSession) {
        throw new errors_1.ApiError(404, "Portal session not found");
    }
    if (portalSession.revokedAt || portalSession.status === "REVOKED") {
        throw new errors_1.ApiError(410, "Portal session has been revoked", [], "PORTAL_SESSION_REVOKED");
    }
    if (portalSession.expiresAt <= new Date()) {
        await prisma_1.prisma.portalSession.update({
            where: { id: portalSession.id },
            data: { status: "EXPIRED" },
        });
        throw new errors_1.ApiError(410, "Portal session has expired", [], "PORTAL_SESSION_EXPIRED");
    }
    if (!portalSession.usedAt) {
        await prisma_1.prisma.portalSession.update({
            where: { id: portalSession.id },
            data: { usedAt: new Date() },
        });
    }
    const [business, customer, subscriptions, invoices, paymentMethods] = await Promise.all([
        prisma_1.prisma.business.findUnique({
            where: { id: portalSession.businessId },
            select: {
                id: true,
                name: true,
                type: true,
                contactEmail: true,
                contactPhone: true,
                country: true,
            },
        }),
        prisma_1.prisma.customer.findFirst({
            where: {
                id: portalSession.customerId,
                businessId: portalSession.businessId,
                mode: portalSession.mode,
            },
            select: {
                id: true,
                email: true,
                name: true,
                phone: true,
                externalReference: true,
                status: true,
                createdAt: true,
                updatedAt: true,
            },
        }),
        prisma_1.prisma.subscription.findMany({
            where: {
                customerId: portalSession.customerId,
                businessId: portalSession.businessId,
                mode: portalSession.mode,
            },
            include: {
                plan: true,
                paymentMethod: true,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }),
        prisma_1.prisma.invoice.findMany({
            where: {
                customerId: portalSession.customerId,
                businessId: portalSession.businessId,
                mode: portalSession.mode,
            },
            include: {
                items: true,
                attempts: true,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 20,
        }),
        prisma_1.prisma.paymentMethod.findMany({
            where: {
                customerId: portalSession.customerId,
                businessId: portalSession.businessId,
                mode: portalSession.mode,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }),
    ]);
    (0, responses_1.sendSuccess)(res, 200, "Portal session returned", {
        portalSession: {
            id: portalSession.id,
            mode: portalSession.mode,
            status: portalSession.status,
            returnUrl: portalSession.returnUrl,
            expiresAt: portalSession.expiresAt,
        },
        business,
        customer,
        subscriptions: subscriptions.map((subscription) => ({
            ...subscription,
            paymentMethod: publicPaymentMethod(subscription.paymentMethod),
        })),
        invoices,
        paymentMethods: paymentMethods.map(publicPaymentMethod),
    });
}));
