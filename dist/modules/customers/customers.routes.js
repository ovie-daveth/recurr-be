"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.customersRouter = void 0;
const express_1 = require("express");
const async_handler_1 = require("../../lib/async-handler");
const audit_1 = require("../../lib/audit");
const errors_1 = require("../../lib/errors");
const prisma_1 = require("../../lib/prisma");
const responses_1 = require("../../lib/responses");
const business_api_key_middleware_1 = require("../../middlewares/business-api-key.middleware");
const idempotency_middleware_1 = require("../../middlewares/idempotency.middleware");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const customers_schema_1 = require("./customers.schema");
exports.customersRouter = (0, express_1.Router)();
exports.customersRouter.use(business_api_key_middleware_1.businessApiKeyMiddleware);
exports.customersRouter.post("/", (0, validate_middleware_1.validate)({ body: customers_schema_1.createCustomerSchema }), idempotency_middleware_1.idempotencyMiddleware, (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const apiKey = (0, errors_1.requireApiKey)(req);
    const customer = await prisma_1.prisma.customer.create({
        data: {
            businessId: business.id,
            mode: apiKey.mode,
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
    (0, responses_1.sendSuccess)(res, 201, "Customer created", { customer });
}));
exports.customersRouter.get("/", (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const apiKey = (0, errors_1.requireApiKey)(req);
    const customers = await prisma_1.prisma.customer.findMany({
        where: { businessId: business.id, mode: apiKey.mode },
        orderBy: { createdAt: "desc" },
    });
    (0, responses_1.sendSuccess)(res, 200, "Customers returned", { customers });
}));
exports.customersRouter.get("/:id", (0, validate_middleware_1.validate)({ params: customers_schema_1.customerIdParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const apiKey = (0, errors_1.requireApiKey)(req);
    const id = String(req.params.id);
    const customer = await prisma_1.prisma.customer.findFirst({
        where: {
            id,
            businessId: business.id,
            mode: apiKey.mode,
        },
    });
    if (!customer) {
        throw new errors_1.ApiError(404, "Customer not found");
    }
    (0, responses_1.sendSuccess)(res, 200, "Customer returned", { customer });
}));
exports.customersRouter.patch("/:id", (0, validate_middleware_1.validate)({ params: customers_schema_1.customerIdParamsSchema, body: customers_schema_1.updateCustomerSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const apiKey = (0, errors_1.requireApiKey)(req);
    const id = String(req.params.id);
    const existingCustomer = await prisma_1.prisma.customer.findFirst({
        where: {
            id,
            businessId: business.id,
            mode: apiKey.mode,
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
    const apiKey = (0, errors_1.requireApiKey)(req);
    const id = String(req.params.id);
    const existingCustomer = await prisma_1.prisma.customer.findFirst({
        where: {
            id,
            businessId: business.id,
            mode: apiKey.mode,
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
        metadata: { status: customer.status, mode: apiKey.mode },
    });
    (0, responses_1.sendSuccess)(res, 200, "Customer status updated", { customer });
}));
exports.customersRouter.delete("/:id", (0, validate_middleware_1.validate)({ params: customers_schema_1.customerIdParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const apiKey = (0, errors_1.requireApiKey)(req);
    const id = String(req.params.id);
    const existingCustomer = await prisma_1.prisma.customer.findFirst({
        where: {
            id,
            businessId: business.id,
            mode: apiKey.mode,
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
        metadata: { mode: apiKey.mode },
    });
    (0, responses_1.sendSuccess)(res, 200, "Customer disabled", { customer });
}));
