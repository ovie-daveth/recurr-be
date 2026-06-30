"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plansRouter = void 0;
const express_1 = require("express");
const async_handler_1 = require("../../lib/async-handler");
const audit_1 = require("../../lib/audit");
const errors_1 = require("../../lib/errors");
const prisma_1 = require("../../lib/prisma");
const business_api_key_middleware_1 = require("../../middlewares/business-api-key.middleware");
const idempotency_middleware_1 = require("../../middlewares/idempotency.middleware");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const plans_schema_1 = require("./plans.schema");
exports.plansRouter = (0, express_1.Router)();
exports.plansRouter.use(business_api_key_middleware_1.businessApiKeyMiddleware);
exports.plansRouter.post("/", (0, validate_middleware_1.validate)({ body: plans_schema_1.createPlanSchema }), idempotency_middleware_1.idempotencyMiddleware, (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const plan = await prisma_1.prisma.plan.create({
        data: {
            businessId: business.id,
            ...req.body,
        },
    });
    await (0, audit_1.writeAuditLog)({
        businessId: business.id,
        action: "plan.created",
        entity: "plan",
        entityId: plan.id,
        metadata: { code: plan.code },
    });
    res.status(201).json({ plan });
}));
exports.plansRouter.get("/", (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const plans = await prisma_1.prisma.plan.findMany({
        where: { businessId: business.id },
        orderBy: { createdAt: "desc" },
    });
    res.status(200).json({ plans });
}));
exports.plansRouter.get("/:id", (0, validate_middleware_1.validate)({ params: plans_schema_1.planIdParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const id = String(req.params.id);
    const plan = await prisma_1.prisma.plan.findFirst({
        where: {
            id,
            businessId: business.id,
        },
    });
    if (!plan) {
        throw new errors_1.ApiError(404, "Plan not found");
    }
    res.status(200).json({ plan });
}));
exports.plansRouter.patch("/:id", (0, validate_middleware_1.validate)({ params: plans_schema_1.planIdParamsSchema, body: plans_schema_1.updatePlanSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const id = String(req.params.id);
    const existingPlan = await prisma_1.prisma.plan.findFirst({
        where: {
            id,
            businessId: business.id,
        },
    });
    if (!existingPlan) {
        throw new errors_1.ApiError(404, "Plan not found");
    }
    const plan = await prisma_1.prisma.plan.update({
        where: { id: existingPlan.id },
        data: req.body,
    });
    await (0, audit_1.writeAuditLog)({
        businessId: business.id,
        action: "plan.updated",
        entity: "plan",
        entityId: plan.id,
    });
    res.status(200).json({ plan });
}));
exports.plansRouter.delete("/:id", (0, validate_middleware_1.validate)({ params: plans_schema_1.planIdParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const id = String(req.params.id);
    const existingPlan = await prisma_1.prisma.plan.findFirst({
        where: {
            id,
            businessId: business.id,
        },
    });
    if (!existingPlan) {
        throw new errors_1.ApiError(404, "Plan not found");
    }
    const plan = await prisma_1.prisma.plan.update({
        where: { id: existingPlan.id },
        data: { status: "ARCHIVED" },
    });
    await (0, audit_1.writeAuditLog)({
        businessId: business.id,
        action: "plan.archived",
        entity: "plan",
        entityId: plan.id,
    });
    res.status(200).json({ plan });
}));
