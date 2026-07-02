"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plansRouter = void 0;
const express_1 = require("express");
const async_handler_1 = require("../../lib/async-handler");
const audit_1 = require("../../lib/audit");
const errors_1 = require("../../lib/errors");
const pagination_1 = require("../../lib/pagination");
const prisma_1 = require("../../lib/prisma");
const responses_1 = require("../../lib/responses");
const business_api_key_middleware_1 = require("../../middlewares/business-api-key.middleware");
const idempotency_middleware_1 = require("../../middlewares/idempotency.middleware");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const merchant_webhooks_service_1 = require("../webhook-endpoints/merchant-webhooks.service");
const plans_schema_1 = require("./plans.schema");
exports.plansRouter = (0, express_1.Router)();
exports.plansRouter.use(business_api_key_middleware_1.businessApiKeyMiddleware);
exports.plansRouter.post("/", (0, validate_middleware_1.validate)({ body: plans_schema_1.createPlanSchema }), idempotency_middleware_1.idempotencyMiddleware, (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const apiKey = (0, errors_1.requireApiKey)(req);
    const plan = await prisma_1.prisma.plan.create({
        data: {
            businessId: business.id,
            mode: apiKey.mode,
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
    void (0, merchant_webhooks_service_1.emitMerchantWebhook)({
        businessId: business.id,
        type: "plan.created",
        data: { plan },
    }).catch((error) => {
        console.error("Failed to emit plan.created webhook", error);
    });
    (0, responses_1.sendSuccess)(res, 201, "Plan created", { plan });
}));
exports.plansRouter.get("/", (0, validate_middleware_1.validate)({ query: plans_schema_1.listPlansQuerySchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const apiKey = (0, errors_1.requireApiKey)(req);
    const query = req.validatedQuery;
    const plans = await prisma_1.prisma.plan.findMany({
        where: {
            businessId: business.id,
            mode: apiKey.mode,
            ...(query.status ? { status: query.status } : {}),
            ...((0, pagination_1.dateRangeFilter)(query) ? { createdAt: (0, pagination_1.dateRangeFilter)(query) } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...(0, pagination_1.paginationArgs)(query),
    });
    const page = (0, pagination_1.paginateResults)(plans, query.limit);
    (0, responses_1.sendSuccess)(res, 200, "Plans returned", {
        plans: page.data,
        pagination: page.pagination,
    });
}));
exports.plansRouter.get("/:id", (0, validate_middleware_1.validate)({ params: plans_schema_1.planIdParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const apiKey = (0, errors_1.requireApiKey)(req);
    const id = String(req.params.id);
    const plan = await prisma_1.prisma.plan.findFirst({
        where: {
            id,
            businessId: business.id,
            mode: apiKey.mode,
        },
    });
    if (!plan) {
        throw new errors_1.ApiError(404, "Plan not found");
    }
    (0, responses_1.sendSuccess)(res, 200, "Plan returned", { plan });
}));
exports.plansRouter.patch("/:id", (0, validate_middleware_1.validate)({ params: plans_schema_1.planIdParamsSchema, body: plans_schema_1.updatePlanSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const apiKey = (0, errors_1.requireApiKey)(req);
    const id = String(req.params.id);
    const existingPlan = await prisma_1.prisma.plan.findFirst({
        where: {
            id,
            businessId: business.id,
            mode: apiKey.mode,
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
    (0, responses_1.sendSuccess)(res, 200, "Plan updated", { plan });
}));
exports.plansRouter.delete("/:id", (0, validate_middleware_1.validate)({ params: plans_schema_1.planIdParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const apiKey = (0, errors_1.requireApiKey)(req);
    const id = String(req.params.id);
    const existingPlan = await prisma_1.prisma.plan.findFirst({
        where: {
            id,
            businessId: business.id,
            mode: apiKey.mode,
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
    (0, responses_1.sendSuccess)(res, 200, "Plan archived", { plan });
}));
