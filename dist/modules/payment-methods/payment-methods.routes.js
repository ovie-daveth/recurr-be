"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentMethodsRouter = void 0;
const crypto_1 = __importDefault(require("crypto"));
const express_1 = require("express");
const async_handler_1 = require("../../lib/async-handler");
const audit_1 = require("../../lib/audit");
const errors_1 = require("../../lib/errors");
const prisma_1 = require("../../lib/prisma");
const responses_1 = require("../../lib/responses");
const business_api_key_middleware_1 = require("../../middlewares/business-api-key.middleware");
const idempotency_middleware_1 = require("../../middlewares/idempotency.middleware");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const nomba_service_1 = require("../nomba/nomba.service");
const payment_methods_schema_1 = require("./payment-methods.schema");
exports.paymentMethodsRouter = (0, express_1.Router)({ mergeParams: true });
exports.paymentMethodsRouter.use(business_api_key_middleware_1.businessApiKeyMiddleware);
exports.paymentMethodsRouter.get("/:id/payment-methods", (0, validate_middleware_1.validate)({ params: payment_methods_schema_1.setupPaymentMethodParamsSchema, query: payment_methods_schema_1.listPaymentMethodsQuerySchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const apiKey = (0, errors_1.requireApiKey)(req);
    const customerId = String(req.params.id);
    const query = req.validatedQuery;
    const customer = await prisma_1.prisma.customer.findFirst({
        where: {
            id: customerId,
            businessId: business.id,
            mode: apiKey.mode,
        },
    });
    if (!customer) {
        throw new errors_1.ApiError(404, "Customer not found");
    }
    const paymentMethods = await prisma_1.prisma.paymentMethod.findMany({
        where: {
            customerId: customer.id,
            businessId: business.id,
            mode: apiKey.mode,
            ...(query.status ? { status: query.status } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    (0, responses_1.sendSuccess)(res, 200, "Payment methods returned", { paymentMethods });
}));
exports.paymentMethodsRouter.post("/:id/payment-methods/setup-checkout", (0, validate_middleware_1.validate)({
    params: payment_methods_schema_1.setupPaymentMethodParamsSchema,
    body: payment_methods_schema_1.setupPaymentMethodCheckoutSchema,
}), idempotency_middleware_1.idempotencyMiddleware, (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const apiKey = (0, errors_1.requireApiKey)(req);
    const customerId = String(req.params.id);
    const customer = await prisma_1.prisma.customer.findFirst({
        where: {
            id: customerId,
            businessId: business.id,
            mode: apiKey.mode,
        },
    });
    if (!customer) {
        throw new errors_1.ApiError(404, "Customer not found");
    }
    if (customer.status !== "ACTIVE") {
        throw new errors_1.ApiError(409, "Disabled customers cannot set up payment methods", [], "CUSTOMER_NOT_ACTIVE");
    }
    const reference = `pm_setup_${crypto_1.default.randomUUID().replace(/-/g, "")}`;
    const checkout = await nomba_service_1.paymentProvider.createCheckoutOrder({
        businessId: business.id,
        mode: apiKey.mode,
        customerId: customer.id,
        customerEmail: customer.email,
        customerName: customer.name,
        reference,
        amountMinor: 100,
        currency: "NGN",
        callbackUrl: req.body.callbackUrl,
        metadata: req.body.metadata,
    });
    const paymentMethod = await prisma_1.prisma.paymentMethod.create({
        data: {
            businessId: business.id,
            mode: apiKey.mode,
            customerId: customer.id,
            provider: "NOMBA",
            type: "UNKNOWN",
            status: "PENDING_SETUP",
            providerSetupReference: checkout.reference,
            metadata: {
                ...(req.body.metadata ?? {}),
                checkoutRaw: checkout.raw,
            },
        },
    });
    await (0, audit_1.writeAuditLog)({
        businessId: business.id,
        action: "payment_method.setup_requested",
        entity: "payment_method",
        entityId: paymentMethod.id,
        metadata: { customerId: customer.id, mode: apiKey.mode },
    });
    (0, responses_1.sendSuccess)(res, 201, "Payment method setup checkout created", {
        paymentMethod,
        checkout: {
            provider: checkout.provider,
            reference: checkout.reference,
            checkoutUrl: checkout.checkoutUrl,
        },
    });
}));
exports.paymentMethodsRouter.delete("/:id/payment-methods/:paymentMethodId", (0, validate_middleware_1.validate)({ params: payment_methods_schema_1.paymentMethodParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const apiKey = (0, errors_1.requireApiKey)(req);
    const customerId = String(req.params.id);
    const paymentMethodId = String(req.params.paymentMethodId);
    const paymentMethod = await prisma_1.prisma.paymentMethod.findFirst({
        where: {
            id: paymentMethodId,
            customerId,
            businessId: business.id,
            mode: apiKey.mode,
        },
    });
    if (!paymentMethod) {
        throw new errors_1.ApiError(404, "Payment method not found");
    }
    const openSubscription = await prisma_1.prisma.subscription.findFirst({
        where: {
            businessId: business.id,
            mode: apiKey.mode,
            paymentMethodId: paymentMethod.id,
            status: {
                in: ["INCOMPLETE", "TRIALING", "ACTIVE", "PAST_DUE", "PAUSED"],
            },
        },
    });
    if (openSubscription) {
        throw new errors_1.ApiError(409, "Payment method is attached to an open subscription", [{ subscriptionId: openSubscription.id }], "PAYMENT_METHOD_IN_USE");
    }
    const updatedPaymentMethod = await prisma_1.prisma.paymentMethod.update({
        where: { id: paymentMethod.id },
        data: {
            status: "DISABLED",
            reusable: false,
        },
    });
    await (0, audit_1.writeAuditLog)({
        businessId: business.id,
        action: "payment_method.revoked",
        entity: "payment_method",
        entityId: updatedPaymentMethod.id,
        metadata: { customerId, mode: apiKey.mode },
    });
    (0, responses_1.sendSuccess)(res, 200, "Payment method revoked", {
        paymentMethod: updatedPaymentMethod,
    });
}));
