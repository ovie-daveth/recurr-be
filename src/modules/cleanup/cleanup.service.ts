import type { ApiKeyMode } from "../../generated/prisma/client";
import { incrementMetric, observeEvent } from "../../lib/observability";
import { prisma } from "../../lib/prisma";
import { scheduleNextDunningAttempt } from "../dunning/dunning.service";
import { subscriptionTransitionData } from "../subscriptions/subscriptions.state";

type RunCleanupInput = {
  businessId?: string;
  mode?: ApiKeyMode;
  now?: Date;
  stalePaymentProcessingMinutes?: number;
  staleIncompleteSubscriptionHours?: number;
  idempotencyRetentionDays?: number;
};

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function minutesAgo(now: Date, minutes: number) {
  return new Date(now.getTime() - minutes * 60_000);
}

function hoursAgo(now: Date, hours: number) {
  return new Date(now.getTime() - hours * 60 * 60_000);
}

function daysAgo(now: Date, days: number) {
  return new Date(now.getTime() - days * 24 * 60 * 60_000);
}

function cleanupConfig(input: RunCleanupInput) {
  return {
    stalePaymentProcessingMinutes:
      input.stalePaymentProcessingMinutes ??
      positiveInteger(process.env.STALE_PAYMENT_PROCESSING_MINUTES, 30),
    staleIncompleteSubscriptionHours:
      input.staleIncompleteSubscriptionHours ??
      positiveInteger(process.env.STALE_INCOMPLETE_SUBSCRIPTION_HOURS, 24),
    idempotencyRetentionDays:
      input.idempotencyRetentionDays ??
      positiveInteger(process.env.IDEMPOTENCY_RETENTION_DAYS, 7),
  };
}

export async function runCleanup(input: RunCleanupInput = {}) {
  const now = input.now ?? new Date();
  const config = cleanupConfig(input);
  const expiredPortalSessions = await expirePortalSessions(input, now);
  const staleInvoicesFailed = await failStalePaymentProcessingInvoices(
    input,
    now,
    config.stalePaymentProcessingMinutes
  );
  const incompleteSubscriptionsCancelled =
    await cancelStaleIncompleteSubscriptions(
      input,
      now,
      config.staleIncompleteSubscriptionHours
    );
  const idempotencyKeysDeleted = await cleanupIdempotencyKeys(
    input,
    now,
    config.idempotencyRetentionDays
  );

  return {
    processedAt: now,
    config,
    expiredPortalSessions,
    staleInvoicesFailed,
    incompleteSubscriptionsCancelled,
    idempotencyKeysDeleted,
  };
}

async function expirePortalSessions(input: RunCleanupInput, now: Date) {
  const result = await prisma.portalSession.updateMany({
    where: {
      ...(input.businessId ? { businessId: input.businessId } : {}),
      ...(input.mode ? { mode: input.mode } : {}),
      status: "ACTIVE",
      expiresAt: { lte: now },
    },
    data: { status: "EXPIRED" },
  });

  incrementMetric(
    "cleanup.portal_sessions_expired",
    { businessId: input.businessId ?? "all", mode: input.mode ?? "all" },
    result.count
  );
  observeEvent("info", "cleanup.portal_sessions_expired", {
    businessId: input.businessId,
    mode: input.mode,
    count: result.count,
  });

  return result.count;
}

async function failStalePaymentProcessingInvoices(
  input: RunCleanupInput,
  now: Date,
  staleMinutes: number
) {
  const cutoff = minutesAgo(now, staleMinutes);
  const invoices = await prisma.invoice.findMany({
    where: {
      ...(input.businessId ? { businessId: input.businessId } : {}),
      ...(input.mode ? { mode: input.mode } : {}),
      status: "PAYMENT_PROCESSING",
      updatedAt: { lte: cutoff },
    },
    include: {
      subscription: true,
      attempts: {
        where: { status: "PROCESSING" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      },
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: 100,
  });

  let count = 0;

  for (const invoice of invoices) {
    const latestAttempt = invoice.attempts[0];
    const failureReason = `Payment processing exceeded ${staleMinutes} minutes`;

    await prisma.$transaction([
      prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: "PAYMENT_FAILED" },
      }),
      ...(latestAttempt
        ? [
            prisma.paymentAttempt.update({
              where: { id: latestAttempt.id },
              data: {
                status: "FAILED",
                failureReason,
                processedAt: now,
              },
            }),
          ]
        : []),
      ...(["TRIALING", "ACTIVE", "PAST_DUE"].includes(invoice.subscription.status)
        ? [
            prisma.subscription.update({
              where: { id: invoice.subscriptionId },
              data: {
                ...subscriptionTransitionData(
                  invoice.subscription.status,
                  "PAST_DUE"
                ),
                nextBillingAt: null,
              },
            }),
          ]
        : []),
    ]);

    await scheduleNextDunningAttempt({
      businessId: invoice.businessId,
      subscriptionId: invoice.subscriptionId,
      invoiceId: invoice.id,
      customerId: invoice.customerId,
      mode: invoice.mode,
      failureReason,
      metadata: {
        source: "cleanup_stale_payment_processing",
        paymentAttemptId: latestAttempt?.id,
      },
    });

    count += 1;
    observeEvent("warn", "cleanup.payment_processing_invoice_failed", {
      businessId: invoice.businessId,
      mode: invoice.mode,
      invoiceId: invoice.id,
      subscriptionId: invoice.subscriptionId,
      paymentAttemptId: latestAttempt?.id,
      staleMinutes,
      failureReason,
    });
  }

  incrementMetric(
    "cleanup.payment_processing_invoices_failed",
    { businessId: input.businessId ?? "all", mode: input.mode ?? "all" },
    count
  );

  return count;
}

async function cancelStaleIncompleteSubscriptions(
  input: RunCleanupInput,
  now: Date,
  staleHours: number
) {
  const cutoff = hoursAgo(now, staleHours);
  const subscriptions = await prisma.subscription.findMany({
    where: {
      ...(input.businessId ? { businessId: input.businessId } : {}),
      ...(input.mode ? { mode: input.mode } : {}),
      status: "INCOMPLETE",
      createdAt: { lte: cutoff },
    },
    include: {
      invoices: {
        where: { status: { in: ["DRAFT", "OPEN", "PAYMENT_PROCESSING"] } },
        include: {
          attempts: {
            where: { status: { in: ["PENDING", "PROCESSING", "REQUIRES_ACTION"] } },
          },
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 100,
  });

  for (const subscription of subscriptions) {
    await prisma.$transaction([
      prisma.subscription.update({
        where: { id: subscription.id },
        data: subscriptionTransitionData(subscription.status, "CANCELLED"),
      }),
      prisma.invoice.updateMany({
        where: {
          subscriptionId: subscription.id,
          status: { in: ["DRAFT", "OPEN", "PAYMENT_PROCESSING"] },
        },
        data: { status: "VOID" },
      }),
      prisma.paymentAttempt.updateMany({
        where: {
          subscriptionId: subscription.id,
          status: { in: ["PENDING", "PROCESSING", "REQUIRES_ACTION"] },
        },
        data: {
          status: "ABANDONED",
          failureReason: `Incomplete subscription exceeded ${staleHours} hours`,
          processedAt: now,
        },
      }),
    ]);

    observeEvent("warn", "cleanup.incomplete_subscription_cancelled", {
      businessId: subscription.businessId,
      mode: subscription.mode,
      subscriptionId: subscription.id,
      invoiceCount: subscription.invoices.length,
      staleHours,
    });
  }

  incrementMetric(
    "cleanup.incomplete_subscriptions_cancelled",
    { businessId: input.businessId ?? "all", mode: input.mode ?? "all" },
    subscriptions.length
  );

  return subscriptions.length;
}

async function cleanupIdempotencyKeys(
  input: RunCleanupInput,
  now: Date,
  retentionDays: number
) {
  const cutoff = daysAgo(now, retentionDays);
  const result = await prisma.idempotencyKey.deleteMany({
    where: {
      ...(input.businessId ? { businessId: input.businessId } : {}),
      createdAt: { lte: cutoff },
    },
  });

  incrementMetric(
    "cleanup.idempotency_keys_deleted",
    { businessId: input.businessId ?? "all" },
    result.count
  );
  observeEvent("info", "cleanup.idempotency_keys_deleted", {
    businessId: input.businessId,
    count: result.count,
    retentionDays,
  });

  return result.count;
}
