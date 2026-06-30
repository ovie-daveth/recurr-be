"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.businessesRouter = void 0;
const express_1 = require("express");
const async_handler_1 = require("../../lib/async-handler");
const audit_1 = require("../../lib/audit");
const errors_1 = require("../../lib/errors");
const prisma_1 = require("../../lib/prisma");
const merchant_session_middleware_1 = require("../../middlewares/merchant-session.middleware");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const api_keys_routes_1 = require("../api-keys/api-keys.routes");
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
    res.status(201).json({ business });
}));
exports.businessesRouter.get("/", (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const businesses = await prisma_1.prisma.business.findMany({
        where: {
            members: {
                some: { userId: user.id },
            },
        },
        orderBy: { createdAt: "asc" },
    });
    res.status(200).json({ businesses });
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
    res.status(200).json({ business });
}));
exports.businessesRouter.patch("/:businessId", (0, validate_middleware_1.validate)({ params: businesses_schema_1.businessIdParamsSchema, body: businesses_schema_1.updateBusinessSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const businessId = String(req.params.businessId);
    const membership = await prisma_1.prisma.businessMember.findFirst({
        where: {
            businessId,
            userId: user.id,
            role: { in: ["OWNER", "ADMIN"] },
        },
    });
    if (!membership) {
        throw new errors_1.ApiError(404, "Business not found");
    }
    const name = req.body.type === "BUSINESS"
        ? req.body.businessName
        : req.body.type === "INDIVIDUAL"
            ? req.body.legalName
            : undefined;
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
    res.status(200).json({ business });
}));
exports.businessesRouter.use("/:businessId/api-keys", api_keys_routes_1.apiKeysRouter);
