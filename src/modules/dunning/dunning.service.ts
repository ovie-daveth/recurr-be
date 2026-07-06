import type {
  ApiKeyMode,
  DunningFinalAction,
  Prisma,
} from "../../generated/prisma/client";
import {
  advisoryLockKey,
  tryAcquireTransactionAdvisoryLock,
} from "../../lib/advisory-lock";
import { incrementMetric, observeEvent } from "../../lib/observability";
import { prisma } from "../../lib/prisma";
import { paymentProvider } from "../nomba/nomba.service";
import { subscriptionTransitionData } from "../subscriptions/subscriptions.state";
import { emitMerchantWebhook } from "../webhook-endpoints/merchant-webhooks.service";

const DEFAULT_RETRY_DELAYS_MINUTES = [60, 1440, 4320, 10080];
const DEFAULT_FINAL_ACTION: DunningFinalAction = "PAUSE_SUBSCRIPTION";

function retryDelaysMinutes() {
  const configured = process.env.DUNNING_RETRY_DELAYS_MINUTES;
  if (!configured) {
    return DEFAULT_RETRY_DELAYS_MINUTES;
  }

  const parsed = configured
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);

  return parsed.length ? parsed : DEFAULT_RETRY_DELAYS_MINUTES;
}

function envFinalAction(): DunningFinalAction {
  const configured = process.env.DUNNING_FINAL_ACTION;
  return configured === "CANCEL_SUBSCRIPTION" ||
    configured === "PAUSE_SUBSCRIPTION" ||
    configured === "MARK_INVOICE_UNCOLLECTIBLE"
    ? configured
    : DEFAULT_FINAL_ACTION;
}

async function loadDunningPolicy(input: {
  businessId: string;
  mode: ApiKeyMode;
}) {
  const policy = await prisma.dunningPolicy.findFirst({
    where: {
      businessId: input.businessId,
      mode: input.mode,
      status: "ACTIVE",
      isDefault: true,
    },
    include: {
      steps: { orderBy: { attemptNumber: "asc" } },
    },
  });

  if (policy) {
    return policy;
  }

  const delays = retryDelaysMinutes();
  return {
    id: null,
    finalAction: envFinalAction(),
    steps: delays.map((delayMinutes, index) => ({
      attemptNumber: index + 1,
      delayMinutes,
      channel: "email",
    })),
  };
}

function addMinutes(date: Date, minutes: number) {
  const next = new Date(date);
  next.setMinutes(next.getMinutes() + minutes);
  return next;
}

export async function scheduleNextDunningAttempt(input: {
  businessId: string;
  subscriptionId: string;
  invoiceId: string;
  customerId: string;
  mode: ApiKeyMode;
  failureReason?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  const existingCount = await prisma.dunningAttempt.count({
    where: { invoiceId: input.invoiceId },
  });
  const attemptNumber = existingCount + 1;
  const policy = await loadDunningPolicy({
    businessId: input.businessId,
    mode: input.mode,
  });
  const step = policy.steps.find((item) => item.attemptNumber === attemptNumber);
  const delayMinutes = step?.delayMinutes;

  if (!delayMinutes) {
    const dunningAttempt = await prisma.dunningAttempt.create({
      data: {
        businessId: input.businessId,
        subscriptionId: input.subscriptionId,
        invoiceId: input.invoiceId,
        customerId: input.customerId,
        mode: input.mode,
        attemptNumber,
        status: "EXHAUSTED",
        scheduledAt: new Date(),
        failureReason:
          input.failureReason ?? "Dunning retry policy has been exhausted",
        metadata: {
          ...(typeof input.metadata === "object" && input.metadata !== null
            ? (input.metadata as Record<string, unknown>)
            : {}),
          dunningPolicyId: policy.id,
          finalAction: policy.finalAction,
        },
      },
    });

    const finalActionResult = await applyDunningFinalAction({
      businessId: input.businessId,
      subscriptionId: input.subscriptionId,
      invoiceId: input.invoiceId,
      mode: input.mode,
      finalAction: policy.finalAction,
      failureReason:
        input.failureReason ?? "Dunning retry policy has been exhausted",
    });
    incrementMetric("dunning.exhausted", {
      businessId: input.businessId,
      mode: input.mode,
      finalAction: policy.finalAction,
    });
    observeEvent("warn", "dunning.exhausted", {
      businessId: input.businessId,
      mode: input.mode,
      subscriptionId: input.subscriptionId,
      invoiceId: input.invoiceId,
      dunningAttemptId: dunningAttempt.id,
      attemptNumber,
      dunningPolicyId: policy.id,
      finalAction: policy.finalAction,
      finalActionResult,
    });

    void emitMerchantWebhook({
      businessId: input.businessId,
      type: "dunning.exhausted",
      data: { dunningAttempt, finalAction: finalActionResult },
    }).catch((error) => {
      console.error("Failed to emit dunning.exhausted webhook", error);
    });

    return dunningAttempt;
  }

  const dunningAttempt = await prisma.dunningAttempt.create({
    data: {
      businessId: input.businessId,
      subscriptionId: input.subscriptionId,
      invoiceId: input.invoiceId,
      customerId: input.customerId,
      mode: input.mode,
      attemptNumber,
      status: "SCHEDULED",
      scheduledAt: addMinutes(new Date(), delayMinutes),
      failureReason: input.failureReason,
      metadata: {
        ...(typeof input.metadata === "object" && input.metadata !== null
          ? (input.metadata as Record<string, unknown>)
          : {}),
        dunningPolicyId: policy.id,
        delayMinutes,
        channel: step.channel,
      },
    },
  });
  incrementMetric("dunning.retries_scheduled", {
    businessId: input.businessId,
    mode: input.mode,
  });
  observeEvent("info", "dunning.retry_scheduled", {
    businessId: input.businessId,
    mode: input.mode,
    subscriptionId: input.subscriptionId,
    invoiceId: input.invoiceId,
    dunningAttemptId: dunningAttempt.id,
    attemptNumber,
    delayMinutes,
    scheduledAt: dunningAttempt.scheduledAt,
    dunningPolicyId: policy.id,
  });

  void emitMerchantWebhook({
    businessId: input.businessId,
    type: "dunning.retry_scheduled",
    data: { dunningAttempt },
  }).catch((error) => {
    console.error("Failed to emit dunning.retry_scheduled webhook", error);
  });

  return dunningAttempt;
}

type RunDueDunningInput = {
  businessId: string;
  limit?: number;
  mode?: ApiKeyMode;
  subscriptionId?: string;
  invoiceId?: string;
  dunningAttemptId?: string;
  now?: Date;
  skipTransactionVerification?: boolean;
};

type DunningRunResult = {
  dunningAttemptId: string;
  invoiceId: string;
  subscriptionId: string;
  status: "PROCESSED" | "SKIPPED" | "FAILED";
  reason?: string;
  paymentAttemptId?: string;
  providerReference?: string;
  nextDunningAttemptId?: string;
};

function isUsablePaymentMethod(paymentMethod: {
  status: string;
  reusable: boolean;
  providerPaymentMethodReference: string | null;
  providerCustomerReference: string | null;
}) {
  return (
    paymentMethod.status === "ACTIVE" &&
    paymentMethod.reusable &&
    Boolean(paymentMethod.providerPaymentMethodReference) &&
    Boolean(paymentMethod.providerCustomerReference)
  );
}

function successfulStatus(status: string) {
  return /success|successful|succeeded|paid|approved/i.test(status);
}

async function applyDunningFinalAction(input: {
  businessId: string;
  subscriptionId: string;
  invoiceId: string;
  mode: ApiKeyMode;
  finalAction: DunningFinalAction;
  failureReason: string;
}) {
  const subscription = await prisma.subscription.findFirst({
    where: {
      id: input.subscriptionId,
      businessId: input.businessId,
      mode: input.mode,
    },
  });

  if (!subscription) {
    return {
      action: input.finalAction,
      applied: false,
      reason: "Subscription not found",
    };
  }

  if (["CANCELLED", "EXPIRED"].includes(subscription.status)) {
    await prisma.invoice.update({
      where: { id: input.invoiceId },
      data: {
        status:
          input.finalAction === "MARK_INVOICE_UNCOLLECTIBLE"
            ? "UNCOLLECTIBLE"
            : "PAYMENT_FAILED",
      },
    });

    return {
      action: input.finalAction,
      applied: true,
      reason: "Subscription was already terminal",
    };
  }

  if (input.finalAction === "MARK_INVOICE_UNCOLLECTIBLE") {
    const invoice = await prisma.invoice.update({
      where: { id: input.invoiceId },
      data: { status: "UNCOLLECTIBLE" },
    });

    return { action: input.finalAction, applied: true, invoice };
  }

  if (input.finalAction === "CANCEL_SUBSCRIPTION") {
    const [invoice, updatedSubscription] = await prisma.$transaction([
      prisma.invoice.update({
        where: { id: input.invoiceId },
        data: { status: "UNCOLLECTIBLE" },
      }),
      prisma.subscription.update({
        where: { id: subscription.id },
        data: subscriptionTransitionData(subscription.status, "CANCELLED"),
      }),
    ]);

    void emitMerchantWebhook({
      businessId: input.businessId,
      type: "subscription.cancelled",
      data: {
        subscription: updatedSubscription,
        invoice,
        reason: "Dunning policy exhausted",
      },
    }).catch((error) => {
      console.error("Failed to emit subscription.cancelled webhook", error);
    });

    return {
      action: input.finalAction,
      applied: true,
      invoice,
      subscription: updatedSubscription,
    };
  }

  const [invoice, updatedSubscription] = await prisma.$transaction([
    prisma.invoice.update({
      where: { id: input.invoiceId },
      data: { status: "PAYMENT_FAILED" },
    }),
    prisma.subscription.update({
      where: { id: subscription.id },
      data: subscriptionTransitionData(subscription.status, "PAUSED"),
    }),
  ]);

  return {
    action: input.finalAction,
    applied: true,
    invoice,
    subscription: updatedSubscription,
  };
}

export async function runDueDunning(input: RunDueDunningInput) {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 20;
  const results: DunningRunResult[] = [];

  const dunningAttempts = await prisma.dunningAttempt.findMany({
    where: {
      businessId: input.businessId,
      ...(input.dunningAttemptId ? { id: input.dunningAttemptId } : {}),
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.subscriptionId ? { subscriptionId: input.subscriptionId } : {}),
      ...(input.invoiceId ? { invoiceId: input.invoiceId } : {}),
      status: "SCHEDULED",
      scheduledAt: { lte: now },
    },
    include: {
      invoice: {
        include: {
          attempts: true,
          subscription: {
            include: {
              paymentMethod: true,
              plan: true,
            },
          },
          customer: true,
        },
      },
    },
    orderBy: [{ scheduledAt: "asc" }, { id: "asc" }],
    take: limit,
  });

  for (const dunningAttempt of dunningAttempts) {
    try {
      results.push(
        await processDunningAttempt({
          dunningAttempt,
          skipTransactionVerification: input.skipTransactionVerification ?? false,
        })
      );
    } catch (error) {
      results.push({
        dunningAttemptId: dunningAttempt.id,
        invoiceId: dunningAttempt.invoiceId,
        subscriptionId: dunningAttempt.subscriptionId,
        status: "FAILED",
        reason:
          error instanceof Error ? error.message : "Dunning retry processing failed",
      });
    }
  }

  return {
    processedAt: now,
    count: results.length,
    results,
  };
}

async function processDunningAttempt(input: {
  dunningAttempt: Awaited<ReturnType<typeof prisma.dunningAttempt.findMany>>[number] & {
    invoice: {
      id: string;
      businessId: string;
      subscriptionId: string;
      customerId: string;
      mode: ApiKeyMode;
      status: string;
      amountDueMinor: number;
      amountPaidMinor: number;
      currency: string;
      attempts: Array<{ attemptNumber: number }>;
      customer: { id: string; status: string };
      subscription: {
        id: string;
        businessId: string;
        customerId: string;
        paymentMethodId: string;
        mode: ApiKeyMode;
        status:
          | "INCOMPLETE"
          | "TRIALING"
          | "ACTIVE"
          | "PAST_DUE"
          | "PAUSED"
          | "CANCELLED"
          | "EXPIRED";
        currentPeriodEnd: Date;
        paymentMethod: {
          id: string;
          status: string;
          reusable: boolean;
          providerPaymentMethodReference: string | null;
          providerCustomerReference: string | null;
        };
      };
    };
  };
  skipTransactionVerification: boolean;
}): Promise<DunningRunResult> {
  const { dunningAttempt } = input;
  const { invoice } = dunningAttempt;
  const subscription = invoice.subscription;
  const paymentMethod = subscription.paymentMethod;

  if (invoice.status === "PAID") {
    await prisma.dunningAttempt.update({
      where: { id: dunningAttempt.id },
      data: {
        status: "CANCELLED",
        processedAt: new Date(),
        failureReason: "Invoice is already paid",
      },
    });

    return {
      dunningAttemptId: dunningAttempt.id,
      invoiceId: invoice.id,
      subscriptionId: subscription.id,
      status: "SKIPPED",
      reason: "Invoice is already paid",
    };
  }

  if (invoice.status === "PAYMENT_PROCESSING") {
    return {
      dunningAttemptId: dunningAttempt.id,
      invoiceId: invoice.id,
      subscriptionId: subscription.id,
      status: "SKIPPED",
      reason: "Invoice already has a payment in progress",
    };
  }

  const remainingAmount = invoice.amountDueMinor - invoice.amountPaidMinor;
  if (remainingAmount <= 0) {
    await prisma.dunningAttempt.update({
      where: { id: dunningAttempt.id },
      data: {
        status: "CANCELLED",
        processedAt: new Date(),
        failureReason: "Invoice has no remaining amount",
      },
    });

    return {
      dunningAttemptId: dunningAttempt.id,
      invoiceId: invoice.id,
      subscriptionId: subscription.id,
      status: "SKIPPED",
      reason: "Invoice has no remaining amount",
    };
  }

  if (invoice.customer.status !== "ACTIVE") {
    const nextDunningAttempt = await failDunningAndScheduleNext({
      dunningAttemptId: dunningAttempt.id,
      invoice,
      subscription,
      failureReason: "Customer is not active",
      metadata: { source: "dunning_retry_customer_inactive" },
    });

    return {
      dunningAttemptId: dunningAttempt.id,
      invoiceId: invoice.id,
      subscriptionId: subscription.id,
      status: "SKIPPED",
      reason: "Customer is not active",
      nextDunningAttemptId: nextDunningAttempt?.id,
    };
  }

  if (!isUsablePaymentMethod(paymentMethod)) {
    const nextDunningAttempt = await failDunningAndScheduleNext({
      dunningAttemptId: dunningAttempt.id,
      invoice,
      subscription,
      failureReason: "Payment method is not active and reusable",
      metadata: { source: "dunning_retry_payment_method_unusable" },
    });

    return {
      dunningAttemptId: dunningAttempt.id,
      invoiceId: invoice.id,
      subscriptionId: subscription.id,
      status: "SKIPPED",
      reason: "Payment method is not active and reusable",
      nextDunningAttemptId: nextDunningAttempt?.id,
    };
  }

  const attemptNumber =
    Math.max(0, ...invoice.attempts.map((attempt) => attempt.attemptNumber)) + 1;

  const claim = await prisma.$transaction(async (tx) => {
    const locked = await tryAcquireTransactionAdvisoryLock(
      tx,
      advisoryLockKey("dunning-attempt", dunningAttempt.id)
    );

    if (!locked) {
      return {
        skipped: {
          reason: "Dunning attempt is already being processed",
        },
      };
    }

    const freshDunningAttempt = await tx.dunningAttempt.findUnique({
      where: { id: dunningAttempt.id },
      select: { status: true, scheduledAt: true },
    });

    if (!freshDunningAttempt) {
      return {
        skipped: {
          reason: "Dunning attempt no longer exists",
        },
      };
    }

    if (freshDunningAttempt.status !== "SCHEDULED") {
      return {
        skipped: {
          reason: "Dunning attempt is no longer scheduled",
        },
      };
    }

    if (freshDunningAttempt.scheduledAt.getTime() > Date.now()) {
      return {
        skipped: {
          reason: "Dunning attempt is no longer due",
        },
      };
    }

    await tx.dunningAttempt.update({
      where: { id: dunningAttempt.id },
      data: { status: "PROCESSING" },
    });

    const createdPaymentAttempt = await tx.paymentAttempt.create({
      data: {
        businessId: invoice.businessId,
        mode: invoice.mode,
        subscriptionId: invoice.subscriptionId,
        invoiceId: invoice.id,
        customerId: invoice.customerId,
        paymentMethodId: paymentMethod.id,
        provider: "NOMBA",
        amountMinor: remainingAmount,
        currency: invoice.currency,
        status: "PENDING",
        attemptNumber,
      },
    });

    await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: "PAYMENT_PROCESSING" },
    });

    return { paymentAttempt: createdPaymentAttempt };
  });

  if (!("paymentAttempt" in claim)) {
    const skipped = claim.skipped;
    return {
      dunningAttemptId: dunningAttempt.id,
      invoiceId: invoice.id,
      subscriptionId: subscription.id,
      status: "SKIPPED",
      reason: skipped.reason,
    };
  }

  const { paymentAttempt } = claim;
  if (!paymentAttempt) {
    throw new Error("Dunning claim did not return a payment attempt");
  }

  const providerReference = `recur_attempt_${paymentAttempt.id}`;

  await prisma.paymentAttempt.update({
    where: { id: paymentAttempt.id },
    data: { providerReference, status: "PROCESSING" },
  });

  try {
    const charge = await paymentProvider.chargeTokenizedCard({
      businessId: invoice.businessId,
      mode: invoice.mode,
      customerId: invoice.customerId,
      providerCustomerReference: paymentMethod.providerCustomerReference!,
      paymentMethodReference: paymentMethod.providerPaymentMethodReference!,
      reference: providerReference,
      amountMinor: remainingAmount,
      currency: invoice.currency,
      metadata: {
        source: "dunning_retry",
        recurrInvoiceId: invoice.id,
        recurrSubscriptionId: subscription.id,
        recurrPaymentAttemptId: paymentAttempt.id,
        recurrDunningAttemptId: dunningAttempt.id,
      },
    });

    if (charge.status === "SUCCEEDED") {
      if (!input.skipTransactionVerification) {
        const verification = await paymentProvider.getTransaction(providerReference);
        if (!successfulStatus(verification.status)) {
          return {
            dunningAttemptId: dunningAttempt.id,
            invoiceId: invoice.id,
            subscriptionId: subscription.id,
            status: "PROCESSED",
            reason: "Charge succeeded but transaction verification is pending",
            paymentAttemptId: paymentAttempt.id,
            providerReference,
          };
        }
      }

      const settled = await prisma.$transaction(async (tx) => {
        const updatedPaymentAttempt = await tx.paymentAttempt.update({
          where: { id: paymentAttempt.id },
          data: { status: "SUCCEEDED", processedAt: new Date() },
        });
        const updatedInvoice = await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            status: "PAID",
            amountPaidMinor: invoice.amountDueMinor,
            paidAt: new Date(),
          },
        });
        const updatedSubscription = await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            ...subscriptionTransitionData(subscription.status, "ACTIVE"),
            nextBillingAt: subscription.currentPeriodEnd,
          },
        });
        const updatedDunningAttempt = await tx.dunningAttempt.update({
          where: { id: dunningAttempt.id },
          data: { status: "SUCCEEDED", processedAt: new Date() },
        });

        return {
          paymentAttempt: updatedPaymentAttempt,
          invoice: updatedInvoice,
          subscription: updatedSubscription,
          dunningAttempt: updatedDunningAttempt,
        };
      });
      incrementMetric("payments.charges_succeeded", {
        businessId: invoice.businessId,
        mode: invoice.mode,
        source: "dunning_worker",
      });
      observeEvent("info", "payments.charge_succeeded", {
        businessId: invoice.businessId,
        mode: invoice.mode,
        source: "dunning_worker",
        subscriptionId: subscription.id,
        invoiceId: invoice.id,
        paymentAttemptId: paymentAttempt.id,
        dunningAttemptId: dunningAttempt.id,
        providerReference,
        amountMinor: remainingAmount,
        currency: invoice.currency,
      });

      void emitMerchantWebhook({
        businessId: invoice.businessId,
        type: "invoice.payment_succeeded",
        data: settled,
      }).catch((error) => {
        console.error("Failed to emit invoice.payment_succeeded webhook", error);
      });

      void emitMerchantWebhook({
        businessId: invoice.businessId,
        type: "subscription.active",
        data: { subscription: settled.subscription },
      }).catch((error) => {
        console.error("Failed to emit subscription.active webhook", error);
      });

      return {
        dunningAttemptId: dunningAttempt.id,
        invoiceId: invoice.id,
        subscriptionId: subscription.id,
        status: "PROCESSED",
        reason: "Dunning retry recovered payment",
        paymentAttemptId: paymentAttempt.id,
        providerReference,
      };
    }

    if (charge.status === "FAILED") {
      incrementMetric("payments.charges_failed", {
        businessId: invoice.businessId,
        mode: invoice.mode,
        source: "dunning_worker",
      });
      observeEvent("warn", "payments.charge_failed", {
        businessId: invoice.businessId,
        mode: invoice.mode,
        source: "dunning_worker",
        subscriptionId: subscription.id,
        invoiceId: invoice.id,
        paymentAttemptId: paymentAttempt.id,
        dunningAttemptId: dunningAttempt.id,
        providerReference,
        failureReason: charge.failureReason,
      });
      const nextDunningAttempt = await markChargeFailedAndScheduleNext({
        invoice,
        subscription,
        paymentAttemptId: paymentAttempt.id,
        dunningAttemptId: dunningAttempt.id,
        failureReason: charge.failureReason ?? "Dunning retry charge failed",
      });

      return {
        dunningAttemptId: dunningAttempt.id,
        invoiceId: invoice.id,
        subscriptionId: subscription.id,
        status: "PROCESSED",
        reason: "Dunning retry failed",
        paymentAttemptId: paymentAttempt.id,
        providerReference,
        nextDunningAttemptId: nextDunningAttempt?.id,
      };
    }

    await prisma.paymentAttempt.update({
      where: { id: paymentAttempt.id },
      data: {
        status:
          charge.status === "REQUIRES_ACTION" ? "REQUIRES_ACTION" : "PROCESSING",
      },
    });

    return {
      dunningAttemptId: dunningAttempt.id,
      invoiceId: invoice.id,
      subscriptionId: subscription.id,
      status: "PROCESSED",
      reason: `Dunning retry charge is ${charge.status}`,
      paymentAttemptId: paymentAttempt.id,
      providerReference,
    };
  } catch (error) {
    const failureReason =
      error instanceof Error ? error.message : "Dunning retry provider request failed";
    incrementMetric("payments.charges_failed", {
      businessId: invoice.businessId,
      mode: invoice.mode,
      source: "dunning_worker",
    });
    observeEvent("error", "payments.charge_failed", {
      businessId: invoice.businessId,
      mode: invoice.mode,
      source: "dunning_worker",
      subscriptionId: subscription.id,
      invoiceId: invoice.id,
      paymentAttemptId: paymentAttempt.id,
      dunningAttemptId: dunningAttempt.id,
      providerReference,
      failureReason,
    });
    const nextDunningAttempt = await markChargeFailedAndScheduleNext({
      invoice,
      subscription,
      paymentAttemptId: paymentAttempt.id,
      dunningAttemptId: dunningAttempt.id,
      failureReason,
    });

    return {
      dunningAttemptId: dunningAttempt.id,
      invoiceId: invoice.id,
      subscriptionId: subscription.id,
      status: "FAILED",
      reason: failureReason,
      paymentAttemptId: paymentAttempt.id,
      providerReference,
      nextDunningAttemptId: nextDunningAttempt?.id,
    };
  }
}

async function failDunningAndScheduleNext(input: {
  dunningAttemptId: string;
  invoice: {
    id: string;
    businessId: string;
    subscriptionId: string;
    customerId: string;
    mode: ApiKeyMode;
  };
  subscription: {
    id: string;
    status:
      | "INCOMPLETE"
      | "TRIALING"
      | "ACTIVE"
      | "PAST_DUE"
      | "PAUSED"
      | "CANCELLED"
      | "EXPIRED";
  };
  failureReason: string;
  metadata?: Prisma.InputJsonValue;
}) {
  await prisma.$transaction([
    prisma.dunningAttempt.update({
      where: { id: input.dunningAttemptId },
      data: {
        status: "FAILED",
        processedAt: new Date(),
        failureReason: input.failureReason,
      },
    }),
    prisma.invoice.update({
      where: { id: input.invoice.id },
      data: { status: "PAYMENT_FAILED" },
    }),
    ...(["TRIALING", "ACTIVE", "PAST_DUE"].includes(input.subscription.status)
      ? [
          prisma.subscription.update({
            where: { id: input.subscription.id },
            data: subscriptionTransitionData(input.subscription.status, "PAST_DUE"),
          }),
        ]
      : []),
  ]);

  return scheduleNextDunningAttempt({
    businessId: input.invoice.businessId,
    subscriptionId: input.invoice.subscriptionId,
    invoiceId: input.invoice.id,
    customerId: input.invoice.customerId,
    mode: input.invoice.mode,
    failureReason: input.failureReason,
    metadata: input.metadata,
  });
}

async function markChargeFailedAndScheduleNext(input: {
  invoice: {
    id: string;
    businessId: string;
    subscriptionId: string;
    customerId: string;
    mode: ApiKeyMode;
  };
  subscription: {
    id: string;
    status:
      | "INCOMPLETE"
      | "TRIALING"
      | "ACTIVE"
      | "PAST_DUE"
      | "PAUSED"
      | "CANCELLED"
      | "EXPIRED";
  };
  paymentAttemptId: string;
  dunningAttemptId: string;
  failureReason: string;
}) {
  await prisma.$transaction([
    prisma.paymentAttempt.update({
      where: { id: input.paymentAttemptId },
      data: {
        status: "FAILED",
        failureReason: input.failureReason,
        processedAt: new Date(),
      },
    }),
    prisma.invoice.update({
      where: { id: input.invoice.id },
      data: { status: "PAYMENT_FAILED" },
    }),
    prisma.dunningAttempt.update({
      where: { id: input.dunningAttemptId },
      data: {
        status: "FAILED",
        failureReason: input.failureReason,
        processedAt: new Date(),
      },
    }),
    ...(["TRIALING", "ACTIVE", "PAST_DUE"].includes(input.subscription.status)
      ? [
          prisma.subscription.update({
            where: { id: input.subscription.id },
            data: subscriptionTransitionData(input.subscription.status, "PAST_DUE"),
          }),
        ]
      : []),
  ]);

  const nextDunningAttempt = await scheduleNextDunningAttempt({
    businessId: input.invoice.businessId,
    subscriptionId: input.invoice.subscriptionId,
    invoiceId: input.invoice.id,
    customerId: input.invoice.customerId,
    mode: input.invoice.mode,
    failureReason: input.failureReason,
    metadata: {
      source: "dunning_retry_failed",
      paymentAttemptId: input.paymentAttemptId,
      dunningAttemptId: input.dunningAttemptId,
    },
  });

  const failedPaymentAttempt = await prisma.paymentAttempt.findUnique({
    where: { id: input.paymentAttemptId },
    include: { invoice: true, subscription: true },
  });

  if (failedPaymentAttempt) {
    void emitMerchantWebhook({
      businessId: input.invoice.businessId,
      type: "invoice.payment_failed",
      data: {
        invoice: failedPaymentAttempt.invoice,
        paymentAttempt: failedPaymentAttempt,
        subscription: failedPaymentAttempt.subscription,
        nextDunningAttempt,
      },
    }).catch((error) => {
      console.error("Failed to emit invoice.payment_failed webhook", error);
    });
  }

  return nextDunningAttempt;
}
