import { Router } from "express";
import type { Request } from "express";
import { Prisma } from "../../generated/prisma/client";
import { asyncHandler } from "../../lib/async-handler";
import { writeAuditLog } from "../../lib/audit";
import { ApiError, requireApiKey, requireBusiness } from "../../lib/errors";
import {
  dateRangeFilter,
  paginateResults,
  paginationArgs,
} from "../../lib/pagination";
import { prisma } from "../../lib/prisma";
import { sendSuccess } from "../../lib/responses";
import { businessApiKeyMiddleware } from "../../middlewares/business-api-key.middleware";
import { idempotencyMiddleware } from "../../middlewares/idempotency.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { scheduleNextDunningAttempt } from "../dunning/dunning.service";
import { paymentProvider } from "../nomba/nomba.service";
import {
  emitMerchantWebhook,
  type MerchantWebhookEventType,
} from "../webhook-endpoints/merchant-webhooks.service";
import { addBillingInterval, addDays } from "./billing-dates";
import {
  cancelSubscriptionSchema,
  createSubscriptionSchema,
  listSubscriptionsQuerySchema,
  subscriptionIdParamsSchema,
} from "./subscriptions.schema";
import { subscriptionTransitionData } from "./subscriptions.state";

export const subscriptionsRouter = Router();

subscriptionsRouter.use(businessApiKeyMiddleware);

subscriptionsRouter.post(
  "/",
  validate({ body: createSubscriptionSchema }),
  idempotencyMiddleware,
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const apiKey = requireApiKey(req);

    const result = await prisma.$transaction(async (tx) => {
      const [customer, plan, paymentMethod] = await Promise.all([
        tx.customer.findFirst({
          where: {
            id: req.body.customerId,
            businessId: business.id,
            mode: apiKey.mode,
          },
        }),
        tx.plan.findFirst({
          where: {
            id: req.body.planId,
            businessId: business.id,
            mode: apiKey.mode,
          },
        }),
        tx.paymentMethod.findFirst({
          where: {
            id: req.body.paymentMethodId,
            businessId: business.id,
            mode: apiKey.mode,
          },
        }),
      ]);

      if (!customer) {
        throw new ApiError(404, "Customer not found");
      }

      if (!plan) {
        throw new ApiError(404, "Plan not found");
      }

      if (!paymentMethod) {
        throw new ApiError(404, "Payment method not found");
      }

      if (customer.status !== "ACTIVE") {
        throw new ApiError(409, "Customer is not active", [], "CUSTOMER_NOT_ACTIVE");
      }

      if (plan.status !== "ACTIVE") {
        throw new ApiError(409, "Plan is not active", [], "PLAN_NOT_ACTIVE");
      }

      if (
        paymentMethod.customerId !== customer.id ||
        paymentMethod.status !== "ACTIVE" ||
        !paymentMethod.reusable ||
        !paymentMethod.providerPaymentMethodReference ||
        !paymentMethod.providerCustomerReference
      ) {
        throw new ApiError(
          409,
          "Payment method is not active and reusable",
          [],
          "PAYMENT_METHOD_NOT_USABLE"
        );
      }

      const duplicate = await tx.subscription.findFirst({
        where: {
          businessId: business.id,
          mode: apiKey.mode,
          customerId: customer.id,
          planId: plan.id,
          status: {
            in: ["INCOMPLETE", "TRIALING", "ACTIVE", "PAST_DUE", "PAUSED"],
          },
        },
      });

      if (duplicate) {
        throw new ApiError(
          409,
          "Customer already has an open subscription for this plan",
          [{ subscriptionId: duplicate.id }],
          "DUPLICATE_SUBSCRIPTION"
        );
      }

      const now = new Date();
      const trialDays = req.body.trialDays ?? plan.trialDays;
      const hasTrial = trialDays > 0;
      const currentPeriodEnd = hasTrial
        ? addDays(now, trialDays)
        : addBillingInterval(now, plan.interval, plan.intervalCount);

      const subscription = await tx.subscription.create({
        data: {
          businessId: business.id,
          mode: apiKey.mode,
          customerId: customer.id,
          planId: plan.id,
          paymentMethodId: paymentMethod.id,
          status: hasTrial ? "TRIALING" : "INCOMPLETE",
          currentPeriodStart: now,
          currentPeriodEnd,
          nextBillingAt: hasTrial ? currentPeriodEnd : null,
          trialEndsAt: hasTrial ? currentPeriodEnd : null,
          metadata: req.body.metadata as Prisma.InputJsonValue,
        },
      });

      if (hasTrial) {
        return { subscription, invoice: null, paymentAttempt: null, paymentMethod };
      }

      const invoice = await tx.invoice.create({
        data: {
          businessId: business.id,
          mode: apiKey.mode,
          subscriptionId: subscription.id,
          customerId: customer.id,
          status: "OPEN",
          amountDueMinor: plan.amountMinor,
          currency: plan.currency,
          dueAt: now,
          periodStart: now,
          periodEnd: currentPeriodEnd,
          items: {
            create: [
              {
                businessId: business.id,
                subscriptionId: subscription.id,
                planId: plan.id,
                description: plan.name,
                amountMinor: plan.amountMinor,
                currency: plan.currency,
                periodStart: now,
                periodEnd: currentPeriodEnd,
                metadata: {
                  planCode: plan.code,
                  interval: plan.interval,
                  intervalCount: plan.intervalCount,
                },
              },
            ],
          },
        },
        include: { items: true },
      });

      const paymentAttempt = await tx.paymentAttempt.create({
        data: {
          businessId: business.id,
          mode: apiKey.mode,
          subscriptionId: subscription.id,
          invoiceId: invoice.id,
          customerId: customer.id,
          paymentMethodId: paymentMethod.id,
          provider: "NOMBA",
          amountMinor: plan.amountMinor,
          currency: plan.currency,
          status: "PENDING",
          attemptNumber: 1,
        },
      });

      return { subscription, invoice, paymentAttempt, paymentMethod };
    });

    const paymentResult = await processInitialPaymentAttempt(result);

    await writeAuditLog({
      businessId: business.id,
      action: "subscription.created",
      entity: "subscription",
      entityId: result.subscription.id,
      metadata: { mode: apiKey.mode },
    });

    const finalSubscription = paymentResult.subscription ?? result.subscription;
    void emitMerchantWebhook({
      businessId: business.id,
      type: "subscription.created",
      data: {
        subscription: finalSubscription,
        invoice: paymentResult.invoice,
        paymentAttempt: paymentResult.paymentAttempt,
      },
    }).catch((error) => {
      console.error("Failed to emit subscription.created webhook", error);
    });

    const statusEvent = subscriptionStatusWebhookEvent(finalSubscription.status);
    if (statusEvent) {
      void emitMerchantWebhook({
        businessId: business.id,
        type: statusEvent,
        data: {
          subscription: finalSubscription,
          invoice: paymentResult.invoice,
          paymentAttempt: paymentResult.paymentAttempt,
        },
      }).catch((error) => {
        console.error(`Failed to emit ${statusEvent} webhook`, error);
      });
    }

    sendSuccess(
      res,
      201,
      "Subscription created",
      sanitizeSubscriptionCreateResult(paymentResult)
    );
  })
);

function subscriptionStatusWebhookEvent(
  status: string
): MerchantWebhookEventType | null {
  switch (status) {
    case "TRIALING":
      return "subscription.trialing";
    case "ACTIVE":
      return "subscription.active";
    case "PAST_DUE":
      return "subscription.past_due";
    case "CANCELLED":
      return "subscription.cancelled";
    default:
      return null;
  }
}

function sanitizeSubscriptionCreateResult<T extends {
  paymentMethod?: unknown;
  paymentProviderResult?: { raw?: unknown } & Record<string, unknown>;
  verificationResult?: { raw?: unknown } & Record<string, unknown>;
}>(result: T) {
  const { paymentMethod: _paymentMethod, ...safeResult } = result;
  const { raw: _chargeRaw, ...paymentProviderResult } =
    result.paymentProviderResult ?? {};
  const { raw: _verificationRaw, ...verificationResult } =
    result.verificationResult ?? {};

  return {
    ...safeResult,
    ...(result.paymentProviderResult ? { paymentProviderResult } : {}),
    ...(result.verificationResult ? { verificationResult } : {}),
  };
}

async function processInitialPaymentAttempt<T extends {
  subscription: {
    id: string;
    businessId: string;
    mode: "TEST" | "LIVE";
    status:
      | "INCOMPLETE"
      | "TRIALING"
      | "ACTIVE"
      | "PAST_DUE"
      | "PAUSED"
      | "CANCELLED"
      | "EXPIRED";
    currentPeriodEnd: Date;
  };
  invoice: { id: string } | null;
  paymentAttempt: { id: string; amountMinor: number; currency: string } | null;
  paymentMethod: {
    providerPaymentMethodReference: string | null;
    providerCustomerReference: string | null;
    customerId: string;
  };
}>(result: T) {
  if (!result.invoice || !result.paymentAttempt) {
    return result;
  }

  const providerReference = `recur_attempt_${result.paymentAttempt.id}`;

  await prisma.$transaction([
    prisma.paymentAttempt.update({
      where: { id: result.paymentAttempt.id },
      data: {
        providerReference,
        status: "PROCESSING",
      },
    }),
    prisma.invoice.update({
      where: { id: result.invoice.id },
      data: { status: "PAYMENT_PROCESSING" },
    }),
  ]);

  try {
    const charge = await paymentProvider.chargeTokenizedCard({
      businessId: result.subscription.businessId,
      mode: result.subscription.mode,
      customerId: result.paymentMethod.customerId,
      providerCustomerReference: result.paymentMethod.providerCustomerReference!,
      paymentMethodReference: result.paymentMethod.providerPaymentMethodReference!,
      reference: providerReference,
      amountMinor: result.paymentAttempt.amountMinor,
      currency: result.paymentAttempt.currency,
      metadata: {
        recurrSubscriptionId: result.subscription.id,
        recurrInvoiceId: result.invoice.id,
        recurrPaymentAttemptId: result.paymentAttempt.id,
      },
    });

    if (charge.status === "SUCCEEDED") {
      const verified = await paymentProvider.getTransaction(providerReference);
      if (!/success|successful|succeeded|paid|approved/i.test(verified.status)) {
        return {
          ...result,
          paymentProviderResult: charge,
          verificationResult: verified,
        };
      }

      const [subscription, invoice, paymentAttempt] = await prisma.$transaction([
        prisma.subscription.update({
          where: { id: result.subscription.id },
          data: {
            ...subscriptionTransitionData(result.subscription.status, "ACTIVE"),
            nextBillingAt: result.subscription.currentPeriodEnd,
          },
        }),
        prisma.invoice.update({
          where: { id: result.invoice.id },
          data: {
            status: "PAID",
            paidAt: new Date(),
            amountPaidMinor: result.paymentAttempt.amountMinor,
          },
        }),
        prisma.paymentAttempt.update({
          where: { id: result.paymentAttempt.id },
          data: {
            status: "SUCCEEDED",
            processedAt: new Date(),
          },
        }),
      ]);

      return {
        ...result,
        subscription,
        invoice,
        paymentAttempt,
        paymentProviderResult: charge,
        verificationResult: verified,
      };
    }

    if (charge.status === "FAILED") {
      const [invoice, paymentAttempt] = await prisma.$transaction([
        prisma.invoice.update({
          where: { id: result.invoice.id },
          data: { status: "PAYMENT_FAILED" },
        }),
        prisma.paymentAttempt.update({
          where: { id: result.paymentAttempt.id },
          data: {
            status: "FAILED",
            failureReason: charge.failureReason,
            processedAt: new Date(),
          },
        }),
      ]);

      const dunningAttempt = await scheduleNextDunningAttempt({
        businessId: result.subscription.businessId,
        subscriptionId: result.subscription.id,
        invoiceId: result.invoice.id,
        customerId: result.paymentMethod.customerId,
        mode: result.subscription.mode,
        failureReason: charge.failureReason,
        metadata: {
          source: "subscription_initial_charge",
          paymentAttemptId: result.paymentAttempt.id,
        },
      });

      return {
        ...result,
        invoice,
        paymentAttempt,
        dunningAttempt,
        paymentProviderResult: charge,
      };
    }

    const paymentAttempt = await prisma.paymentAttempt.update({
      where: { id: result.paymentAttempt.id },
      data: {
        status:
          charge.status === "REQUIRES_ACTION" ? "REQUIRES_ACTION" : "PROCESSING",
      },
    });

    return {
      ...result,
      paymentAttempt,
      paymentProviderResult: charge,
    };
  } catch (error) {
    const paymentAttempt = await prisma.paymentAttempt.update({
      where: { id: result.paymentAttempt.id },
      data: {
        status: "PENDING",
        failureReason:
          error instanceof Error ? error.message : "Nomba charge request failed",
      },
    });

    return {
      ...result,
      paymentAttempt,
      paymentProviderError:
        error instanceof Error ? error.message : "Nomba charge request failed",
    };
  }
}

subscriptionsRouter.get(
  "/",
  validate({ query: listSubscriptionsQuerySchema }),
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const apiKey = requireApiKey(req);
    const query = req.validatedQuery as typeof listSubscriptionsQuerySchema._output;

    const subscriptions = await prisma.subscription.findMany({
      where: {
        businessId: business.id,
        mode: apiKey.mode,
        ...(query.status ? { status: query.status } : {}),
        ...(dateRangeFilter(query) ? { createdAt: dateRangeFilter(query) } : {}),
      },
      include: {
        customer: true,
        plan: true,
        paymentMethod: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...paginationArgs(query),
    });
    const page = paginateResults(subscriptions, query.limit);

    sendSuccess(res, 200, "Subscriptions returned", {
      subscriptions: page.data,
      pagination: page.pagination,
    });
  })
);

subscriptionsRouter.get(
  "/:id",
  validate({ params: subscriptionIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const apiKey = requireApiKey(req);

    const subscription = await prisma.subscription.findFirst({
      where: {
        id: String(req.params.id),
        businessId: business.id,
        mode: apiKey.mode,
      },
      include: {
        customer: true,
        plan: true,
        paymentMethod: true,
        invoices: {
          orderBy: [{ createdAt: "desc" }],
          include: { items: true, attempts: true },
        },
      },
    });

    if (!subscription) {
      throw new ApiError(404, "Subscription not found");
    }

    sendSuccess(res, 200, "Subscription returned", { subscription });
  })
);

async function transitionSubscription(
  req: Request,
  action: "pause" | "resume" | "cancel"
) {
  const business = requireBusiness(req);
  const apiKey = requireApiKey(req);
  const id = String(req.params.id);

  const existing = await prisma.subscription.findFirst({
    where: {
      id,
      businessId: business.id,
      mode: apiKey.mode,
    },
  });

  if (!existing) {
    throw new ApiError(404, "Subscription not found");
  }

  const targetStatus =
    action === "pause" ? "PAUSED" : action === "resume" ? "ACTIVE" : "CANCELLED";

  const subscription = await prisma.subscription.update({
    where: { id: existing.id },
    data: subscriptionTransitionData(existing.status, targetStatus),
  });

  await writeAuditLog({
    businessId: business.id,
    action: {
      pause: "subscription.paused",
      resume: "subscription.resumed",
      cancel: "subscription.cancelled",
    }[action],
    entity: "subscription",
    entityId: subscription.id,
    metadata: { from: existing.status, to: targetStatus, mode: apiKey.mode },
  });

  if (action === "cancel") {
    void emitMerchantWebhook({
      businessId: business.id,
      type: "subscription.cancelled",
      data: { subscription },
    }).catch((error) => {
      console.error("Failed to emit subscription.cancelled webhook", error);
    });
  }

  return subscription;
}

subscriptionsRouter.post(
  "/:id/pause",
  validate({ params: subscriptionIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const subscription = await transitionSubscription(req, "pause");
    sendSuccess(res, 200, "Subscription paused", { subscription });
  })
);

subscriptionsRouter.post(
  "/:id/resume",
  validate({ params: subscriptionIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const subscription = await transitionSubscription(req, "resume");
    sendSuccess(res, 200, "Subscription resumed", { subscription });
  })
);

subscriptionsRouter.post(
  "/:id/cancel",
  validate({ params: subscriptionIdParamsSchema, body: cancelSubscriptionSchema }),
  asyncHandler(async (req, res) => {
    if (!req.body.cancelAtPeriodEnd) {
      const subscription = await transitionSubscription(req, "cancel");
      sendSuccess(res, 200, "Subscription cancelled", { subscription });
      return;
    }

    const business = requireBusiness(req);
    const apiKey = requireApiKey(req);
    const id = String(req.params.id);

    const existing = await prisma.subscription.findFirst({
      where: {
        id,
        businessId: business.id,
        mode: apiKey.mode,
      },
    });

    if (!existing) {
      throw new ApiError(404, "Subscription not found");
    }

    if (["CANCELLED", "EXPIRED"].includes(existing.status)) {
      throw new ApiError(
        409,
        "Subscription is already cancelled or expired",
        [],
        "SUBSCRIPTION_NOT_CANCELLABLE"
      );
    }

    const subscription = await prisma.subscription.update({
      where: { id: existing.id },
      data: {
        cancelAtPeriodEnd: true,
      },
    });

    await writeAuditLog({
      businessId: business.id,
      action: "subscription.cancel_scheduled",
      entity: "subscription",
      entityId: subscription.id,
      metadata: {
        mode: apiKey.mode,
        currentPeriodEnd: subscription.currentPeriodEnd,
      },
    });

    sendSuccess(res, 200, "Subscription will cancel at period end", {
      subscription,
    });
  })
);
