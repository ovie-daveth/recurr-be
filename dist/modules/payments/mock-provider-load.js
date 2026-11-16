"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordMockProviderRequest = recordMockProviderRequest;
const advisory_lock_1 = require("../../lib/advisory-lock");
const observability_1 = require("../../lib/observability");
const prisma_1 = require("../../lib/prisma");
const mock_provider_model_1 = require("./mock-provider-model");
const LOAD_WINDOW_MS = 5 * 60 * 1000;
async function recordMockProviderRequest(input) {
    const now = input.now ?? new Date();
    const requestLoad = (0, mock_provider_model_1.mockProviderRequestLoad)(input);
    const state = await prisma_1.prisma.$transaction(async (tx) => {
        const lockKey = (0, advisory_lock_1.advisoryLockKey)("mock-provider-load", input.provider);
        const lockResult = await tx.$queryRaw `
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text
        IS NOT NULL AS acquired
    `;
        if (lockResult[0]?.acquired !== true) {
            throw new Error("Could not acquire mock provider load lock");
        }
        const windowStart = new Date(now.getTime() - LOAD_WINDOW_MS);
        await tx.mockProviderLoadEvent.deleteMany({
            where: {
                provider: input.provider,
                createdAt: { lt: windowStart },
            },
        });
        const recentLoad = await tx.mockProviderLoadEvent.aggregate({
            where: {
                provider: input.provider,
                createdAt: { gte: windowStart },
            },
            _sum: { requestLoad: true },
            _count: { _all: true },
        });
        let providerState = await tx.mockProviderLoadState.findUnique({
            where: { provider: input.provider },
        });
        if (!providerState) {
            providerState = await tx.mockProviderLoadState.create({
                data: {
                    provider: input.provider,
                    failurePoint: (0, mock_provider_model_1.randomFailurePoint)(input.random),
                },
            });
        }
        else if (recentLoad._count._all === 0) {
            providerState = await tx.mockProviderLoadState.update({
                where: { provider: input.provider },
                data: { failurePoint: (0, mock_provider_model_1.randomFailurePoint)(input.random) },
            });
        }
        const result = (0, mock_provider_model_1.assessMockProviderLoad)({
            currentLoad: recentLoad._sum.requestLoad ?? 0,
            requestLoad,
            failurePoint: providerState.failurePoint,
            requestCount: recentLoad._count._all,
        });
        await tx.mockProviderLoadEvent.create({
            data: {
                provider: input.provider,
                amountMinor: input.amountMinor,
                currency: input.currency,
                requestLoad,
                createdAt: now,
            },
        });
        return result;
    });
    (0, observability_1.observeEvent)(state.unavailable ? "warn" : "info", "payments.mock_provider_load", {
        provider: input.provider,
        currency: input.currency,
        amountMinor: input.amountMinor,
        requestCount: state.requestCount,
        load: state.load,
        failurePoint: state.failurePoint,
        riskScore: state.riskScore,
        unavailable: state.unavailable,
    });
    return state;
}
