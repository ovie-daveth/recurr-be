"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDueBilling = runDueBilling;
const advisory_lock_1 = require("../../lib/advisory-lock");
const observability_1 = require("../../lib/observability");
const prisma_1 = require("../../lib/prisma");
const dunning_service_1 = require("../dunning/dunning.service");
const nomba_service_1 = require("../nomba/nomba.service");
const billing_dates_1 = require("../subscriptions/billing-dates");
const subscriptions_state_1 = require("../subscriptions/subscriptions.state");
const merchant_webhooks_service_1 = require("../webhook-endpoints/merchant-webhooks.service");
function isUsablePaymentMethod(paymentMethod) {
    return (paymentMethod.status === "ACTIVE" &&
        paymentMethod.reusable &&
        Boolean(paymentMethod.providerPaymentMethodReference) &&
        Boolean(paymentMethod.providerCustomerReference));
}
function successfulStatus(status) {
    return /success|successful|succeeded|paid|approved/i.test(status);
}
async function runDueBilling(input = {}) {
    const now = input.now ?? new Date();
    const limit = input.limit ?? 20;
    const results = [];
    const subscriptions = await prisma_1.prisma.subscription.findMany({
        where: {
            ...(input.businessId ? { businessId: input.businessId } : {}),
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
    (0, observability_1.incrementMetric)("billing.due_subscriptions_found", {
        businessId: input.businessId ?? "all",
        mode: input.mode ?? "all",
    }, subscriptions.length);
    (0, observability_1.observeEvent)("info", "billing.due_subscriptions_found", {
        businessId: input.businessId,
        mode: input.mode,
        subscriptionId: input.subscriptionId,
        count: subscriptions.length,
        limit,
    });
    for (const subscription of subscriptions) {
        try {
            results.push(await processDueSubscription({
                subscription,
                skipTransactionVerification: input.skipTransactionVerification ?? false,
            }));
        }
        catch (error) {
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
async function processDueSubscription(input) {
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
        await prisma_1.prisma.subscription.update({
            where: { id: subscription.id },
            data: {
                ...(0, subscriptions_state_1.subscriptionTransitionData)(subscription.status, "PAST_DUE"),
                nextBillingAt: null,
            },
        });
        return {
            subscriptionId: subscription.id,
            status: "SKIPPED",
            reason: "Payment method is not active and reusable",
        };
    }
    if (subscription.cancelAtPeriodEnd) {
        await prisma_1.prisma.subscription.update({
            where: { id: subscription.id },
            data: (0, subscriptions_state_1.subscriptionTransitionData)(subscription.status, "CANCELLED"),
        });
        return {
            subscriptionId: subscription.id,
            status: "SKIPPED",
            reason: "Subscription cancelled at period end",
        };
    }
    const periodStart = subscription.currentPeriodEnd;
    const claim = await prisma_1.prisma.$transaction(async (tx) => {
        const locked = await (0, advisory_lock_1.tryAcquireTransactionAdvisoryLock)(tx, (0, advisory_lock_1.advisoryLockKey)("billing-subscription", subscription.id));
        if (!locked) {
            return {
                skipped: {
                    reason: "Subscription billing is already being processed",
                },
            };
        }
        const freshSubscription = await tx.subscription.findUnique({
            where: { id: subscription.id },
            select: {
                status: true,
                nextBillingAt: true,
                currentPeriodEnd: true,
                cancelAtPeriodEnd: true,
            },
        });
        if (!freshSubscription) {
            return {
                skipped: {
                    reason: "Subscription no longer exists",
                },
            };
        }
        if (!["ACTIVE", "TRIALING"].includes(freshSubscription.status)) {
            return {
                skipped: {
                    reason: "Subscription is no longer due for billing",
                },
            };
        }
        if (!freshSubscription.nextBillingAt ||
            freshSubscription.nextBillingAt.getTime() > Date.now()) {
            return {
                skipped: {
                    reason: "Subscription billing date is no longer due",
                },
            };
        }
        if (freshSubscription.currentPeriodEnd.getTime() !== periodStart.getTime() ||
            freshSubscription.cancelAtPeriodEnd) {
            return {
                skipped: {
                    reason: freshSubscription.cancelAtPeriodEnd
                        ? "Subscription cancelled at period end"
                        : "Subscription billing period already advanced",
                },
            };
        }
        const pendingPlanChange = await tx.subscriptionScheduleChange.findFirst({
            where: {
                subscriptionId: subscription.id,
                status: "PENDING",
                effectiveAt: { lte: periodStart },
            },
            include: { toPlan: true },
            orderBy: [{ effectiveAt: "asc" }, { createdAt: "asc" }],
        });
        const billingPlan = pendingPlanChange?.toPlan ?? subscription.plan;
        if (billingPlan.status !== "ACTIVE") {
            return {
                skipped: {
                    reason: "Billing plan is not active",
                },
            };
        }
        const periodEnd = (0, billing_dates_1.addBillingInterval)(periodStart, billingPlan.interval, billingPlan.intervalCount);
        const existingInvoice = await tx.invoice.findFirst({
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
                skipped: {
                    reason: "Invoice already exists for this billing period",
                    invoiceId: existingInvoice.id,
                    paymentAttemptId: existingInvoice.attempts[0]?.id,
                },
            };
        }
        if (pendingPlanChange) {
            await tx.subscriptionScheduleChange.update({
                where: { id: pendingPlanChange.id },
                data: {
                    status: "APPLIED",
                    appliedAt: new Date(),
                },
            });
            await tx.subscription.update({
                where: { id: subscription.id },
                data: { planId: pendingPlanChange.toPlanId },
            });
        }
        const invoice = await tx.invoice.create({
            data: {
                businessId: subscription.businessId,
                mode: subscription.mode,
                subscriptionId: subscription.id,
                customerId: subscription.customerId,
                status: "OPEN",
                amountDueMinor: billingPlan.amountMinor,
                currency: billingPlan.currency,
                dueAt: new Date(),
                periodStart,
                periodEnd,
                metadata: pendingPlanChange
                    ? {
                        appliedScheduleChangeId: pendingPlanChange.id,
                        previousPlanId: pendingPlanChange.fromPlanId,
                        newPlanId: pendingPlanChange.toPlanId,
                    }
                    : undefined,
                items: {
                    create: [
                        {
                            businessId: subscription.businessId,
                            subscriptionId: subscription.id,
                            planId: billingPlan.id,
                            description: billingPlan.name,
                            amountMinor: billingPlan.amountMinor,
                            currency: billingPlan.currency,
                            periodStart,
                            periodEnd,
                            metadata: {
                                planCode: billingPlan.code,
                                interval: billingPlan.interval,
                                intervalCount: billingPlan.intervalCount,
                                ...(pendingPlanChange
                                    ? { appliedScheduleChangeId: pendingPlanChange.id }
                                    : {}),
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
                amountMinor: billingPlan.amountMinor,
                currency: billingPlan.currency,
                status: "PENDING",
                attemptNumber: 1,
            },
        });
        return { invoice, paymentAttempt, periodEnd, appliedPlanChange: pendingPlanChange };
    });
    if (!("invoice" in claim)) {
        const skipped = claim.skipped;
        return {
            subscriptionId: subscription.id,
            status: "SKIPPED",
            reason: skipped.reason,
            invoiceId: skipped.invoiceId,
            paymentAttemptId: skipped.paymentAttemptId,
        };
    }
    const { invoice, paymentAttempt, periodEnd, appliedPlanChange } = claim;
    if (!invoice || !paymentAttempt) {
        throw new Error("Subscription billing claim did not return invoice and payment attempt");
    }
    (0, observability_1.incrementMetric)("billing.invoices_created", {
        businessId: subscription.businessId,
        mode: subscription.mode,
    });
    (0, observability_1.observeEvent)("info", "billing.invoice_created", {
        businessId: subscription.businessId,
        mode: subscription.mode,
        subscriptionId: subscription.id,
        invoiceId: invoice.id,
        paymentAttemptId: paymentAttempt.id,
        amountMinor: paymentAttempt.amountMinor,
        currency: paymentAttempt.currency,
    });
    const providerReference = `recur_attempt_${paymentAttempt.id}`;
    await prisma_1.prisma.$transaction([
        prisma_1.prisma.paymentAttempt.update({
            where: { id: paymentAttempt.id },
            data: { providerReference, status: "PROCESSING" },
        }),
        prisma_1.prisma.invoice.update({
            where: { id: invoice.id },
            data: { status: "PAYMENT_PROCESSING" },
        }),
    ]);
    const charge = await nomba_service_1.paymentProvider
        .chargeTokenizedCard({
        businessId: subscription.businessId,
        mode: subscription.mode,
        customerId: subscription.customerId,
        providerCustomerReference: subscription.paymentMethod.providerCustomerReference,
        paymentMethodReference: subscription.paymentMethod.providerPaymentMethodReference,
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
        const failureReason = error instanceof Error ? error.message : "Provider charge request failed";
        await prisma_1.prisma.$transaction([
            prisma_1.prisma.paymentAttempt.update({
                where: { id: paymentAttempt.id },
                data: {
                    status: "FAILED",
                    failureReason,
                    processedAt: new Date(),
                },
            }),
            prisma_1.prisma.invoice.update({
                where: { id: invoice.id },
                data: { status: "PAYMENT_FAILED" },
            }),
            prisma_1.prisma.subscription.update({
                where: { id: subscription.id },
                data: {
                    ...(0, subscriptions_state_1.subscriptionTransitionData)(subscription.status, "PAST_DUE"),
                    nextBillingAt: null,
                },
            }),
        ]);
        (0, observability_1.incrementMetric)("payments.charges_failed", {
            businessId: subscription.businessId,
            mode: subscription.mode,
            source: "billing_worker",
        });
        (0, observability_1.observeEvent)("error", "payments.charge_failed", {
            businessId: subscription.businessId,
            mode: subscription.mode,
            source: "billing_worker",
            subscriptionId: subscription.id,
            invoiceId: invoice.id,
            paymentAttemptId: paymentAttempt.id,
            failureReason,
        });
        await (0, dunning_service_1.scheduleNextDunningAttempt)({
            businessId: subscription.businessId,
            subscriptionId: subscription.id,
            invoiceId: invoice.id,
            customerId: subscription.customerId,
            mode: subscription.mode,
            failureReason,
            metadata: {
                source: "billing_worker_provider_error",
                paymentAttemptId: paymentAttempt.id,
            },
        });
        const failedPaymentAttempt = await prisma_1.prisma.paymentAttempt.findUnique({
            where: { id: paymentAttempt.id },
            include: { invoice: true, subscription: true },
        });
        if (failedPaymentAttempt) {
            void (0, merchant_webhooks_service_1.emitMerchantWebhook)({
                businessId: subscription.businessId,
                type: "invoice.payment_failed",
                data: {
                    invoice: failedPaymentAttempt.invoice,
                    paymentAttempt: failedPaymentAttempt,
                    subscription: failedPaymentAttempt.subscription,
                },
            }).catch((webhookError) => {
                console.error("Failed to emit invoice.payment_failed webhook", webhookError);
            });
        }
        throw error;
    });
    if (charge.status === "SUCCEEDED") {
        if (!input.skipTransactionVerification) {
            const verification = await nomba_service_1.paymentProvider.getTransaction(providerReference, paymentAttempt.mode);
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
        await prisma_1.prisma.$transaction([
            prisma_1.prisma.paymentAttempt.update({
                where: { id: paymentAttempt.id },
                data: { status: "SUCCEEDED", processedAt: new Date() },
            }),
            prisma_1.prisma.invoice.update({
                where: { id: invoice.id },
                data: {
                    status: "PAID",
                    paidAt: new Date(),
                    amountPaidMinor: paymentAttempt.amountMinor,
                },
            }),
            prisma_1.prisma.subscription.update({
                where: { id: subscription.id },
                data: {
                    ...(0, subscriptions_state_1.subscriptionTransitionData)(subscription.status, "ACTIVE"),
                    currentPeriodStart: periodStart,
                    currentPeriodEnd: periodEnd,
                    nextBillingAt: periodEnd,
                },
            }),
        ]);
        (0, observability_1.incrementMetric)("payments.charges_succeeded", {
            businessId: subscription.businessId,
            mode: subscription.mode,
            source: "billing_worker",
        });
        (0, observability_1.observeEvent)("info", "payments.charge_succeeded", {
            businessId: subscription.businessId,
            mode: subscription.mode,
            source: "billing_worker",
            subscriptionId: subscription.id,
            invoiceId: invoice.id,
            paymentAttemptId: paymentAttempt.id,
            providerReference,
            amountMinor: paymentAttempt.amountMinor,
            currency: paymentAttempt.currency,
        });
        const settledPaymentAttempt = await prisma_1.prisma.paymentAttempt.findUnique({
            where: { id: paymentAttempt.id },
            include: { invoice: true, subscription: true },
        });
        if (settledPaymentAttempt) {
            void (0, merchant_webhooks_service_1.emitMerchantWebhook)({
                businessId: subscription.businessId,
                type: "invoice.payment_succeeded",
                data: {
                    invoice: settledPaymentAttempt.invoice,
                    paymentAttempt: settledPaymentAttempt,
                    subscription: settledPaymentAttempt.subscription,
                },
            }).catch((error) => {
                console.error("Failed to emit invoice.payment_succeeded webhook", error);
            });
            void (0, merchant_webhooks_service_1.emitMerchantWebhook)({
                businessId: subscription.businessId,
                type: "subscription.active",
                data: { subscription: settledPaymentAttempt.subscription },
            }).catch((error) => {
                console.error("Failed to emit subscription.active webhook", error);
            });
            if (appliedPlanChange) {
                void (0, merchant_webhooks_service_1.emitMerchantWebhook)({
                    businessId: subscription.businessId,
                    type: "subscription.plan_changed",
                    data: {
                        subscription: settledPaymentAttempt.subscription,
                        scheduleChange: appliedPlanChange,
                    },
                }).catch((error) => {
                    console.error("Failed to emit subscription.plan_changed webhook", error);
                });
            }
        }
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
        await prisma_1.prisma.$transaction([
            prisma_1.prisma.paymentAttempt.update({
                where: { id: paymentAttempt.id },
                data: {
                    status: "FAILED",
                    failureReason: charge.failureReason,
                    processedAt: new Date(),
                },
            }),
            prisma_1.prisma.invoice.update({
                where: { id: invoice.id },
                data: { status: "PAYMENT_FAILED" },
            }),
            prisma_1.prisma.subscription.update({
                where: { id: subscription.id },
                data: {
                    ...(0, subscriptions_state_1.subscriptionTransitionData)(subscription.status, "PAST_DUE"),
                    nextBillingAt: null,
                },
            }),
        ]);
        (0, observability_1.incrementMetric)("payments.charges_failed", {
            businessId: subscription.businessId,
            mode: subscription.mode,
            source: "billing_worker",
        });
        (0, observability_1.observeEvent)("warn", "payments.charge_failed", {
            businessId: subscription.businessId,
            mode: subscription.mode,
            source: "billing_worker",
            subscriptionId: subscription.id,
            invoiceId: invoice.id,
            paymentAttemptId: paymentAttempt.id,
            providerReference,
            failureReason: charge.failureReason,
        });
        await (0, dunning_service_1.scheduleNextDunningAttempt)({
            businessId: subscription.businessId,
            subscriptionId: subscription.id,
            invoiceId: invoice.id,
            customerId: subscription.customerId,
            mode: subscription.mode,
            failureReason: charge.failureReason,
            metadata: {
                source: "billing_worker_charge_failed",
                paymentAttemptId: paymentAttempt.id,
            },
        });
        const failedPaymentAttempt = await prisma_1.prisma.paymentAttempt.findUnique({
            where: { id: paymentAttempt.id },
            include: { invoice: true, subscription: true },
        });
        if (failedPaymentAttempt) {
            void (0, merchant_webhooks_service_1.emitMerchantWebhook)({
                businessId: subscription.businessId,
                type: "invoice.payment_failed",
                data: {
                    invoice: failedPaymentAttempt.invoice,
                    paymentAttempt: failedPaymentAttempt,
                    subscription: failedPaymentAttempt.subscription,
                },
            }).catch((error) => {
                console.error("Failed to emit invoice.payment_failed webhook", error);
            });
        }
        return {
            subscriptionId: subscription.id,
            status: "PROCESSED",
            reason: "Subscription billing failed",
            invoiceId: invoice.id,
            paymentAttemptId: paymentAttempt.id,
            providerReference,
        };
    }
    await prisma_1.prisma.paymentAttempt.update({
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
