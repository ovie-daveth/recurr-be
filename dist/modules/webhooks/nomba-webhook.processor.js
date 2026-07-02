"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processNombaWebhookEvent = processNombaWebhookEvent;
const prisma_1 = require("../../lib/prisma");
const dunning_service_1 = require("../dunning/dunning.service");
const nomba_service_1 = require("../nomba/nomba.service");
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
        getStringProperty(getRecord(data)?.authorization, keys) ??
        getStringProperty(getRecord(data)?.mandate, keys));
}
function extractReference(payload) {
    return getNestedString(payload, [
        "reference",
        "checkoutReference",
        "checkout_reference",
        "paymentReference",
        "payment_reference",
        "merchantTxRef",
        "merchant_tx_ref",
        "requestId",
        "request_id",
    ]);
}
function extractNombaData(payload) {
    const data = getRecord(payload)?.data;
    return getRecord(data);
}
function extractMerchantTxRef(payload) {
    return (getStringProperty(extractNombaData(payload), ["merchantTxRef"]) ??
        getStringProperty(getRecord(extractNombaData(payload)?.transaction), [
            "merchantTxRef",
        ]));
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
        "paymentMethodReference",
        "payment_method_reference",
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
        brand: getNestedString(payload, ["brand", "cardBrand", "card_brand", "scheme"]),
        last4: getNestedString(payload, ["last4", "lastFour", "last_four"]),
    };
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
    if (checkoutReference && eventLooksSuccessful(input.eventType)) {
        const reusableReference = extractReusablePaymentReference(input.payload);
        const providerCustomerReference = extractProviderCustomerReference(input.payload);
        const card = extractCardSummary(input.payload);
        const paymentMethod = await prisma_1.prisma.paymentMethod.findFirst({
            where: {
                mode: input.mode,
                provider: "NOMBA",
                providerSetupReference: checkoutReference,
            },
        });
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
            void (0, merchant_webhooks_service_1.emitMerchantWebhook)({
                businessId: updatedPaymentMethod.businessId,
                type: "payment_method.updated",
                data: { paymentMethod: updatedPaymentMethod },
            }).catch((error) => {
                console.error("Failed to emit payment_method.updated webhook", error);
            });
        }
    }
    const paymentAttempt = merchantTxRef
        ? await prisma_1.prisma.paymentAttempt.findFirst({
            where: {
                mode: input.mode,
                provider: "NOMBA",
                providerReference: merchantTxRef,
            },
            include: {
                invoice: true,
                subscription: true,
            },
        })
        : null;
    if (paymentAttempt && eventLooksSuccessful(input.eventType)) {
        const webhookAmountMinor = extractWebhookAmountMinor(input.payload);
        const webhookCurrency = extractWebhookCurrency(input.payload);
        if (webhookAmountMinor !== paymentAttempt.amountMinor ||
            webhookCurrency !== paymentAttempt.currency) {
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
            : await nomba_service_1.paymentProvider.getTransaction(merchantTxRef);
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
