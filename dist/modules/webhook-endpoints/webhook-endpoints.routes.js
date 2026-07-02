"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookEndpointsRouter = void 0;
const express_1 = require("express");
const async_handler_1 = require("../../lib/async-handler");
const audit_1 = require("../../lib/audit");
const errors_1 = require("../../lib/errors");
const pagination_1 = require("../../lib/pagination");
const prisma_1 = require("../../lib/prisma");
const responses_1 = require("../../lib/responses");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const merchant_webhooks_service_1 = require("./merchant-webhooks.service");
const webhook_endpoints_schema_1 = require("./webhook-endpoints.schema");
exports.webhookEndpointsRouter = (0, express_1.Router)({ mergeParams: true });
async function requireWebhookManagementAccess(businessId, userId) {
    const membership = await prisma_1.prisma.businessMember.findFirst({
        where: {
            businessId,
            userId,
            role: { in: ["OWNER", "ADMIN", "DEVELOPER"] },
        },
    });
    if (!membership) {
        throw new errors_1.ApiError(404, "Business not found");
    }
}
const webhookEndpointSafeSelect = {
    id: true,
    businessId: true,
    url: true,
    description: true,
    events: true,
    status: true,
    createdAt: true,
    updatedAt: true,
    disabledAt: true,
};
exports.webhookEndpointsRouter.post("/", (0, validate_middleware_1.validate)({ body: webhook_endpoints_schema_1.createWebhookEndpointSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const businessId = String(req.params.businessId);
    await requireWebhookManagementAccess(businessId, user.id);
    const signingSecret = (0, merchant_webhooks_service_1.generateWebhookSigningSecret)();
    const endpoint = await prisma_1.prisma.webhookEndpoint.create({
        data: {
            businessId,
            url: req.body.url,
            description: req.body.description,
            events: req.body.events,
            secret: signingSecret,
        },
        select: webhookEndpointSafeSelect,
    });
    await (0, audit_1.writeAuditLog)({
        businessId,
        action: "webhook_endpoint.created",
        entity: "webhook_endpoint",
        entityId: endpoint.id,
        metadata: {
            userId: user.id,
            events: endpoint.events,
        },
    });
    (0, responses_1.sendSuccess)(res, 201, "Webhook endpoint created", {
        webhookEndpoint: endpoint,
        signingSecret,
        warning: "Store this signing secret now. Recurr uses it to sign webhook deliveries.",
    });
}));
exports.webhookEndpointsRouter.get("/", (0, validate_middleware_1.validate)({ query: webhook_endpoints_schema_1.listWebhookEndpointsQuerySchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const businessId = String(req.params.businessId);
    const query = req.validatedQuery;
    await requireWebhookManagementAccess(businessId, user.id);
    const endpoints = await prisma_1.prisma.webhookEndpoint.findMany({
        where: {
            businessId,
            ...(query.status ? { status: query.status } : {}),
            ...((0, pagination_1.dateRangeFilter)(query) ? { createdAt: (0, pagination_1.dateRangeFilter)(query) } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...(0, pagination_1.paginationArgs)(query),
        select: webhookEndpointSafeSelect,
    });
    const page = (0, pagination_1.paginateResults)(endpoints, query.limit);
    (0, responses_1.sendSuccess)(res, 200, "Webhook endpoints returned", {
        webhookEndpoints: page.data,
        pagination: page.pagination,
    });
}));
exports.webhookEndpointsRouter.get("/:id", (0, validate_middleware_1.validate)({ params: webhook_endpoints_schema_1.webhookEndpointIdParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const businessId = String(req.params.businessId);
    const id = String(req.params.id);
    await requireWebhookManagementAccess(businessId, user.id);
    const endpoint = await prisma_1.prisma.webhookEndpoint.findFirst({
        where: { id, businessId },
        select: webhookEndpointSafeSelect,
    });
    if (!endpoint) {
        throw new errors_1.ApiError(404, "Webhook endpoint not found");
    }
    (0, responses_1.sendSuccess)(res, 200, "Webhook endpoint returned", {
        webhookEndpoint: endpoint,
    });
}));
exports.webhookEndpointsRouter.delete("/:id", (0, validate_middleware_1.validate)({ params: webhook_endpoints_schema_1.webhookEndpointIdParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const businessId = String(req.params.businessId);
    const id = String(req.params.id);
    await requireWebhookManagementAccess(businessId, user.id);
    const existing = await prisma_1.prisma.webhookEndpoint.findFirst({
        where: { id, businessId },
    });
    if (!existing) {
        throw new errors_1.ApiError(404, "Webhook endpoint not found");
    }
    const endpoint = await prisma_1.prisma.webhookEndpoint.update({
        where: { id },
        data: {
            status: "DISABLED",
            disabledAt: existing.disabledAt ?? new Date(),
        },
        select: webhookEndpointSafeSelect,
    });
    await (0, audit_1.writeAuditLog)({
        businessId,
        action: "webhook_endpoint.disabled",
        entity: "webhook_endpoint",
        entityId: endpoint.id,
        metadata: { userId: user.id },
    });
    (0, responses_1.sendSuccess)(res, 200, "Webhook endpoint disabled", {
        webhookEndpoint: endpoint,
    });
}));
exports.webhookEndpointsRouter.get("/:id/deliveries", (0, validate_middleware_1.validate)({
    params: webhook_endpoints_schema_1.webhookEndpointIdParamsSchema,
    query: webhook_endpoints_schema_1.listWebhookDeliveriesQuerySchema,
}), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const businessId = String(req.params.businessId);
    const id = String(req.params.id);
    const query = req.validatedQuery;
    await requireWebhookManagementAccess(businessId, user.id);
    const endpoint = await prisma_1.prisma.webhookEndpoint.findFirst({
        where: { id, businessId },
        select: { id: true },
    });
    if (!endpoint) {
        throw new errors_1.ApiError(404, "Webhook endpoint not found");
    }
    const deliveries = await prisma_1.prisma.webhookDelivery.findMany({
        where: {
            businessId,
            endpointId: id,
            ...(query.status ? { status: query.status } : {}),
            ...(query.eventType ? { eventType: query.eventType } : {}),
            ...((0, pagination_1.dateRangeFilter)(query) ? { createdAt: (0, pagination_1.dateRangeFilter)(query) } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...(0, pagination_1.paginationArgs)(query),
    });
    const page = (0, pagination_1.paginateResults)(deliveries, query.limit);
    (0, responses_1.sendSuccess)(res, 200, "Webhook deliveries returned", {
        webhookDeliveries: page.data,
        pagination: page.pagination,
    });
}));
exports.webhookEndpointsRouter.post("/:id/test", (0, validate_middleware_1.validate)({ params: webhook_endpoints_schema_1.webhookEndpointIdParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const businessId = String(req.params.businessId);
    const id = String(req.params.id);
    await requireWebhookManagementAccess(businessId, user.id);
    const delivery = await (0, merchant_webhooks_service_1.sendWebhookEndpointTest)({
        businessId,
        endpointId: id,
    });
    if (!delivery) {
        throw new errors_1.ApiError(404, "Active webhook endpoint not found");
    }
    (0, responses_1.sendSuccess)(res, 200, "Webhook test delivered", {
        webhookDelivery: delivery,
    });
}));
