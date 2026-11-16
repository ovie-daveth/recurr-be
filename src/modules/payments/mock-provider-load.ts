import type { PaymentProvider } from "../../generated/prisma/client";
import { advisoryLockKey } from "../../lib/advisory-lock";
import { observeEvent } from "../../lib/observability";
import { prisma } from "../../lib/prisma";
import {
  assessMockProviderLoad,
  mockProviderRequestLoad,
  randomFailurePoint,
  type MockProviderLoadInput,
  type MockProviderLoadResult,
} from "./mock-provider-model";

const LOAD_WINDOW_MS = 5 * 60 * 1000;

export async function recordMockProviderRequest(input: {
  provider: MockProviderLoadInput["provider"];
  amountMinor: MockProviderLoadInput["amountMinor"];
  currency: MockProviderLoadInput["currency"];
  now?: Date;
  random?: () => number;
}): Promise<MockProviderLoadResult> {
  const now = input.now ?? new Date();
  const requestLoad = mockProviderRequestLoad(input);
  const state = await prisma.$transaction(async (tx) => {
    const lockKey = advisoryLockKey("mock-provider-load", input.provider);
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
    `;

    const windowStart = new Date(now.getTime() - LOAD_WINDOW_MS);
    await tx.mockProviderLoadEvent.deleteMany({
      where: {
        provider: input.provider as PaymentProvider,
        createdAt: { lt: windowStart },
      },
    });

    const recentLoad = await tx.mockProviderLoadEvent.aggregate({
      where: {
        provider: input.provider as PaymentProvider,
        createdAt: { gte: windowStart },
      },
      _sum: { requestLoad: true },
      _count: { _all: true },
    });

    let providerState = await tx.mockProviderLoadState.findUnique({
      where: { provider: input.provider as PaymentProvider },
    });

    if (!providerState) {
      providerState = await tx.mockProviderLoadState.create({
        data: {
          provider: input.provider as PaymentProvider,
          failurePoint: randomFailurePoint(input.random),
        },
      });
    } else if (recentLoad._count._all === 0) {
      providerState = await tx.mockProviderLoadState.update({
        where: { provider: input.provider as PaymentProvider },
        data: { failurePoint: randomFailurePoint(input.random) },
      });
    }

    const result = assessMockProviderLoad({
      currentLoad: recentLoad._sum.requestLoad ?? 0,
      requestLoad,
      failurePoint: providerState.failurePoint,
      requestCount: recentLoad._count._all,
    });
    await tx.mockProviderLoadEvent.create({
      data: {
        provider: input.provider as PaymentProvider,
        amountMinor: input.amountMinor,
        currency: input.currency,
        requestLoad,
        createdAt: now,
      },
    });

    return result;
  });

  observeEvent(state.unavailable ? "warn" : "info", "payments.mock_provider_load", {
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
