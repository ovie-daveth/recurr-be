"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.devPaymentLoadRouter = void 0;
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_perf_hooks_1 = require("node:perf_hooks");
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
const loadTestRoles = ["OWNER", "ADMIN", "DEVELOPER"];
exports.devPaymentLoadRouter.use((_req, _res, next) => {
    if (!["development", "test"].includes(process.env.NODE_ENV ?? "") ||
        process.env.MOCK_LOAD_TEST_ENABLED !== "true") {
        next(new errors_1.ApiError(404, "Mock payment load testing is disabled"));
        return;
    }
    next();
});
exports.devPaymentLoadRouter.use(merchant_session_middleware_1.merchantSessionMiddleware);
exports.devPaymentLoadRouter.post("/runs", (0, validate_middleware_1.validate)({ body: dev_payment_load_schema_1.createMockLoadRunSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const { businessId, profile, targetRate, durationSeconds } = req.body;
    const business = await prisma_1.prisma.business.findFirst({
        where: {
            id: businessId,
            status: "ACTIVE",
            members: {
                some: { userId: user.id, role: { in: [...loadTestRoles] } },
            },
        },
        select: { id: true },
    });
    if (!business) {
        throw new errors_1.ApiError(404, "Business not found");
    }
    const run = await prisma_1.prisma.mockLoadTestRun.create({
        data: { businessId: business.id, profile, targetRate, durationSeconds },
    });
    (0, responses_1.sendSuccess)(res, 201, "Mock provider load run started", { run });
}));
exports.devPaymentLoadRouter.get("/runs", (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const runs = await prisma_1.prisma.mockLoadTestRun.findMany({
        where: {
            business: {
                members: {
                    some: { userId: user.id, role: { in: [...loadTestRoles] } },
                },
            },
        },
        orderBy: { startedAt: "desc" },
        take: 100,
        include: {
            business: { select: { name: true } },
            _count: { select: { responses: true } },
        },
    });
    (0, responses_1.sendSuccess)(res, 200, "Mock provider load runs returned", { runs });
}));
exports.devPaymentLoadRouter.get("/runs/:runId", (0, validate_middleware_1.validate)({ params: dev_payment_load_schema_1.mockLoadRunParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const { runId } = req.params;
    const run = await prisma_1.prisma.mockLoadTestRun.findFirst({
        where: {
            id: runId,
            business: {
                members: {
                    some: { userId: user.id, role: { in: [...loadTestRoles] } },
                },
            },
        },
        include: {
            business: { select: { name: true } },
            responses: {
                orderBy: { timestamp: "asc" },
                take: 10_000,
            },
        },
    });
    if (!run) {
        throw new errors_1.ApiError(404, "Mock provider load run not found");
    }
    const endTime = run.completedAt ?? new Date();
    (0, responses_1.sendSuccess)(res, 200, "Mock provider load run returned", {
        run: {
            ...run,
            elapsedSeconds: Math.max(1, (endTime.getTime() - run.startedAt.getTime()) / 1_000),
        },
    });
}));
exports.devPaymentLoadRouter.post("/runs/:runId/complete", (0, validate_middleware_1.validate)({ params: dev_payment_load_schema_1.mockLoadRunParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const { runId } = req.params;
    const run = await prisma_1.prisma.mockLoadTestRun.findFirst({
        where: {
            id: runId,
            business: {
                members: {
                    some: { userId: user.id, role: { in: [...loadTestRoles] } },
                },
            },
        },
        select: { id: true, status: true },
    });
    if (!run) {
        throw new errors_1.ApiError(404, "Mock provider load run not found");
    }
    const completedRun = run.status === "RUNNING"
        ? await prisma_1.prisma.mockLoadTestRun.update({
            where: { id: run.id },
            data: { status: "COMPLETED", completedAt: new Date() },
        })
        : run;
    (0, responses_1.sendSuccess)(res, 200, "Mock provider load run completed", {
        run: completedRun,
    });
}));
exports.devPaymentLoadRouter.post("/simulate", (0, validate_middleware_1.validate)({ body: dev_payment_load_schema_1.simulateMockLoadSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const { businessId, paymentMethodId, amountMinor, telemetryRunId, timestamp, vu, iteration, } = req.body;
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
    if (telemetryRunId) {
        const run = await prisma_1.prisma.mockLoadTestRun.findFirst({
            where: {
                id: telemetryRunId,
                businessId: business.id,
                status: "RUNNING",
            },
            select: { id: true },
        });
        if (!run) {
            throw new errors_1.ApiError(404, "Active telemetry run not found");
        }
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
    const startedAt = node_perf_hooks_1.performance.now();
    const recordResponse = async (input) => {
        if (!telemetryRunId)
            return;
        await prisma_1.prisma.mockLoadTestResponse.create({
            data: {
                runId: telemetryRunId,
                timestamp: timestamp ? new Date(timestamp) : new Date(),
                vu,
                iteration,
                status: input.status,
                durationMs: node_perf_hooks_1.performance.now() - startedAt,
                requestId: req.requestId,
                provider: input.provider,
                preferredProvider: input.preferredProvider,
                selectedProvider: input.selectedProvider,
                unavailableProviders: input.unavailableProviders,
                fallbackUsed: input.fallbackUsed,
                outcome: input.outcome,
                body: input.body,
            },
        });
    };
    let charge;
    try {
        charge = await payment_provider_1.paymentProvider.chargeTokenizedCard({
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
    }
    catch (error) {
        if (error instanceof payment_provider_1.PaymentProvidersUnavailableError) {
            const responseBody = {
                error: {
                    code: "PAYMENT_PROVIDERS_UNAVAILABLE",
                    statusCode: 503,
                    message: "All mock payment providers are unavailable",
                    details: [{ unavailableProviders: error.unavailableProviders }],
                },
            };
            await recordResponse({
                status: 503,
                provider: null,
                preferredProvider: null,
                selectedProvider: null,
                unavailableProviders: error.unavailableProviders,
                fallbackUsed: false,
                outcome: "unavailable",
                body: responseBody,
            });
            res.status(503).json(responseBody);
            return;
        }
        const status = error instanceof errors_1.ApiError ? error.statusCode : 500;
        const responseBody = error instanceof errors_1.ApiError
            ? {
                error: {
                    code: error.code,
                    statusCode: error.statusCode,
                    message: error.message,
                    details: error.details ?? [],
                },
            }
            : {
                error: {
                    code: "INTERNAL_SERVER_ERROR",
                    statusCode: 500,
                    message: "Internal server error",
                    details: [],
                },
            };
        await recordResponse({
            status,
            provider: null,
            preferredProvider: null,
            selectedProvider: null,
            unavailableProviders: [],
            fallbackUsed: false,
            outcome: "http-error",
            body: responseBody,
        });
        throw error;
    }
    const responseBody = {
        status: true,
        code: 200,
        message: "Mock provider load request completed",
        data: {
            paymentProviderResult: {
                provider: charge.provider,
                reference: charge.reference,
                status: charge.status,
                routing: charge.routing,
            },
        },
    };
    await recordResponse({
        status: 200,
        provider: charge.provider,
        preferredProvider: charge.routing.preferredProvider,
        selectedProvider: charge.routing.selectedProvider,
        unavailableProviders: charge.routing.unavailableProviders ?? [],
        fallbackUsed: charge.routing.fallbackUsed,
        outcome: charge.routing.fallbackUsed ? "fallback" : "success",
        body: responseBody,
    });
    res.status(200).json(responseBody);
}));
