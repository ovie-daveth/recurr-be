"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCleanup = runCleanup;
const observability_1 = require("../../lib/observability");
const prisma_1 = require("../../lib/prisma");
const dunning_service_1 = require("../dunning/dunning.service");
const subscriptions_state_1 = require("../subscriptions/subscriptions.state");
function positiveInteger(value, fallback) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function minutesAgo(now, minutes) {
    return new Date(now.getTime() - minutes * 60_000);
}
function hoursAgo(now, hours) {
    return new Date(now.getTime() - hours * 60 * 60_000);
}
function daysAgo(now, days) {
    return new Date(now.getTime() - days * 24 * 60 * 60_000);
}
function cleanupConfig(input) {
    return {
        stalePaymentProcessingMinutes: input.stalePaymentProcessingMinutes ??
            positiveInteger(process.env.STALE_PAYMENT_PROCESSING_MINUTES, 30),
        staleIncompleteSubscriptionHours: input.staleIncompleteSubscriptionHours ??
            positiveInteger(process.env.STALE_INCOMPLETE_SUBSCRIPTION_HOURS, 24),
        idempotencyRetentionDays: input.idempotencyRetentionDays ??
            positiveInteger(process.env.IDEMPOTENCY_RETENTION_DAYS, 7),
    };
}
async function runCleanup(input = {}) {
    const now = input.now ?? new Date();
    const config = cleanupConfig(input);
    const expiredPortalSessions = await expirePortalSessions(input, now);
    const staleInvoicesFailed = await failStalePaymentProcessingInvoices(input, now, config.stalePaymentProcessingMinutes);
    const incompleteSubscriptionsCancelled = await cancelStaleIncompleteSubscriptions(input, now, config.staleIncompleteSubscriptionHours);
    const idempotencyKeysDeleted = await cleanupIdempotencyKeys(input, now, config.idempotencyRetentionDays);
    return {
        processedAt: now,
        config,
        expiredPortalSessions,
        staleInvoicesFailed,
        incompleteSubscriptionsCancelled,
        idempotencyKeysDeleted,
    };
}
async function expirePortalSessions(input, now) {
    const result = await prisma_1.prisma.portalSession.updateMany({
        where: {
            ...(input.businessId ? { businessId: input.businessId } : {}),
            ...(input.mode ? { mode: input.mode } : {}),
            status: "ACTIVE",
            expiresAt: { lte: now },
        },
        data: { status: "EXPIRED" },
    });
    (0, observability_1.incrementMetric)("cleanup.portal_sessions_expired", { businessId: input.businessId ?? "all", mode: input.mode ?? "all" }, result.count);
    (0, observability_1.observeEvent)("info", "cleanup.portal_sessions_expired", {
        businessId: input.businessId,
        mode: input.mode,
        count: result.count,
    });
    return result.count;
}
async function failStalePaymentProcessingInvoices(input, now, staleMinutes) {
    const cutoff = minutesAgo(now, staleMinutes);
    const invoices = await prisma_1.prisma.invoice.findMany({
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
        await prisma_1.prisma.$transaction([
            prisma_1.prisma.invoice.update({
                where: { id: invoice.id },
                data: { status: "PAYMENT_FAILED" },
            }),
            ...(latestAttempt
                ? [
                    prisma_1.prisma.paymentAttempt.update({
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
                    prisma_1.prisma.subscription.update({
                        where: { id: invoice.subscriptionId },
                        data: {
                            ...(0, subscriptions_state_1.subscriptionTransitionData)(invoice.subscription.status, "PAST_DUE"),
                            nextBillingAt: null,
                        },
                    }),
                ]
                : []),
        ]);
        await (0, dunning_service_1.scheduleNextDunningAttempt)({
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
        (0, observability_1.observeEvent)("warn", "cleanup.payment_processing_invoice_failed", {
            businessId: invoice.businessId,
            mode: invoice.mode,
            invoiceId: invoice.id,
            subscriptionId: invoice.subscriptionId,
            paymentAttemptId: latestAttempt?.id,
            staleMinutes,
            failureReason,
        });
    }
    (0, observability_1.incrementMetric)("cleanup.payment_processing_invoices_failed", { businessId: input.businessId ?? "all", mode: input.mode ?? "all" }, count);
    return count;
}
async function cancelStaleIncompleteSubscriptions(input, now, staleHours) {
    const cutoff = hoursAgo(now, staleHours);
    const subscriptions = await prisma_1.prisma.subscription.findMany({
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
        await prisma_1.prisma.$transaction([
            prisma_1.prisma.subscription.update({
                where: { id: subscription.id },
                data: (0, subscriptions_state_1.subscriptionTransitionData)(subscription.status, "CANCELLED"),
            }),
            prisma_1.prisma.invoice.updateMany({
                where: {
                    subscriptionId: subscription.id,
                    status: { in: ["DRAFT", "OPEN", "PAYMENT_PROCESSING"] },
                },
                data: { status: "VOID" },
            }),
            prisma_1.prisma.paymentAttempt.updateMany({
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
        (0, observability_1.observeEvent)("warn", "cleanup.incomplete_subscription_cancelled", {
            businessId: subscription.businessId,
            mode: subscription.mode,
            subscriptionId: subscription.id,
            invoiceCount: subscription.invoices.length,
            staleHours,
        });
    }
    (0, observability_1.incrementMetric)("cleanup.incomplete_subscriptions_cancelled", { businessId: input.businessId ?? "all", mode: input.mode ?? "all" }, subscriptions.length);
    return subscriptions.length;
}
async function cleanupIdempotencyKeys(input, now, retentionDays) {
    const cutoff = daysAgo(now, retentionDays);
    const result = await prisma_1.prisma.idempotencyKey.deleteMany({
        where: {
            ...(input.businessId ? { businessId: input.businessId } : {}),
            createdAt: { lte: cutoff },
        },
    });
    (0, observability_1.incrementMetric)("cleanup.idempotency_keys_deleted", { businessId: input.businessId ?? "all" }, result.count);
    (0, observability_1.observeEvent)("info", "cleanup.idempotency_keys_deleted", {
        businessId: input.businessId,
        count: result.count,
        retentionDays,
    });
    return result.count;
}
