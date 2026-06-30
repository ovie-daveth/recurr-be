"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.plansRouter = void 0;
const express_1 = require("express");
const async_handler_js_1 = require("../../lib/async-handler.js");
const audit_js_1 = require("../../lib/audit.js");
const errors_js_1 = require("../../lib/errors.js");
const prisma_js_1 = require("../../lib/prisma.js");
const tenant_middleware_js_1 = require("../../middlewares/tenant.middleware.js");
const validate_middleware_js_1 = require("../../middlewares/validate.middleware.js");
const plans_schema_js_1 = require("./plans.schema.js");
exports.plansRouter = (0, express_1.Router)();
exports.plansRouter.use(tenant_middleware_js_1.tenantMiddleware);
exports.plansRouter.post("/", (0, validate_middleware_js_1.validate)({ body: plans_schema_js_1.createPlanSchema }), (0, async_handler_js_1.asyncHandler)(async (req, res) => {
    const tenant = (0, errors_js_1.requireTenant)(req);
    const plan = await prisma_js_1.prisma.plan.create({
        data: {
            tenantId: tenant.id,
            ...req.body,
        },
    });
    await (0, audit_js_1.writeAuditLog)({
        tenantId: tenant.id,
        action: "plan.created",
        entity: "plan",
        entityId: plan.id,
        metadata: { code: plan.code },
    });
    res.status(201).json({ plan });
}));
exports.plansRouter.get("/", (0, async_handler_js_1.asyncHandler)(async (req, res) => {
    const tenant = (0, errors_js_1.requireTenant)(req);
    const plans = await prisma_js_1.prisma.plan.findMany({
        where: { tenantId: tenant.id },
        orderBy: { createdAt: "desc" },
    });
    res.status(200).json({ plans });
}));
exports.plansRouter.get("/:id", (0, validate_middleware_js_1.validate)({ params: plans_schema_js_1.planIdParamsSchema }), (0, async_handler_js_1.asyncHandler)(async (req, res) => {
    const tenant = (0, errors_js_1.requireTenant)(req);
    const id = String(req.params.id);
    const plan = await prisma_js_1.prisma.plan.findFirst({
        where: {
            id,
            tenantId: tenant.id,
        },
    });
    if (!plan) {
        throw new errors_js_1.ApiError(404, "Plan not found");
    }
    res.status(200).json({ plan });
}));
exports.plansRouter.patch("/:id", (0, validate_middleware_js_1.validate)({ params: plans_schema_js_1.planIdParamsSchema, body: plans_schema_js_1.updatePlanSchema }), (0, async_handler_js_1.asyncHandler)(async (req, res) => {
    const tenant = (0, errors_js_1.requireTenant)(req);
    const id = String(req.params.id);
    const existingPlan = await prisma_js_1.prisma.plan.findFirst({
        where: {
            id,
            tenantId: tenant.id,
        },
    });
    if (!existingPlan) {
        throw new errors_js_1.ApiError(404, "Plan not found");
    }
    const plan = await prisma_js_1.prisma.plan.update({
        where: { id: existingPlan.id },
        data: req.body,
    });
    await (0, audit_js_1.writeAuditLog)({
        tenantId: tenant.id,
        action: "plan.updated",
        entity: "plan",
        entityId: plan.id,
    });
    res.status(200).json({ plan });
}));
exports.plansRouter.delete("/:id", (0, validate_middleware_js_1.validate)({ params: plans_schema_js_1.planIdParamsSchema }), (0, async_handler_js_1.asyncHandler)(async (req, res) => {
    const tenant = (0, errors_js_1.requireTenant)(req);
    const id = String(req.params.id);
    const existingPlan = await prisma_js_1.prisma.plan.findFirst({
        where: {
            id,
            tenantId: tenant.id,
        },
    });
    if (!existingPlan) {
        throw new errors_js_1.ApiError(404, "Plan not found");
    }
    const plan = await prisma_js_1.prisma.plan.update({
        where: { id: existingPlan.id },
        data: { status: "ARCHIVED" },
    });
    await (0, audit_js_1.writeAuditLog)({
        tenantId: tenant.id,
        action: "plan.archived",
        entity: "plan",
        entityId: plan.id,
    });
    res.status(200).json({ plan });
}));
