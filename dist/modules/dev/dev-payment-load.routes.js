"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.devPaymentLoadRouter = void 0;
const node_crypto_1 = __importDefault(require("node:crypto"));
const express_1 = require("express");
const async_handler_1 = require("../../lib/async-handler");
const errors_1 = require("../../lib/errors");
const prisma_1 = require("../../lib/prisma");
const responses_1 = require("../../lib/responses");
const merchant_session_middleware_1 = require("../../middlewares/merchant-session.middleware");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const payment_provider_1 = require("../payments/payment-provider");
const dev_payment_load_schema_1 = require("./dev-payment-load.schema");
exports.devPaymentLoadRouter = (0, express_1.Router)();
exports.devPaymentLoadRouter.use((_req, _res, next) => {
    if (!["development", "test"].includes(process.env.NODE_ENV ?? "") ||
        process.env.MOCK_LOAD_TEST_ENABLED !== "true") {
        next(new errors_1.ApiError(404, "Mock payment load testing is disabled"));
        return;
    }
    next();
});
exports.devPaymentLoadRouter.use(merchant_session_middleware_1.merchantSessionMiddleware);
exports.devPaymentLoadRouter.post("/simulate", (0, validate_middleware_1.validate)({ body: dev_payment_load_schema_1.simulateMockLoadSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const { businessId, paymentMethodId, amountMinor } = req.body;
    const business = await prisma_1.prisma.business.findFirst({
        where: {
            id: businessId,
            status: "ACTIVE",
            members: {
                some: {
                    userId: user.id,
                    role: { in: ["OWNER", "ADMIN", "DEVELOPER"] },
                },
            },
        },
        select: { id: true },
    });
    if (!business) {
        throw new errors_1.ApiError(404, "Business not found");
    }
    const paymentMethod = await prisma_1.prisma.paymentMethod.findFirst({
        where: {
            id: paymentMethodId,
            businessId: business.id,
            mode: "TEST",
            status: "ACTIVE",
            reusable: true,
            providerCustomerReference: { not: null },
            providerPaymentMethodReference: { not: null },
        },
        select: {
            id: true,
            customerId: true,
            provider: true,
            providerCustomerReference: true,
            providerPaymentMethodReference: true,
        },
    });
    if (!paymentMethod) {
        throw new errors_1.ApiError(404, "Active reusable TEST payment method not found", [], "TEST_PAYMENT_METHOD_NOT_FOUND");
    }
    try {
        const charge = await payment_provider_1.paymentProvider.chargeTokenizedCard({
            businessId: business.id,
            mode: "TEST",
            customerId: paymentMethod.customerId,
            preferredProvider: paymentMethod.provider,
            providerCustomerReference: paymentMethod.providerCustomerReference,
            paymentMethodReference: paymentMethod.providerPaymentMethodReference,
            reference: `mock_load_${node_crypto_1.default.randomUUID()}`,
            amountMinor,
            currency: "NGN",
            metadata: { source: "mock_provider_load_test" },
        });
        (0, responses_1.sendSuccess)(res, 200, "Mock provider load request completed", {
            paymentProviderResult: {
                provider: charge.provider,
                reference: charge.reference,
                status: charge.status,
                routing: charge.routing,
            },
        });
    }
    catch (error) {
        if (error instanceof payment_provider_1.PaymentProvidersUnavailableError) {
            throw new errors_1.ApiError(503, "All mock payment providers are unavailable", [{ unavailableProviders: error.unavailableProviders }], "PAYMENT_PROVIDERS_UNAVAILABLE");
        }
        throw error;
    }
}));
