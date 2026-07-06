import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { ApiError, requireMerchantUser } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { sendSuccess } from "../../lib/responses";
import { merchantSessionMiddleware } from "../../middlewares/merchant-session.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { runDueBilling } from "../billing/billing.service";
import {
  fastForwardSubscriptionBillingSchema,
  fastForwardSubscriptionParamsSchema,
  runDueBillingSchema,
} from "./dev-billing.schema";

export const devBillingRouter = Router();

devBillingRouter.use(merchantSessionMiddleware);

async function requireBillingDevAccess(businessId: string, userId: string) {
  const membership = await prisma.businessMember.findFirst({
    where: {
      businessId,
      userId,
      role: { in: ["OWNER", "ADMIN", "DEVELOPER"] },
    },
  });

  if (!membership) {
    throw new ApiError(404, "Business not found", [], "BUSINESS_NOT_FOUND");
  }
}

devBillingRouter.post(
  "/run-due",
  validate({ body: runDueBillingSchema }),
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);
    const input = req.body as typeof runDueBillingSchema._output;

    await requireBillingDevAccess(input.businessId, user.id);

    const result = await runDueBilling(input);
    sendSuccess(res, 200, "Due billing run completed", result);
  })
);

devBillingRouter.post(
  "/subscriptions/:id/fast-forward",
  validate({
    params: fastForwardSubscriptionParamsSchema,
    body: fastForwardSubscriptionBillingSchema,
  }),
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);
    const input = req.body as typeof fastForwardSubscriptionBillingSchema._output;
    const subscriptionId = String(req.params.id);

    await requireBillingDevAccess(input.businessId, user.id);

    const subscription = await prisma.subscription.findFirst({
      where: {
        id: subscriptionId,
        businessId: input.businessId,
        mode: input.mode,
      },
    });

    if (!subscription) {
      throw new ApiError(404, "Subscription not found", [], "SUBSCRIPTION_NOT_FOUND");
    }

    if (!["ACTIVE", "TRIALING"].includes(subscription.status)) {
      throw new ApiError(
        409,
        "Only ACTIVE or TRIALING subscriptions can be fast-forwarded for billing",
        [{ status: subscription.status }],
        "SUBSCRIPTION_NOT_BILLABLE"
      );
    }

    if (subscription.cancelAtPeriodEnd) {
      throw new ApiError(
        409,
        "Subscription is scheduled to cancel at period end",
        [],
        "SUBSCRIPTION_CANCEL_SCHEDULED"
      );
    }

    const nextBillingAt = new Date(Date.now() - input.minutesAgo * 60 * 1000);
    const updatedSubscription = await prisma.subscription.update({
      where: { id: subscription.id },
      data: { nextBillingAt },
    });

    sendSuccess(res, 200, "Subscription billing date fast-forwarded", {
      subscription: updatedSubscription,
      workerHint:
        "The billing worker should pick this subscription up on its next billing.runDue cycle.",
    });
  })
);
