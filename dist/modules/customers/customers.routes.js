"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.customersRouter = void 0;
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
const merchant_webhooks_service_1 = require("../webhook-endpoints/merchant-webhooks.service");
const customers_schema_1 = require("./customers.schema");
exports.customersRouter = (0, express_1.Router)();
exports.customersRouter.use(business_resource_auth_middleware_1.businessResourceAuthMiddleware);
exports.customersRouter.post("/", (0, validate_middleware_1.validate)({ body: customers_schema_1.createCustomerSchema }), idempotency_middleware_1.idempotencyMiddleware, (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const mode = (0, errors_1.requireBusinessMode)(req);
    const customer = await prisma_1.prisma.customer.create({
        data: {
            businessId: business.id,
            mode,
            ...req.body,
        },
    });
    await (0, audit_1.writeAuditLog)({
        businessId: business.id,
        action: "customer.created",
        entity: "customer",
        entityId: customer.id,
        metadata: { email: customer.email },
    });
    void (0, merchant_webhooks_service_1.emitMerchantWebhook)({
        businessId: business.id,
        type: "customer.created",
        data: { customer },
    }).catch((error) => {
        console.error("Failed to emit customer.created webhook", error);
    });
    (0, responses_1.sendSuccess)(res, 201, "Customer created", { customer });
}));
exports.customersRouter.get("/", (0, validate_middleware_1.validate)({ query: customers_schema_1.listCustomersQuerySchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const mode = (0, errors_1.requireBusinessMode)(req);
    const query = req.validatedQuery;
    const customers = await prisma_1.prisma.customer.findMany({
        where: {
            businessId: business.id,
            mode,
            ...(query.status ? { status: query.status } : {}),
            ...((0, pagination_1.dateRangeFilter)(query) ? { createdAt: (0, pagination_1.dateRangeFilter)(query) } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...(0, pagination_1.paginationArgs)(query),
    });
    const page = (0, pagination_1.paginateResults)(customers, query.limit);
    (0, responses_1.sendSuccess)(res, 200, "Customers returned", {
        customers: page.data,
        pagination: page.pagination,
    });
}));
exports.customersRouter.get("/:id", (0, validate_middleware_1.validate)({ params: customers_schema_1.customerIdParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const mode = (0, errors_1.requireBusinessMode)(req);
    const id = String(req.params.id);
    const customer = await prisma_1.prisma.customer.findFirst({
        where: {
            id,
            businessId: business.id,
            mode,
        },
    });
    if (!customer) {
        throw new errors_1.ApiError(404, "Customer not found");
    }
    (0, responses_1.sendSuccess)(res, 200, "Customer returned", { customer });
}));
exports.customersRouter.patch("/:id", (0, validate_middleware_1.validate)({ params: customers_schema_1.customerIdParamsSchema, body: customers_schema_1.updateCustomerSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const mode = (0, errors_1.requireBusinessMode)(req);
    const id = String(req.params.id);
    const existingCustomer = await prisma_1.prisma.customer.findFirst({
        where: {
            id,
            businessId: business.id,
            mode,
        },
    });
    if (!existingCustomer) {
        throw new errors_1.ApiError(404, "Customer not found");
    }
    const customer = await prisma_1.prisma.customer.update({
        where: { id: existingCustomer.id },
        data: req.body,
    });
    await (0, audit_1.writeAuditLog)({
        businessId: business.id,
        action: "customer.updated",
        entity: "customer",
        entityId: customer.id,
    });
    (0, responses_1.sendSuccess)(res, 200, "Customer updated", { customer });
}));
exports.customersRouter.post("/:id/status", (0, validate_middleware_1.validate)({ params: customers_schema_1.customerIdParamsSchema, body: customers_schema_1.updateCustomerStatusSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const mode = (0, errors_1.requireBusinessMode)(req);
    const id = String(req.params.id);
    const existingCustomer = await prisma_1.prisma.customer.findFirst({
        where: {
            id,
            businessId: business.id,
            mode,
        },
    });
    if (!existingCustomer) {
        throw new errors_1.ApiError(404, "Customer not found");
    }
    const customer = await prisma_1.prisma.customer.update({
        where: { id: existingCustomer.id },
        data: { status: req.body.status },
    });
    await (0, audit_1.writeAuditLog)({
        businessId: business.id,
        action: "customer.status_updated",
        entity: "customer",
        entityId: customer.id,
        metadata: { status: customer.status, mode },
    });
    (0, responses_1.sendSuccess)(res, 200, "Customer status updated", { customer });
}));
exports.customersRouter.delete("/:id", (0, validate_middleware_1.validate)({ params: customers_schema_1.customerIdParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const mode = (0, errors_1.requireBusinessMode)(req);
    const id = String(req.params.id);
    const existingCustomer = await prisma_1.prisma.customer.findFirst({
        where: {
            id,
            businessId: business.id,
            mode,
        },
    });
    if (!existingCustomer) {
        throw new errors_1.ApiError(404, "Customer not found");
    }
    const customer = await prisma_1.prisma.customer.update({
        where: { id: existingCustomer.id },
        data: { status: "DISABLED" },
    });
    await (0, audit_1.writeAuditLog)({
        businessId: business.id,
        action: "customer.disabled",
        entity: "customer",
        entityId: customer.id,
        metadata: { mode },
    });
    (0, responses_1.sendSuccess)(res, 200, "Customer disabled", { customer });
}));
