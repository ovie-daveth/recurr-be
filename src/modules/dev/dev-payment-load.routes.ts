import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { Router } from "express";
import { Prisma } from "../../generated/prisma/client";
import { asyncHandler } from "../../lib/async-handler";
import { ApiError, requireMerchantUser } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { sendSuccess } from "../../lib/responses";
import { merchantSessionMiddleware } from "../../middlewares/merchant-session.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { paymentProvider, PaymentProvidersUnavailableError } from "../payments/payment-provider";
import {
  createMockLoadRunSchema,
  mockLoadRunParamsSchema,
  simulateMockLoadSchema,
} from "./dev-payment-load.schema";

export const devPaymentLoadRouter = Router();
const loadTestRoles = ["OWNER", "ADMIN", "DEVELOPER"] as const;

devPaymentLoadRouter.use((_req, _res, next) => {
  if (
    !["development", "test"].includes(process.env.NODE_ENV ?? "") ||
    process.env.MOCK_LOAD_TEST_ENABLED !== "true"
  ) {
    next(new ApiError(404, "Mock payment load testing is disabled"));
    return;
  }

  next();
});
devPaymentLoadRouter.use(merchantSessionMiddleware);

devPaymentLoadRouter.post(
  "/runs",
  validate({ body: createMockLoadRunSchema }),
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);
    const { businessId, profile, targetRate, durationSeconds } = req.body as
      typeof createMockLoadRunSchema._output;
    const business = await prisma.business.findFirst({
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
      throw new ApiError(404, "Business not found");
    }

    const run = await prisma.mockLoadTestRun.create({
      data: { businessId: business.id, profile, targetRate, durationSeconds },
    });
    sendSuccess(res, 201, "Mock provider load run started", { run });
  })
);

devPaymentLoadRouter.get(
  "/runs",
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);
    const runs = await prisma.mockLoadTestRun.findMany({
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

    sendSuccess(res, 200, "Mock provider load runs returned", { runs });
  })
);

devPaymentLoadRouter.get(
  "/runs/:runId",
  validate({ params: mockLoadRunParamsSchema }),
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);
    const { runId } = req.params as typeof mockLoadRunParamsSchema._output;
    const run = await prisma.mockLoadTestRun.findFirst({
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
      throw new ApiError(404, "Mock provider load run not found");
    }

    const endTime = run.completedAt ?? new Date();
    sendSuccess(res, 200, "Mock provider load run returned", {
      run: {
        ...run,
        elapsedSeconds: Math.max(
          1,
          (endTime.getTime() - run.startedAt.getTime()) / 1_000
        ),
      },
    });
  })
);

devPaymentLoadRouter.post(
  "/runs/:runId/complete",
  validate({ params: mockLoadRunParamsSchema }),
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);
    const { runId } = req.params as typeof mockLoadRunParamsSchema._output;
    const run = await prisma.mockLoadTestRun.findFirst({
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
      throw new ApiError(404, "Mock provider load run not found");
    }

    const completedRun =
      run.status === "RUNNING"
        ? await prisma.mockLoadTestRun.update({
            where: { id: run.id },
            data: { status: "COMPLETED", completedAt: new Date() },
          })
        : run;
    sendSuccess(res, 200, "Mock provider load run completed", {
      run: completedRun,
    });
  })
);

devPaymentLoadRouter.post(
  "/simulate",
  validate({ body: simulateMockLoadSchema }),
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);
    const {
      businessId,
      paymentMethodId,
      amountMinor,
      telemetryRunId,
      timestamp,
      vu,
      iteration,
    } = req.body as typeof simulateMockLoadSchema._output;

    const business = await prisma.business.findFirst({
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
      throw new ApiError(404, "Business not found");
    }

    if (telemetryRunId) {
      const run = await prisma.mockLoadTestRun.findFirst({
        where: {
          id: telemetryRunId,
          businessId: business.id,
          status: "RUNNING",
        },
        select: { id: true },
      });

      if (!run) {
        throw new ApiError(404, "Active telemetry run not found");
      }
    }

    const paymentMethod = await prisma.paymentMethod.findFirst({
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
      throw new ApiError(
        404,
        "Active reusable TEST payment method not found",
        [],
        "TEST_PAYMENT_METHOD_NOT_FOUND"
      );
    }

    const startedAt = performance.now();
    const recordResponse = async (input: {
      status: number;
      provider: string | null;
      preferredProvider: string | null;
      selectedProvider: string | null;
      unavailableProviders: string[];
      fallbackUsed: boolean;
      outcome: string;
      body: Prisma.InputJsonValue;
    }) => {
      if (!telemetryRunId) return;
      await prisma.mockLoadTestResponse.create({
        data: {
          runId: telemetryRunId,
          timestamp: timestamp ? new Date(timestamp) : new Date(),
          vu,
          iteration,
          status: input.status,
          durationMs: performance.now() - startedAt,
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

    let charge: Awaited<ReturnType<typeof paymentProvider.chargeTokenizedCard>>;
    try {
      charge = await paymentProvider.chargeTokenizedCard({
        businessId: business.id,
        mode: "TEST",
        customerId: paymentMethod.customerId,
        preferredProvider: paymentMethod.provider,
        providerCustomerReference: paymentMethod.providerCustomerReference!,
        paymentMethodReference: paymentMethod.providerPaymentMethodReference!,
        reference: `mock_load_${crypto.randomUUID()}`,
        amountMinor,
        currency: "NGN",
        metadata: { source: "mock_provider_load_test" },
      });

    } catch (error) {
      if (error instanceof PaymentProvidersUnavailableError) {
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

      const status = error instanceof ApiError ? error.statusCode : 500;
      const responseBody =
        error instanceof ApiError
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
  })
);
