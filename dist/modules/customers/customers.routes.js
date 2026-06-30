"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.customersRouter = void 0;
const express_1 = require("express");
const async_handler_1 = require("../../lib/async-handler");
const audit_1 = require("../../lib/audit");
const errors_1 = require("../../lib/errors");
const prisma_1 = require("../../lib/prisma");
const business_api_key_middleware_1 = require("../../middlewares/business-api-key.middleware");
const idempotency_middleware_1 = require("../../middlewares/idempotency.middleware");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const customers_schema_1 = require("./customers.schema");
exports.customersRouter = (0, express_1.Router)();
exports.customersRouter.use(business_api_key_middleware_1.businessApiKeyMiddleware);
exports.customersRouter.post("/", (0, validate_middleware_1.validate)({ body: customers_schema_1.createCustomerSchema }), idempotency_middleware_1.idempotencyMiddleware, (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const customer = await prisma_1.prisma.customer.create({
        data: {
            businessId: business.id,
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
    res.status(201).json({ customer });
}));
exports.customersRouter.get("/", (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const customers = await prisma_1.prisma.customer.findMany({
        where: { businessId: business.id },
        orderBy: { createdAt: "desc" },
    });
    res.status(200).json({ customers });
}));
exports.customersRouter.get("/:id", (0, validate_middleware_1.validate)({ params: customers_schema_1.customerIdParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const id = String(req.params.id);
    const customer = await prisma_1.prisma.customer.findFirst({
        where: {
            id,
            businessId: business.id,
        },
    });
    if (!customer) {
        throw new errors_1.ApiError(404, "Customer not found");
    }
    res.status(200).json({ customer });
}));
exports.customersRouter.patch("/:id", (0, validate_middleware_1.validate)({ params: customers_schema_1.customerIdParamsSchema, body: customers_schema_1.updateCustomerSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const id = String(req.params.id);
    const existingCustomer = await prisma_1.prisma.customer.findFirst({
        where: {
            id,
            businessId: business.id,
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
    res.status(200).json({ customer });
}));
