import { Router } from "express";
import type { Request } from "express";
import { Prisma } from "../../generated/prisma/client";
import {
  advisoryLockKey,
  tryAcquireTransactionAdvisoryLock,
} from "../../lib/advisory-lock";
import { asyncHandler } from "../../lib/async-handler";
import { writeAuditLog } from "../../lib/audit";
import { ApiError, requireBusiness, requireBusinessMode } from "../../lib/errors";
import {
  dateRangeFilter,
  paginateResults,
  paginationArgs,
} from "../../lib/pagination";
import { prisma } from "../../lib/prisma";
import { sendSuccess } from "../../lib/responses";
import { businessResourceAuthMiddleware } from "../../middlewares/business-resource-auth.middleware";
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
  changeSubscriptionPlanSchema,
  createSubscriptionSchema,
  listSubscriptionsQuerySchema,
  subscriptionIdParamsSchema,
} from "./subscriptions.schema";
import { subscriptionTransitionData } from "./subscriptions.state";

export const subscriptionsRouter = Router();

subscriptionsRouter.use(businessResourceAuthMiddleware);

subscriptionsRouter.post(
  "/",
  validate({ body: createSubscriptionSchema }),
  idempotencyMiddleware,
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const mode = requireBusinessMode(req);

    const result = await prisma.$transaction(async (tx) => {
      const [customer, plan, paymentMethod] = await Promise.all([
        tx.customer.findFirst({
          where: {
            id: req.body.customerId,
            businessId: business.id,
            mode: mode,
          },
        }),
        tx.plan.findFirst({
          where: {
            id: req.body.planId,
            businessId: business.id,
            mode: mode,
          },
        }),
        tx.paymentMethod.findFirst({
          where: {
            id: req.body.paymentMethodId,
            businessId: business.id,
            mode: mode,
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
          mode: mode,
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
          mode: mode,
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
          mode: mode,
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
          mode: mode,
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
      metadata: { mode: mode },
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

type ChangePlanPaymentInput = {
  subscription: {
    id: string;
    businessId: string;
    customerId: string;
    mode: "TEST" | "LIVE";
    status:
      | "INCOMPLETE"
      | "TRIALING"
      | "ACTIVE"
      | "PAST_DUE"
      | "PAUSED"
      | "CANCELLED"
      | "EXPIRED";
  };
  invoice: { id: string } | null;
  paymentAttempt: { id: string; amountMinor: number; currency: string } | null;
  paymentMethod?: {
    customerId: string;
    providerPaymentMethodReference: string | null;
    providerCustomerReference: string | null;
  };
  oldPlan: { id: string };
  newPlan: { id: string };
};

function compatibleForImmediateProration(input: {
  oldPlan: {
    currency: string;
    interval: string;
    intervalCount: number;
  };
  newPlan: {
    currency: string;
    interval: string;
    intervalCount: number;
  };
}) {
  return (
    input.oldPlan.currency === input.newPlan.currency &&
    input.oldPlan.interval === input.newPlan.interval &&
    input.oldPlan.intervalCount === input.newPlan.intervalCount
  );
}

function calculateProrationAmountMinor(input: {
  oldAmountMinor: number;
  newAmountMinor: number;
  periodStart: Date;
  periodEnd: Date;
  now: Date;
}) {
  const totalMs = Math.max(
    1,
    input.periodEnd.getTime() - input.periodStart.getTime()
  );
  const remainingMs = Math.min(
    totalMs,
    Math.max(0, input.periodEnd.getTime() - input.now.getTime())
  );
  const amountDifferenceMinor = input.newAmountMinor - input.oldAmountMinor;
  const amountMinor = Math.max(
    0,
    Math.ceil((amountDifferenceMinor * remainingMs) / totalMs)
  );

  return {
    amountMinor,
    remainingMs,
    totalMs,
    remainingRatio: remainingMs / totalMs,
  };
}

async function processPlanChangePayment<T extends ChangePlanPaymentInput>(
  result: T
) {
  if (!result.invoice || !result.paymentAttempt) {
    return result;
  }

  if (!result.paymentMethod) {
    throw new ApiError(
      409,
      "Payment method is required for immediate plan upgrade",
      [],
      "PAYMENT_METHOD_REQUIRED"
    );
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
        source: "subscription_plan_change",
        recurrSubscriptionId: result.subscription.id,
        recurrInvoiceId: result.invoice.id,
        recurrPaymentAttemptId: result.paymentAttempt.id,
        oldPlanId: result.oldPlan.id,
        newPlanId: result.newPlan.id,
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
          data: { planId: result.newPlan.id },
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
        action: "CHANGED",
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

      return {
        ...result,
        action: "PAYMENT_FAILED",
        invoice,
        paymentAttempt,
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

subscriptionsRouter.post(
  "/:id/change-plan",
  validate({
    params: subscriptionIdParamsSchema,
    body: changeSubscriptionPlanSchema,
  }),
  idempotencyMiddleware,
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const mode = requireBusinessMode(req);
    const now = new Date();

    const result = await prisma.$transaction(async (tx) => {
      const locked = await tryAcquireTransactionAdvisoryLock(
        tx,
        advisoryLockKey("subscription-change-plan", String(req.params.id))
      );

      if (!locked) {
        throw new ApiError(
          409,
          "Subscription plan change is already being processed",
          [],
          "SUBSCRIPTION_CHANGE_IN_PROGRESS"
        );
      }

      const subscription = await tx.subscription.findFirst({
        where: {
          id: String(req.params.id),
          businessId: business.id,
          mode: mode,
        },
        include: {
          plan: true,
          paymentMethod: true,
          customer: true,
        },
      });

      if (!subscription) {
        throw new ApiError(404, "Subscription not found");
      }

      if (subscription.status !== "ACTIVE") {
        throw new ApiError(
          409,
          "Only active subscriptions can change plan",
          [],
          "SUBSCRIPTION_NOT_ACTIVE"
        );
      }

      const newPlan = await tx.plan.findFirst({
        where: {
          id: req.body.newPlanId,
          businessId: business.id,
          mode: mode,
        },
      });

      if (!newPlan) {
        throw new ApiError(404, "New plan not found");
      }

      if (newPlan.status !== "ACTIVE") {
        throw new ApiError(409, "New plan is not active", [], "PLAN_NOT_ACTIVE");
      }

      if (newPlan.id === subscription.planId) {
        throw new ApiError(
          409,
          "Subscription is already on this plan",
          [],
          "SUBSCRIPTION_ALREADY_ON_PLAN"
        );
      }

      if (newPlan.currency !== subscription.plan.currency) {
        throw new ApiError(
          409,
          "Plan currency must match current subscription currency",
          [],
          "PLAN_CURRENCY_MISMATCH"
        );
      }

      const isDowngrade = newPlan.amountMinor < subscription.plan.amountMinor;
      const scheduleForPeriodEnd =
        req.body.effective === "PERIOD_END" || isDowngrade;

      if (scheduleForPeriodEnd) {
        await tx.subscriptionScheduleChange.updateMany({
          where: {
            subscriptionId: subscription.id,
            status: "PENDING",
          },
          data: {
            status: "CANCELLED",
            cancelledAt: now,
          },
        });

        const scheduledChange = await tx.subscriptionScheduleChange.create({
          data: {
            businessId: business.id,
            mode: mode,
            subscriptionId: subscription.id,
            fromPlanId: subscription.planId,
            toPlanId: newPlan.id,
            effectiveAt: subscription.currentPeriodEnd,
            metadata: {
              ...(req.body.metadata ?? {}),
              requestedEffective: req.body.effective,
              reason: isDowngrade
                ? "downgrade_scheduled_for_period_end"
                : "merchant_requested_period_end",
            },
          },
        });

        return {
          action: "SCHEDULED",
          subscription,
          scheduledChange,
          oldPlan: subscription.plan,
          newPlan,
          invoice: null,
          paymentAttempt: null,
        };
      }

      if (
        !compatibleForImmediateProration({
          oldPlan: subscription.plan,
          newPlan,
        })
      ) {
        throw new ApiError(
          409,
          "Immediate proration requires plans with the same currency and billing interval",
          [],
          "PLAN_INTERVAL_MISMATCH"
        );
      }

      const proration =
        req.body.prorationBehavior === "NONE"
          ? {
              amountMinor: 0,
              remainingMs: 0,
              totalMs: 0,
              remainingRatio: 0,
            }
          : calculateProrationAmountMinor({
              oldAmountMinor: subscription.plan.amountMinor,
              newAmountMinor: newPlan.amountMinor,
              periodStart: subscription.currentPeriodStart,
              periodEnd: subscription.currentPeriodEnd,
              now,
            });

      await tx.subscriptionScheduleChange.updateMany({
        where: {
          subscriptionId: subscription.id,
          status: "PENDING",
        },
        data: {
          status: "CANCELLED",
          cancelledAt: now,
        },
      });

      if (proration.amountMinor <= 0) {
        const updatedSubscription = await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            planId: newPlan.id,
            metadata: {
              ...((subscription.metadata as Record<string, unknown> | null) ?? {}),
              lastPlanChange: {
                oldPlanId: subscription.planId,
                newPlanId: newPlan.id,
                changedAt: now.toISOString(),
                prorationBehavior: req.body.prorationBehavior,
              },
            },
          },
        });

        return {
          action: "CHANGED",
          subscription: updatedSubscription,
          oldPlan: subscription.plan,
          newPlan,
          proration,
          invoice: null,
          paymentAttempt: null,
        };
      }

      const paymentMethod = subscription.paymentMethod;
      if (
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

      const invoice = await tx.invoice.create({
        data: {
          businessId: business.id,
          mode: mode,
          subscriptionId: subscription.id,
          customerId: subscription.customerId,
          status: "OPEN",
          amountDueMinor: proration.amountMinor,
          currency: newPlan.currency,
          dueAt: now,
          periodStart: now,
          periodEnd: subscription.currentPeriodEnd,
          metadata: {
            type: "PLAN_CHANGE_PRORATION",
            oldPlanId: subscription.planId,
            newPlanId: newPlan.id,
            proration,
            ...(req.body.metadata ?? {}),
          },
          items: {
            create: [
              {
                businessId: business.id,
                subscriptionId: subscription.id,
                planId: newPlan.id,
                description: `Proration: ${subscription.plan.name} to ${newPlan.name}`,
                amountMinor: proration.amountMinor,
                currency: newPlan.currency,
                periodStart: now,
                periodEnd: subscription.currentPeriodEnd,
                metadata: {
                  type: "PLAN_CHANGE_PRORATION",
                  oldPlanId: subscription.planId,
                  newPlanId: newPlan.id,
                  oldPlanAmountMinor: subscription.plan.amountMinor,
                  newPlanAmountMinor: newPlan.amountMinor,
                  proration,
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
          mode: mode,
          subscriptionId: subscription.id,
          invoiceId: invoice.id,
          customerId: subscription.customerId,
          paymentMethodId: paymentMethod.id,
          provider: "NOMBA",
          amountMinor: proration.amountMinor,
          currency: newPlan.currency,
          status: "PENDING",
          attemptNumber: 1,
        },
      });

      return {
        action: "PAYMENT_REQUIRED",
        subscription,
        oldPlan: subscription.plan,
        newPlan,
        proration,
        invoice,
        paymentAttempt,
        paymentMethod,
      };
    });

    const paymentResult = await processPlanChangePayment(result);

    await writeAuditLog({
      businessId: business.id,
      action:
        paymentResult.action === "SCHEDULED"
          ? "subscription.plan_change_scheduled"
          : "subscription.plan_changed",
      entity: "subscription",
      entityId: paymentResult.subscription.id,
      metadata: {
        mode: mode,
        oldPlanId: paymentResult.oldPlan.id,
        newPlanId: paymentResult.newPlan.id,
        action: paymentResult.action,
      },
    });

    if (paymentResult.action === "CHANGED") {
      void emitMerchantWebhook({
        businessId: business.id,
        type: "subscription.plan_changed",
        data: {
          subscription: paymentResult.subscription,
          oldPlan: paymentResult.oldPlan,
          newPlan: paymentResult.newPlan,
          invoice: paymentResult.invoice,
          paymentAttempt: paymentResult.paymentAttempt,
        },
      }).catch((error) => {
        console.error("Failed to emit subscription.plan_changed webhook", error);
      });
    }

    if (paymentResult.invoice && paymentResult.paymentAttempt) {
      const eventType =
        paymentResult.invoice.status === "PAID"
          ? "invoice.payment_succeeded"
          : paymentResult.invoice.status === "PAYMENT_FAILED"
            ? "invoice.payment_failed"
            : null;

      if (eventType) {
        void emitMerchantWebhook({
          businessId: business.id,
          type: eventType,
          data: {
            invoice: paymentResult.invoice,
            paymentAttempt: paymentResult.paymentAttempt,
            subscription: paymentResult.subscription,
          },
        }).catch((error) => {
          console.error(`Failed to emit ${eventType} webhook`, error);
        });
      }
    }

    sendSuccess(
      res,
      200,
      paymentResult.action === "SCHEDULED"
        ? "Subscription plan change scheduled"
        : paymentResult.action === "PAYMENT_FAILED"
          ? "Subscription plan change payment failed"
          : "Subscription plan changed",
      sanitizeSubscriptionCreateResult(paymentResult)
    );
  })
);

subscriptionsRouter.get(
  "/",
  validate({ query: listSubscriptionsQuerySchema }),
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const mode = requireBusinessMode(req);
    const query = req.validatedQuery as typeof listSubscriptionsQuerySchema._output;

    const subscriptions = await prisma.subscription.findMany({
      where: {
        businessId: business.id,
        mode: mode,
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
    const mode = requireBusinessMode(req);

    const subscription = await prisma.subscription.findFirst({
      where: {
        id: String(req.params.id),
        businessId: business.id,
        mode: mode,
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
  const mode = requireBusinessMode(req);
  const id = String(req.params.id);

  const existing = await prisma.subscription.findFirst({
    where: {
      id,
      businessId: business.id,
      mode: mode,
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
    metadata: { from: existing.status, to: targetStatus, mode: mode },
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
    const mode = requireBusinessMode(req);
    const id = String(req.params.id);

    const existing = await prisma.subscription.findFirst({
      where: {
        id,
        businessId: business.id,
        mode: mode,
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
        mode: mode,
        currentPeriodEnd: subscription.currentPeriodEnd,
      },
    });

    sendSuccess(res, 200, "Subscription will cancel at period end", {
      subscription,
    });
  })
);

