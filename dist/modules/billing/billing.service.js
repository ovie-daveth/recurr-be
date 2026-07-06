"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDueBilling = runDueBilling;
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
    const periodEnd = (0, billing_dates_1.addBillingInterval)(periodStart, subscription.plan.interval, subscription.plan.intervalCount);
    const existingInvoice = await prisma_1.prisma.invoice.findFirst({
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
    const { invoice, paymentAttempt } = await prisma_1.prisma.$transaction(async (tx) => {
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
            const verification = await nomba_service_1.paymentProvider.getTransaction(providerReference);
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
