"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.dunningPoliciesRouter = void 0;
const express_1 = require("express");
const async_handler_1 = require("../../lib/async-handler");
const audit_1 = require("../../lib/audit");
const errors_1 = require("../../lib/errors");
const pagination_1 = require("../../lib/pagination");
const prisma_1 = require("../../lib/prisma");
const responses_1 = require("../../lib/responses");
const business_resource_auth_middleware_1 = require("../../middlewares/business-resource-auth.middleware");
const idempotency_middleware_1 = require("../../middlewares/idempotency.middleware");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const dunning_policies_schema_1 = require("./dunning-policies.schema");
exports.dunningPoliciesRouter = (0, express_1.Router)();
exports.dunningPoliciesRouter.use(business_resource_auth_middleware_1.businessResourceAuthMiddleware);
function stepsCreateData(steps) {
    return steps.map((step, index) => ({
        attemptNumber: index + 1,
        delayMinutes: step.delayMinutes,
        channel: step.channel,
        metadata: step.metadata,
    }));
}
exports.dunningPoliciesRouter.post("/", (0, validate_middleware_1.validate)({ body: dunning_policies_schema_1.createDunningPolicySchema }), idempotency_middleware_1.idempotencyMiddleware, (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const mode = (0, errors_1.requireBusinessMode)(req);
    const policy = await prisma_1.prisma.$transaction(async (tx) => {
        if (req.body.isDefault) {
            await tx.dunningPolicy.updateMany({
                where: {
                    businessId: business.id,
                    mode: mode,
                    isDefault: true,
                },
                data: { isDefault: false },
            });
        }
        return tx.dunningPolicy.create({
            data: {
                businessId: business.id,
                mode: mode,
                name: req.body.name,
                status: req.body.status,
                isDefault: req.body.isDefault,
                finalAction: req.body.finalAction,
                metadata: req.body.metadata,
                steps: {
                    create: stepsCreateData(req.body.steps),
                },
            },
            include: { steps: { orderBy: { attemptNumber: "asc" } } },
        });
    });
    await (0, audit_1.writeAuditLog)({
        businessId: business.id,
        action: "dunning_policy.created",
        entity: "dunning_policy",
        entityId: policy.id,
        metadata: {
            mode: mode,
            isDefault: policy.isDefault,
            finalAction: policy.finalAction,
        },
    });
    (0, responses_1.sendSuccess)(res, 201, "Dunning policy created", { dunningPolicy: policy });
}));
exports.dunningPoliciesRouter.get("/", (0, validate_middleware_1.validate)({ query: dunning_policies_schema_1.listDunningPoliciesQuerySchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const mode = (0, errors_1.requireBusinessMode)(req);
    const query = req.validatedQuery;
    const policies = await prisma_1.prisma.dunningPolicy.findMany({
        where: {
            businessId: business.id,
            mode: mode,
            ...(query.status ? { status: query.status } : {}),
            ...(typeof query.isDefault === "boolean"
                ? { isDefault: query.isDefault }
                : {}),
            ...((0, pagination_1.dateRangeFilter)(query) ? { createdAt: (0, pagination_1.dateRangeFilter)(query) } : {}),
        },
        include: { steps: { orderBy: { attemptNumber: "asc" } } },
        orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        ...(0, pagination_1.paginationArgs)(query),
    });
    const page = (0, pagination_1.paginateResults)(policies, query.limit);
    (0, responses_1.sendSuccess)(res, 200, "Dunning policies returned", {
        dunningPolicies: page.data,
        pagination: page.pagination,
    });
}));
exports.dunningPoliciesRouter.get("/:id", (0, validate_middleware_1.validate)({ params: dunning_policies_schema_1.dunningPolicyIdParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const mode = (0, errors_1.requireBusinessMode)(req);
    const policy = await prisma_1.prisma.dunningPolicy.findFirst({
        where: {
            id: String(req.params.id),
            businessId: business.id,
            mode: mode,
        },
        include: { steps: { orderBy: { attemptNumber: "asc" } } },
    });
    if (!policy) {
        throw new errors_1.ApiError(404, "Dunning policy not found");
    }
    (0, responses_1.sendSuccess)(res, 200, "Dunning policy returned", {
        dunningPolicy: policy,
    });
}));
exports.dunningPoliciesRouter.patch("/:id", (0, validate_middleware_1.validate)({
    params: dunning_policies_schema_1.dunningPolicyIdParamsSchema,
    body: dunning_policies_schema_1.updateDunningPolicySchema,
}), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const mode = (0, errors_1.requireBusinessMode)(req);
    const existing = await prisma_1.prisma.dunningPolicy.findFirst({
        where: {
            id: String(req.params.id),
            businessId: business.id,
            mode: mode,
        },
    });
    if (!existing) {
        throw new errors_1.ApiError(404, "Dunning policy not found");
    }
    if (req.body.status === "DISABLED" && (req.body.isDefault ?? existing.isDefault)) {
        throw new errors_1.ApiError(409, "Default dunning policy cannot be disabled", [], "DEFAULT_DUNNING_POLICY_CANNOT_BE_DISABLED");
    }
    const policy = await prisma_1.prisma.$transaction(async (tx) => {
        if (req.body.isDefault) {
            await tx.dunningPolicy.updateMany({
                where: {
                    businessId: business.id,
                    mode: mode,
                    isDefault: true,
                    id: { not: existing.id },
                },
                data: { isDefault: false },
            });
        }
        if (req.body.steps) {
            await tx.dunningPolicyStep.deleteMany({
                where: { policyId: existing.id },
            });
        }
        return tx.dunningPolicy.update({
            where: { id: existing.id },
            data: {
                ...(req.body.name ? { name: req.body.name } : {}),
                ...(req.body.status ? { status: req.body.status } : {}),
                ...(typeof req.body.isDefault === "boolean"
                    ? { isDefault: req.body.isDefault }
                    : {}),
                ...(req.body.finalAction
                    ? { finalAction: req.body.finalAction }
                    : {}),
                ...(req.body.metadata !== undefined
                    ? { metadata: req.body.metadata }
                    : {}),
                ...(req.body.steps
                    ? { steps: { create: stepsCreateData(req.body.steps) } }
                    : {}),
            },
            include: { steps: { orderBy: { attemptNumber: "asc" } } },
        });
    });
    await (0, audit_1.writeAuditLog)({
        businessId: business.id,
        action: "dunning_policy.updated",
        entity: "dunning_policy",
        entityId: policy.id,
        metadata: {
            mode: mode,
            isDefault: policy.isDefault,
            finalAction: policy.finalAction,
        },
    });
    (0, responses_1.sendSuccess)(res, 200, "Dunning policy updated", {
        dunningPolicy: policy,
    });
}));
