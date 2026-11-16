import crypto from "node:crypto";
import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { ApiError, requireMerchantUser } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { sendSuccess } from "../../lib/responses";
import { merchantSessionMiddleware } from "../../middlewares/merchant-session.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { paymentProvider, PaymentProvidersUnavailableError } from "../payments/payment-provider";
import { simulateMockLoadSchema } from "./dev-payment-load.schema";

export const devPaymentLoadRouter = Router();

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
  "/simulate",
  validate({ body: simulateMockLoadSchema }),
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);
    const { businessId, paymentMethodId, amountMinor } = req.body as
      typeof simulateMockLoadSchema._output;

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

    try {
      const charge = await paymentProvider.chargeTokenizedCard({
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

      sendSuccess(res, 200, "Mock provider load request completed", {
        paymentProviderResult: {
          provider: charge.provider,
          reference: charge.reference,
          status: charge.status,
          routing: charge.routing,
        },
      });
    } catch (error) {
      if (error instanceof PaymentProvidersUnavailableError) {
        throw new ApiError(
          503,
          "All mock payment providers are unavailable",
          [{ unavailableProviders: error.unavailableProviders }],
          "PAYMENT_PROVIDERS_UNAVAILABLE"
        );
      }

      throw error;
    }
  })
);
