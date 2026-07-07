"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processNombaWebhookEvent = processNombaWebhookEvent;
const observability_1 = require("../../lib/observability");
const prisma_1 = require("../../lib/prisma");
const dunning_service_1 = require("../dunning/dunning.service");
const nomba_service_1 = require("../nomba/nomba.service");
const billing_dates_1 = require("../subscriptions/billing-dates");
const subscriptions_state_1 = require("../subscriptions/subscriptions.state");
const merchant_webhooks_service_1 = require("../webhook-endpoints/merchant-webhooks.service");
function getRecord(value) {
    return value && typeof value === "object"
        ? value
        : undefined;
}
function getStringProperty(value, keys) {
    const record = getRecord(value);
    if (!record) {
        return undefined;
    }
    for (const key of keys) {
        const property = record[key];
        if (typeof property === "string" && property.trim()) {
            return property.trim();
        }
    }
    return undefined;
}
function getNestedString(payload, keys) {
    const data = getRecord(payload)?.data;
    return (getStringProperty(payload, keys) ??
        getStringProperty(data, keys) ??
        getStringProperty(getRecord(data)?.transaction, keys) ??
        getStringProperty(getRecord(data)?.order, keys) ??
        getStringProperty(getRecord(data)?.paymentMethod, keys) ??
        getStringProperty(getRecord(data)?.tokenizedCardData, keys) ??
        getStringProperty(getRecord(data)?.tokenized_card_data, keys) ??
        getStringProperty(getRecord(data)?.authorization, keys) ??
        getStringProperty(getRecord(data)?.mandate, keys));
}
function getNombaCheckoutReference(payload) {
    const data = getRecord(payload)?.data;
    const checkoutKeys = [
        "reference",
        "orderReference",
        "order_reference",
        "orderId",
        "order_id",
        "checkoutReference",
        "checkout_reference",
        "paymentReference",
        "payment_reference",
        "merchantTxRef",
        "merchant_tx_ref",
    ];
    return (getStringProperty(getRecord(data)?.order, checkoutKeys) ??
        getStringProperty(getRecord(data)?.transaction, checkoutKeys) ??
        getStringProperty(data, checkoutKeys) ??
        getStringProperty(payload, checkoutKeys) ??
        getStringProperty(payload, ["requestId", "request_id"]));
}
function extractReference(payload) {
    return getNombaCheckoutReference(payload);
}
function extractPossibleSetupReferences(payload) {
    return [
        extractReference(payload),
        getNestedString(payload, ["merchantTxRef", "merchant_tx_ref"]),
        getNestedString(payload, ["orderReference", "order_reference"]),
    ].filter((value) => Boolean(value));
}
function extractNombaData(payload) {
    const data = getRecord(payload)?.data;
    return getRecord(data);
}
function extractMerchantTxRef(payload) {
    const data = extractNombaData(payload);
    return (getStringProperty(data, ["merchantTxRef", "merchant_tx_ref"]) ??
        getStringProperty(getRecord(data?.transaction), [
            "merchantTxRef",
            "merchant_tx_ref",
        ]) ??
        getStringProperty(getRecord(data?.order), ["merchantTxRef", "merchant_tx_ref"]));
}
function extractWebhookAmountMinor(payload) {
    const data = extractNombaData(payload);
    const directAmount = data?.amount;
    if (typeof directAmount === "number" && Number.isInteger(directAmount)) {
        return directAmount;
    }
    const orderAmount = getRecord(data?.order)?.amount;
    const transactionAmount = getRecord(data?.transaction)?.transactionAmount;
    const majorAmount = orderAmount ?? transactionAmount;
    if (typeof majorAmount === "number" && Number.isFinite(majorAmount)) {
        return Math.round(majorAmount * 100);
    }
    if (typeof majorAmount === "string" && majorAmount.trim()) {
        const parsed = Number(majorAmount);
        return Number.isFinite(parsed) ? Math.round(parsed * 100) : undefined;
    }
    return undefined;
}
function extractWebhookCurrency(payload) {
    const data = extractNombaData(payload);
    return (getStringProperty(data, ["currency"]) ??
        getStringProperty(getRecord(data?.order), ["currency"]));
}
function extractReusablePaymentReference(payload) {
    return getNestedString(payload, [
        "cardId",
        "card_id",
        "tokenKey",
        "token_key",
        "cardTokenId",
        "card_token_id",
        "tokenId",
        "token_id",
        "paymentMethodReference",
        "payment_method_reference",
        "providerPaymentMethodReference",
        "provider_payment_method_reference",
        "authorizationCode",
        "authorization_code",
        "mandateReference",
        "mandate_reference",
        "token",
        "cardToken",
        "card_token",
    ]);
}
function extractProviderCustomerReference(payload) {
    return getNestedString(payload, [
        "customerId",
        "customer_id",
        "nombaCustomerId",
        "nomba_customer_id",
        "providerCustomerReference",
        "provider_customer_reference",
    ]);
}
function extractCardSummary(payload) {
    return {
        brand: getNestedString(payload, [
            "brand",
            "cardBrand",
            "card_brand",
            "scheme",
            "cardScheme",
            "card_scheme",
        ]),
        last4: getNestedString(payload, [
            "last4",
            "lastFour",
            "last_four",
            "cardLast4",
            "card_last4",
            "maskedPan",
            "masked_pan",
        ])?.slice(-4),
    };
}
function getMetadataString(metadata, key) {
    const record = getRecord(metadata);
    const value = record?.[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
async function createHostedSubscriptionAfterPaymentMethodSetup(input) {
    const paymentMethod = await prisma_1.prisma.paymentMethod.findUnique({
        where: { id: input.paymentMethodId },
    });
    if (!paymentMethod) {
        return null;
    }
    const planId = getMetadataString(paymentMethod.metadata, "hostedSubscriptionPlanId");
    if (!planId) {
        return null;
    }
    const plan = await prisma_1.prisma.plan.findFirst({
        where: {
            id: planId,
            businessId: paymentMethod.businessId,
            mode: paymentMethod.mode,
            status: "ACTIVE",
        },
    });
    if (!plan) {
        return null;
    }
    const duplicate = await prisma_1.prisma.subscription.findFirst({
        where: {
            businessId: paymentMethod.businessId,
            mode: paymentMethod.mode,
            customerId: paymentMethod.customerId,
            planId: plan.id,
            status: {
                in: ["INCOMPLETE", "TRIALING", "ACTIVE", "PAST_DUE", "PAUSED"],
            },
        },
    });
    if (duplicate) {
        return { subscription: duplicate, invoice: null, paymentAttempt: null };
    }
    const now = new Date();
    const currentPeriodEnd = (0, billing_dates_1.addBillingInterval)(now, plan.interval, plan.intervalCount);
    const result = await prisma_1.prisma.$transaction(async (tx) => {
        const subscription = await tx.subscription.create({
            data: {
                businessId: paymentMethod.businessId,
                mode: paymentMethod.mode,
                customerId: paymentMethod.customerId,
                planId: plan.id,
                paymentMethodId: paymentMethod.id,
                status: "ACTIVE",
                currentPeriodStart: now,
                currentPeriodEnd,
                nextBillingAt: currentPeriodEnd,
                metadata: {
                    source: "hosted_subscription_page",
                    setupCheckoutReference: input.checkoutReference,
                },
            },
        });
        const invoice = await tx.invoice.create({
            data: {
                businessId: paymentMethod.businessId,
                mode: paymentMethod.mode,
                subscriptionId: subscription.id,
                customerId: paymentMethod.customerId,
                status: "PAID",
                amountDueMinor: plan.amountMinor,
                amountPaidMinor: plan.amountMinor,
                currency: plan.currency,
                dueAt: now,
                paidAt: now,
                periodStart: now,
                periodEnd: currentPeriodEnd,
                metadata: {
                    source: "hosted_subscription_page",
                    setupCheckoutReference: input.checkoutReference,
                },
                items: {
                    create: [
                        {
                            businessId: paymentMethod.businessId,
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
                businessId: paymentMethod.businessId,
                mode: paymentMethod.mode,
                subscriptionId: subscription.id,
                invoiceId: invoice.id,
                customerId: paymentMethod.customerId,
                paymentMethodId: paymentMethod.id,
                provider: "NOMBA",
                amountMinor: plan.amountMinor,
                currency: plan.currency,
                status: "SUCCEEDED",
                providerReference: input.checkoutReference,
                failureReason: null,
                attemptNumber: 1,
                processedAt: now,
            },
        });
        return { subscription, invoice, paymentAttempt };
    });
    void (0, merchant_webhooks_service_1.emitMerchantWebhook)({
        businessId: paymentMethod.businessId,
        type: "subscription.created",
        data: result,
    }).catch((error) => {
        console.error("Failed to emit subscription.created webhook", error);
    });
    void (0, merchant_webhooks_service_1.emitMerchantWebhook)({
        businessId: paymentMethod.businessId,
        type: "subscription.active",
        data: { subscription: result.subscription },
    }).catch((error) => {
        console.error("Failed to emit subscription.active webhook", error);
    });
    void (0, merchant_webhooks_service_1.emitMerchantWebhook)({
        businessId: paymentMethod.businessId,
        type: "invoice.payment_succeeded",
        data: result,
    }).catch((error) => {
        console.error("Failed to emit invoice.payment_succeeded webhook", error);
    });
    return result;
}
async function markWebhookProcessedWithNote(input) {
    await prisma_1.prisma.webhookEvent.update({
        where: { id: input.eventId },
        data: {
            status: "PROCESSED",
            processedAt: new Date(),
            failureReason: input.note,
        },
    });
}
function eventLooksSuccessful(eventType) {
    if (!eventType) {
        return false;
    }
    return eventType === "payment_success" || eventType === "mandate.debit_success";
}
function eventLooksFailed(eventType) {
    if (!eventType) {
        return false;
    }
    return /fail|failed|declined|reversed/i.test(eventType);
}
async function processNombaWebhookEvent(input) {
    const checkoutReference = extractReference(input.payload);
    const merchantTxRef = extractMerchantTxRef(input.payload);
    const paymentAttemptReference = merchantTxRef ?? checkoutReference;
    if (!checkoutReference &&
        !merchantTxRef &&
        !eventLooksSuccessful(input.eventType) &&
        !eventLooksFailed(input.eventType)) {
        await prisma_1.prisma.webhookEvent.update({
            where: { id: input.eventId },
            data: { status: "PROCESSED", processedAt: new Date() },
        });
        return;
    }
    const paymentAttempt = paymentAttemptReference
        ? await prisma_1.prisma.paymentAttempt.findFirst({
            where: {
                mode: input.mode,
                provider: "NOMBA",
                providerReference: paymentAttemptReference,
            },
            include: {
                invoice: true,
                subscription: true,
            },
        })
        : null;
    if (checkoutReference &&
        eventLooksSuccessful(input.eventType) &&
        !paymentAttempt) {
        const reusableReference = extractReusablePaymentReference(input.payload);
        const providerCustomerReference = extractProviderCustomerReference(input.payload);
        const card = extractCardSummary(input.payload);
        const possibleReferences = extractPossibleSetupReferences(input.payload);
        const paymentMethod = await prisma_1.prisma.paymentMethod.findFirst({
            where: {
                mode: input.mode,
                provider: "NOMBA",
                OR: [
                    { providerSetupReference: { in: possibleReferences } },
                    ...possibleReferences.map((reference) => ({
                        metadata: {
                            path: ["requestedSetupReference"],
                            equals: reference,
                        },
                    })),
                ],
            },
        });
        if (!paymentMethod) {
            await markWebhookProcessedWithNote({
                eventId: input.eventId,
                note: `No pending payment method matched checkout reference ${checkoutReference}`,
            });
            return;
        }
        if (!reusableReference) {
            (0, observability_1.observeEvent)("warn", "provider_webhook.payment_method_token_missing", {
                mode: input.mode,
                eventId: input.eventId,
                checkoutReference,
                provider: "nomba",
                message: "Payment method setup webhook matched, but Nomba payload did not include cardId/token reference",
            });
            await markWebhookProcessedWithNote({
                eventId: input.eventId,
                note: "Payment method setup webhook matched, but Nomba payload did not include cardId/token reference",
            });
            return;
        }
        if (paymentMethod && reusableReference) {
            const updatedPaymentMethod = await prisma_1.prisma.paymentMethod.update({
                where: { id: paymentMethod.id },
                data: {
                    status: "ACTIVE",
                    reusable: true,
                    type: "CARD",
                    providerPaymentMethodReference: reusableReference,
                    providerCustomerReference: providerCustomerReference ?? paymentMethod.providerCustomerReference,
                    brand: card.brand,
                    last4: card.last4,
                },
            });
            const portalUpdateSubscriptionId = getMetadataString(paymentMethod.metadata, "portalUpdateSubscriptionId");
            if (portalUpdateSubscriptionId) {
                await prisma_1.prisma.subscription.updateMany({
                    where: {
                        id: portalUpdateSubscriptionId,
                        businessId: updatedPaymentMethod.businessId,
                        customerId: updatedPaymentMethod.customerId,
                        mode: updatedPaymentMethod.mode,
                        status: {
                            in: ["INCOMPLETE", "TRIALING", "ACTIVE", "PAST_DUE", "PAUSED"],
                        },
                    },
                    data: {
                        paymentMethodId: updatedPaymentMethod.id,
                    },
                });
            }
            await createHostedSubscriptionAfterPaymentMethodSetup({
                paymentMethodId: updatedPaymentMethod.id,
                checkoutReference,
            });
            (0, observability_1.observeEvent)("info", "provider_webhook.payment_method_activated", {
                businessId: updatedPaymentMethod.businessId,
                mode: updatedPaymentMethod.mode,
                eventId: input.eventId,
                paymentMethodId: updatedPaymentMethod.id,
                customerId: updatedPaymentMethod.customerId,
                checkoutReference,
                provider: "nomba",
                message: "Nomba webhook activated reusable payment method",
            });
            void (0, merchant_webhooks_service_1.emitMerchantWebhook)({
                businessId: updatedPaymentMethod.businessId,
                type: "payment_method.updated",
                data: { paymentMethod: updatedPaymentMethod },
            }).catch((error) => {
                console.error("Failed to emit payment_method.updated webhook", error);
            });
        }
    }
    if (paymentAttempt && eventLooksSuccessful(input.eventType)) {
        const webhookAmountMinor = extractWebhookAmountMinor(input.payload);
        const webhookCurrency = extractWebhookCurrency(input.payload);
        if (webhookAmountMinor !== paymentAttempt.amountMinor ||
            webhookCurrency !== paymentAttempt.currency) {
            (0, observability_1.observeEvent)("error", "provider_webhook.payment_attempt_mismatch", {
                businessId: paymentAttempt.businessId,
                mode: paymentAttempt.mode,
                eventId: input.eventId,
                paymentAttemptId: paymentAttempt.id,
                invoiceId: paymentAttempt.invoiceId,
                subscriptionId: paymentAttempt.subscriptionId,
                providerReference: paymentAttempt.providerReference,
                expectedAmountMinor: paymentAttempt.amountMinor,
                receivedAmountMinor: webhookAmountMinor,
                expectedCurrency: paymentAttempt.currency,
                receivedCurrency: webhookCurrency,
                provider: "nomba",
                failureReason: "Nomba webhook amount/currency does not match payment attempt",
            });
            await prisma_1.prisma.webhookEvent.update({
                where: { id: input.eventId },
                data: {
                    status: "FAILED",
                    processedAt: new Date(),
                    failureReason: "Nomba webhook amount/currency does not match payment attempt",
                },
            });
            return;
        }
        const verified = input.skipTransactionVerification
            ? { status: "PAYMENT SUCCESSFUL" }
            : await nomba_service_1.paymentProvider.getTransaction(paymentAttempt.providerReference, paymentAttempt.mode);
        if (/success|successful|succeeded|paid|approved/i.test(verified.status)) {
            const paymentUpdates = [
                prisma_1.prisma.paymentAttempt.update({
                    where: { id: paymentAttempt.id },
                    data: { status: "SUCCEEDED", processedAt: new Date() },
                }),
                prisma_1.prisma.invoice.update({
                    where: { id: paymentAttempt.invoiceId },
                    data: {
                        status: "PAID",
                        paidAt: new Date(),
                        amountPaidMinor: paymentAttempt.amountMinor,
                    },
                }),
            ];
            if (!["CANCELLED", "EXPIRED"].includes(paymentAttempt.subscription.status)) {
                paymentUpdates.push(prisma_1.prisma.subscription.update({
                    where: { id: paymentAttempt.subscriptionId },
                    data: {
                        ...(0, subscriptions_state_1.subscriptionTransitionData)(paymentAttempt.subscription.status, "ACTIVE"),
                        nextBillingAt: paymentAttempt.subscription.currentPeriodEnd,
                    },
                }));
            }
            await prisma_1.prisma.$transaction(paymentUpdates);
            (0, observability_1.observeEvent)("info", "provider_webhook.payment_attempt_succeeded", {
                businessId: paymentAttempt.businessId,
                mode: paymentAttempt.mode,
                eventId: input.eventId,
                paymentAttemptId: paymentAttempt.id,
                invoiceId: paymentAttempt.invoiceId,
                subscriptionId: paymentAttempt.subscriptionId,
                providerReference: paymentAttempt.providerReference,
                amountMinor: paymentAttempt.amountMinor,
                currency: paymentAttempt.currency,
                provider: "nomba",
                message: "Nomba webhook settled recurring payment attempt",
            });
            const settledPaymentAttempt = await prisma_1.prisma.paymentAttempt.findUnique({
                where: { id: paymentAttempt.id },
                include: { invoice: true, subscription: true },
            });
            if (settledPaymentAttempt) {
                void (0, merchant_webhooks_service_1.emitMerchantWebhook)({
                    businessId: settledPaymentAttempt.businessId,
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
                    businessId: settledPaymentAttempt.businessId,
                    type: "subscription.active",
                    data: { subscription: settledPaymentAttempt.subscription },
                }).catch((error) => {
                    console.error("Failed to emit subscription.active webhook", error);
                });
            }
        }
    }
    if (paymentAttempt && eventLooksFailed(input.eventType)) {
        const failureReason = getNestedString(input.payload, [
            "failureReason",
            "message",
            "reason",
        ]);
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
                where: { id: paymentAttempt.invoiceId },
                data: { status: "PAYMENT_FAILED" },
            }),
        ]);
        (0, observability_1.observeEvent)("warn", "provider_webhook.payment_attempt_failed", {
            businessId: paymentAttempt.businessId,
            mode: paymentAttempt.mode,
            eventId: input.eventId,
            paymentAttemptId: paymentAttempt.id,
            invoiceId: paymentAttempt.invoiceId,
            subscriptionId: paymentAttempt.subscriptionId,
            providerReference: paymentAttempt.providerReference,
            amountMinor: paymentAttempt.amountMinor,
            currency: paymentAttempt.currency,
            provider: "nomba",
            failureReason,
        });
        await (0, dunning_service_1.scheduleNextDunningAttempt)({
            businessId: paymentAttempt.businessId,
            subscriptionId: paymentAttempt.subscriptionId,
            invoiceId: paymentAttempt.invoiceId,
            customerId: paymentAttempt.customerId,
            mode: paymentAttempt.mode,
            failureReason,
            metadata: {
                source: "nomba_webhook_failed",
                paymentAttemptId: paymentAttempt.id,
            },
        });
        const failedPaymentAttempt = await prisma_1.prisma.paymentAttempt.findUnique({
            where: { id: paymentAttempt.id },
            include: { invoice: true, subscription: true },
        });
        if (failedPaymentAttempt) {
            void (0, merchant_webhooks_service_1.emitMerchantWebhook)({
                businessId: failedPaymentAttempt.businessId,
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
    }
    await prisma_1.prisma.webhookEvent.update({
        where: { id: input.eventId },
        data: { status: "PROCESSED", processedAt: new Date() },
    });
}
