import type { ApiKeyMode } from "../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { paymentProvider } from "../nomba/nomba.service";
import { addBillingInterval } from "../subscriptions/billing-dates";
import { subscriptionTransitionData } from "../subscriptions/subscriptions.state";

type RunDueBillingInput = {
  limit?: number;
  mode?: ApiKeyMode;
  subscriptionId?: string;
  now?: Date;
  skipTransactionVerification?: boolean;
};

type BillingRunResult = {
  subscriptionId: string;
  status: "PROCESSED" | "SKIPPED" | "FAILED";
  reason?: string;
  invoiceId?: string;
  paymentAttemptId?: string;
  providerReference?: string;
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

export async function runDueBilling(input: RunDueBillingInput = {}) {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 20;
  const results: BillingRunResult[] = [];

  const subscriptions = await prisma.subscription.findMany({
    where: {
      ...(input.subscriptionId ? { id: input.subscriptionId } : {}),
      ...(input.mode ? { mode: input.mode } : {}),
      status: { in: ["ACTIVE", "TRIALING"] },
      nextBillingAt: { lte: now },
    },
    include: {
      customer: true,
      plan: true,
      paymentMethod: true,
    },
    orderBy: [{ nextBillingAt: "asc" }, { id: "asc" }],
    take: limit,
  });

  for (const subscription of subscriptions) {
    try {
      results.push(
        await processDueSubscription({
          subscription,
          skipTransactionVerification: input.skipTransactionVerification ?? false,
        })
      );
    } catch (error) {
      results.push({
        subscriptionId: subscription.id,
        status: "FAILED",
        reason: error instanceof Error ? error.message : "Billing failed",
      });
    }
  }

  return {
    processedAt: now,
    count: results.length,
    results,
  };
}

async function processDueSubscription(input: {
  subscription: Awaited<ReturnType<typeof prisma.subscription.findMany>>[number] & {
    customer: {
      id: string;
      status: string;
    };
    plan: {
      id: string;
      name: string;
      code: string;
      amountMinor: number;
      currency: string;
      interval: "DAY" | "WEEK" | "MONTH" | "YEAR" | "CUSTOM";
      intervalCount: number;
      status: string;
    };
    paymentMethod: {
      id: string;
      customerId: string;
      status: string;
      reusable: boolean;
      providerPaymentMethodReference: string | null;
      providerCustomerReference: string | null;
    };
  };
  skipTransactionVerification: boolean;
}): Promise<BillingRunResult> {
  const { subscription } = input;

  if (subscription.customer.status !== "ACTIVE") {
    return {
      subscriptionId: subscription.id,
      status: "SKIPPED",
      reason: "Customer is not active",
    };
  }

  if (subscription.plan.status !== "ACTIVE") {
    return {
      subscriptionId: subscription.id,
      status: "SKIPPED",
      reason: "Plan is not active",
    };
  }

  if (!isUsablePaymentMethod(subscription.paymentMethod)) {
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        ...subscriptionTransitionData(subscription.status, "PAST_DUE"),
        nextBillingAt: null,
      },
    });

    return {
      subscriptionId: subscription.id,
      status: "SKIPPED",
      reason: "Payment method is not active and reusable",
    };
  }

  const periodStart = subscription.currentPeriodEnd;
  const periodEnd = addBillingInterval(
    periodStart,
    subscription.plan.interval,
    subscription.plan.intervalCount
  );

  const existingInvoice = await prisma.invoice.findFirst({
    where: {
      subscriptionId: subscription.id,
      periodStart,
      periodEnd,
      status: { not: "VOID" },
    },
    include: { attempts: true },
  });

  if (existingInvoice) {
    return {
      subscriptionId: subscription.id,
      status: "SKIPPED",
      reason: "Invoice already exists for this billing period",
      invoiceId: existingInvoice.id,
      paymentAttemptId: existingInvoice.attempts[0]?.id,
    };
  }

  const { invoice, paymentAttempt } = await prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.create({
      data: {
        businessId: subscription.businessId,
        mode: subscription.mode,
        subscriptionId: subscription.id,
        customerId: subscription.customerId,
        status: "OPEN",
        amountDueMinor: subscription.plan.amountMinor,
        currency: subscription.plan.currency,
        dueAt: new Date(),
        periodStart,
        periodEnd,
        items: {
          create: [
            {
              businessId: subscription.businessId,
              subscriptionId: subscription.id,
              planId: subscription.planId,
              description: subscription.plan.name,
              amountMinor: subscription.plan.amountMinor,
              currency: subscription.plan.currency,
              periodStart,
              periodEnd,
              metadata: {
                planCode: subscription.plan.code,
                interval: subscription.plan.interval,
                intervalCount: subscription.plan.intervalCount,
              },
            },
          ],
        },
      },
    });

    const paymentAttempt = await tx.paymentAttempt.create({
      data: {
        businessId: subscription.businessId,
        mode: subscription.mode,
        subscriptionId: subscription.id,
        invoiceId: invoice.id,
        customerId: subscription.customerId,
        paymentMethodId: subscription.paymentMethodId,
        provider: "NOMBA",
        amountMinor: subscription.plan.amountMinor,
        currency: subscription.plan.currency,
        status: "PENDING",
        attemptNumber: 1,
      },
    });

    return { invoice, paymentAttempt };
  });

  const providerReference = `recur_attempt_${paymentAttempt.id}`;

  await prisma.$transaction([
    prisma.paymentAttempt.update({
      where: { id: paymentAttempt.id },
      data: { providerReference, status: "PROCESSING" },
    }),
    prisma.invoice.update({
      where: { id: invoice.id },
      data: { status: "PAYMENT_PROCESSING" },
    }),
  ]);

  const charge = await paymentProvider
    .chargeTokenizedCard({
      businessId: subscription.businessId,
      mode: subscription.mode,
      customerId: subscription.customerId,
      providerCustomerReference:
        subscription.paymentMethod.providerCustomerReference!,
      paymentMethodReference:
        subscription.paymentMethod.providerPaymentMethodReference!,
      reference: providerReference,
      amountMinor: paymentAttempt.amountMinor,
      currency: paymentAttempt.currency,
      metadata: {
        recurrSubscriptionId: subscription.id,
        recurrInvoiceId: invoice.id,
        recurrPaymentAttemptId: paymentAttempt.id,
        billingRun: "due_subscription",
      },
    })
    .catch(async (error) => {
      const failureReason =
        error instanceof Error ? error.message : "Provider charge request failed";

      await prisma.$transaction([
        prisma.paymentAttempt.update({
          where: { id: paymentAttempt.id },
          data: {
            status: "FAILED",
            failureReason,
            processedAt: new Date(),
          },
        }),
        prisma.invoice.update({
          where: { id: invoice.id },
          data: { status: "PAYMENT_FAILED" },
        }),
        prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            ...subscriptionTransitionData(subscription.status, "PAST_DUE"),
            nextBillingAt: null,
          },
        }),
      ]);

      throw error;
    });

  if (charge.status === "SUCCEEDED") {
    if (!input.skipTransactionVerification) {
      const verification = await paymentProvider.getTransaction(providerReference);
      if (!successfulStatus(verification.status)) {
        return {
          subscriptionId: subscription.id,
          status: "PROCESSED",
          reason: "Charge succeeded but transaction verification is pending",
          invoiceId: invoice.id,
          paymentAttemptId: paymentAttempt.id,
          providerReference,
        };
      }
    }

    await prisma.$transaction([
      prisma.paymentAttempt.update({
        where: { id: paymentAttempt.id },
        data: { status: "SUCCEEDED", processedAt: new Date() },
      }),
      prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          status: "PAID",
          paidAt: new Date(),
          amountPaidMinor: paymentAttempt.amountMinor,
        },
      }),
      prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          ...subscriptionTransitionData(subscription.status, "ACTIVE"),
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
          nextBillingAt: periodEnd,
        },
      }),
    ]);

    return {
      subscriptionId: subscription.id,
      status: "PROCESSED",
      reason: "Subscription billed successfully",
      invoiceId: invoice.id,
      paymentAttemptId: paymentAttempt.id,
      providerReference,
    };
  }

  if (charge.status === "FAILED") {
    await prisma.$transaction([
      prisma.paymentAttempt.update({
        where: { id: paymentAttempt.id },
        data: {
          status: "FAILED",
          failureReason: charge.failureReason,
          processedAt: new Date(),
        },
      }),
      prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: "PAYMENT_FAILED" },
      }),
      prisma.subscription.update({
        where: { id: subscription.id },
        data: {
          ...subscriptionTransitionData(subscription.status, "PAST_DUE"),
          nextBillingAt: null,
        },
      }),
    ]);

    return {
      subscriptionId: subscription.id,
      status: "PROCESSED",
      reason: "Subscription billing failed",
      invoiceId: invoice.id,
      paymentAttemptId: paymentAttempt.id,
      providerReference,
    };
  }

  await prisma.paymentAttempt.update({
    where: { id: paymentAttempt.id },
    data: {
      status: charge.status === "REQUIRES_ACTION" ? "REQUIRES_ACTION" : "PROCESSING",
    },
  });

  return {
    subscriptionId: subscription.id,
    status: "PROCESSED",
    reason: `Charge is ${charge.status}`,
    invoiceId: invoice.id,
    paymentAttemptId: paymentAttempt.id,
    providerReference,
  };
}
