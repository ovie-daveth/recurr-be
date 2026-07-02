"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.businessesRouter = void 0;
const express_1 = require("express");
const async_handler_1 = require("../../lib/async-handler");
const audit_1 = require("../../lib/audit");
const errors_1 = require("../../lib/errors");
const pagination_1 = require("../../lib/pagination");
const prisma_1 = require("../../lib/prisma");
const responses_1 = require("../../lib/responses");
const merchant_session_middleware_1 = require("../../middlewares/merchant-session.middleware");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const api_keys_routes_1 = require("../api-keys/api-keys.routes");
const webhook_endpoints_routes_1 = require("../webhook-endpoints/webhook-endpoints.routes");
const businesses_schema_1 = require("./businesses.schema");
exports.businessesRouter = (0, express_1.Router)();
exports.businessesRouter.use(merchant_session_middleware_1.merchantSessionMiddleware);
exports.businessesRouter.post("/", (0, validate_middleware_1.validate)({ body: businesses_schema_1.createBusinessSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const name = req.body.type === "BUSINESS" ? req.body.businessName : req.body.legalName;
    const business = await prisma_1.prisma.business.create({
        data: {
            ownerUserId: user.id,
            type: req.body.type,
            name,
            status: "ACTIVE",
            businessName: req.body.type === "BUSINESS" ? req.body.businessName : undefined,
            businessRegistrationNumber: req.body.type === "BUSINESS"
                ? req.body.businessRegistrationNumber
                : undefined,
            taxId: req.body.type === "BUSINESS" ? req.body.taxId : undefined,
            website: req.body.type === "BUSINESS" ? req.body.website : undefined,
            legalName: req.body.type === "INDIVIDUAL" ? req.body.legalName : undefined,
            contactName: req.body.contactName,
            contactEmail: req.body.contactEmail,
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
    await (0, audit_1.writeAuditLog)({
        businessId: business.id,
        action: "business.created",
        entity: "business",
        entityId: business.id,
        metadata: { ownerUserId: user.id },
    });
    (0, responses_1.sendSuccess)(res, 201, "Business created", { business });
}));
exports.businessesRouter.get("/", (0, validate_middleware_1.validate)({ query: businesses_schema_1.listBusinessesQuerySchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const query = req.validatedQuery;
    const businesses = await prisma_1.prisma.business.findMany({
        where: {
            ...(query.status ? { status: query.status } : {}),
            ...((0, pagination_1.dateRangeFilter)(query) ? { createdAt: (0, pagination_1.dateRangeFilter)(query) } : {}),
            members: {
                some: { userId: user.id },
            },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...(0, pagination_1.paginationArgs)(query),
    });
    const page = (0, pagination_1.paginateResults)(businesses, query.limit);
    (0, responses_1.sendSuccess)(res, 200, "Businesses returned", {
        businesses: page.data,
        pagination: page.pagination,
    });
}));
exports.businessesRouter.get("/:businessId", (0, validate_middleware_1.validate)({ params: businesses_schema_1.businessIdParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const business = await prisma_1.prisma.business.findFirst({
        where: {
            id: String(req.params.businessId),
            members: {
                some: { userId: user.id },
            },
        },
    });
    if (!business) {
        throw new errors_1.ApiError(404, "Business not found");
    }
    (0, responses_1.sendSuccess)(res, 200, "Business returned", { business });
}));
exports.businessesRouter.patch("/:businessId", (0, validate_middleware_1.validate)({ params: businesses_schema_1.businessIdParamsSchema, body: businesses_schema_1.updateBusinessSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const businessId = String(req.params.businessId);
    if (Object.keys(req.body).length === 0) {
        throw new errors_1.ApiError(400, "At least one field is required", [], "EMPTY_UPDATE");
    }
    const membership = await prisma_1.prisma.businessMember.findFirst({
        where: {
            businessId,
            userId: user.id,
            role: { in: ["OWNER", "ADMIN"] },
        },
        include: { business: true },
    });
    if (!membership) {
        throw new errors_1.ApiError(404, "Business not found", [], "BUSINESS_NOT_FOUND");
    }
    const nextType = req.body.type ?? membership.business.type;
    const name = nextType === "BUSINESS"
        ? req.body.businessName
        : nextType === "INDIVIDUAL"
            ? req.body.legalName
            : undefined;
    if (nextType === "BUSINESS" && !req.body.businessName && req.body.type) {
        throw new errors_1.ApiError(400, "businessName is required when changing type to BUSINESS", [], "BUSINESS_NAME_REQUIRED");
    }
    if (nextType === "INDIVIDUAL" && !req.body.legalName && req.body.type) {
        throw new errors_1.ApiError(400, "legalName is required when changing type to INDIVIDUAL", [], "LEGAL_NAME_REQUIRED");
    }
    const business = await prisma_1.prisma.business.update({
        where: { id: businessId },
        data: {
            ...req.body,
            name,
        },
    });
    await (0, audit_1.writeAuditLog)({
        businessId,
        action: "business.updated",
        entity: "business",
        entityId: businessId,
        metadata: { userId: user.id },
    });
    (0, responses_1.sendSuccess)(res, 200, "Business updated", { business });
}));
exports.businessesRouter.use("/:businessId/api-keys", api_keys_routes_1.apiKeysRouter);
exports.businessesRouter.use("/:businessId/webhook-endpoints", webhook_endpoints_routes_1.webhookEndpointsRouter);
