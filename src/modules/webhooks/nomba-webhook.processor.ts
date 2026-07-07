import type { ApiKeyMode, Prisma } from "../../generated/prisma/client";
import { observeEvent } from "../../lib/observability";
import { prisma } from "../../lib/prisma";
import { scheduleNextDunningAttempt } from "../dunning/dunning.service";
import { paymentProvider } from "../nomba/nomba.service";
import { addBillingInterval } from "../subscriptions/billing-dates";
import { subscriptionTransitionData } from "../subscriptions/subscriptions.state";
import { emitMerchantWebhook } from "../webhook-endpoints/merchant-webhooks.service";

function getRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function getStringProperty(value: unknown, keys: string[]) {
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

function getNestedString(payload: unknown, keys: string[]) {
  const data = getRecord(payload)?.data;
  return (
    getStringProperty(payload, keys) ??
    getStringProperty(data, keys) ??
    getStringProperty(getRecord(data)?.transaction, keys) ??
    getStringProperty(getRecord(data)?.order, keys) ??
    getStringProperty(getRecord(data)?.paymentMethod, keys) ??
    getStringProperty(getRecord(data)?.tokenizedCardData, keys) ??
    getStringProperty(getRecord(data)?.tokenized_card_data, keys) ??
    getStringProperty(getRecord(data)?.authorization, keys) ??
    getStringProperty(getRecord(data)?.mandate, keys)
  );
}

function getNombaCheckoutReference(payload: unknown) {
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

  return (
    getStringProperty(getRecord(data)?.order, checkoutKeys) ??
    getStringProperty(getRecord(data)?.transaction, checkoutKeys) ??
    getStringProperty(data, checkoutKeys) ??
    getStringProperty(payload, checkoutKeys) ??
    getStringProperty(payload, ["requestId", "request_id"])
  );
}

function extractReference(payload: unknown) {
  return getNombaCheckoutReference(payload);
}

function extractPossibleSetupReferences(payload: unknown) {
  return [
    extractReference(payload),
    getNestedString(payload, ["merchantTxRef", "merchant_tx_ref"]),
    getNestedString(payload, ["orderReference", "order_reference"]),
  ].filter((value): value is string => Boolean(value));
}

function extractNombaData(payload: unknown) {
  const data = getRecord(payload)?.data;
  return getRecord(data);
}

function extractMerchantTxRef(payload: unknown) {
  const data = extractNombaData(payload);
  return (
    getStringProperty(data, ["merchantTxRef", "merchant_tx_ref"]) ??
    getStringProperty(getRecord(data?.transaction), [
      "merchantTxRef",
      "merchant_tx_ref",
    ]) ??
    getStringProperty(getRecord(data?.order), ["merchantTxRef", "merchant_tx_ref"])
  );
}

function extractWebhookAmountMinor(payload: unknown) {
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

function extractWebhookCurrency(payload: unknown) {
  const data = extractNombaData(payload);
  return (
    getStringProperty(data, ["currency"]) ??
    getStringProperty(getRecord(data?.order), ["currency"])
  );
}

function extractReusablePaymentReference(payload: unknown) {
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

function extractProviderCustomerReference(payload: unknown) {
  return getNestedString(payload, [
    "customerId",
    "customer_id",
    "nombaCustomerId",
    "nomba_customer_id",
    "providerCustomerReference",
    "provider_customer_reference",
  ]);
}

function extractCardSummary(payload: unknown) {
  return {
    brand: getNestedString(payload, [
      "brand",
      "cardType",
      "card_type",
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
      "cardPan",
      "card_pan",
      "maskedPan",
      "masked_pan",
    ])?.slice(-4),
  };
}

function getMetadataString(metadata: unknown, key: string) {
  const record = getRecord(metadata);
  const value = record?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function createHostedSubscriptionAfterPaymentMethodSetup(input: {
  paymentMethodId: string;
  checkoutReference?: string;
}) {
  const paymentMethod = await prisma.paymentMethod.findUnique({
    where: { id: input.paymentMethodId },
  });

  if (!paymentMethod) {
    return null;
  }

  const planId = getMetadataString(paymentMethod.metadata, "hostedSubscriptionPlanId");
  if (!planId) {
    return null;
  }

  const plan = await prisma.plan.findFirst({
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

  const duplicate = await prisma.subscription.findFirst({
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
  const currentPeriodEnd = addBillingInterval(
    now,
    plan.interval,
    plan.intervalCount
  );

  const result = await prisma.$transaction(async (tx) => {
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

  void emitMerchantWebhook({
    businessId: paymentMethod.businessId,
    type: "subscription.created",
    data: result,
  }).catch((error) => {
    console.error("Failed to emit subscription.created webhook", error);
  });

  void emitMerchantWebhook({
    businessId: paymentMethod.businessId,
    type: "subscription.active",
    data: { subscription: result.subscription },
  }).catch((error) => {
    console.error("Failed to emit subscription.active webhook", error);
  });

  void emitMerchantWebhook({
    businessId: paymentMethod.businessId,
    type: "invoice.payment_succeeded",
    data: result,
  }).catch((error) => {
    console.error("Failed to emit invoice.payment_succeeded webhook", error);
  });

  return result;
}

async function markWebhookProcessedWithNote(input: {
  eventId: string;
  note: string;
}) {
  await prisma.webhookEvent.update({
    where: { id: input.eventId },
    data: {
      status: "PROCESSED",
      processedAt: new Date(),
      failureReason: input.note,
    },
  });
}

function eventLooksSuccessful(eventType?: string | null) {
  if (!eventType) {
    return false;
  }

  return eventType === "payment_success" || eventType === "mandate.debit_success";
}

function eventLooksFailed(eventType?: string | null) {
  if (!eventType) {
    return false;
  }

  return /fail|failed|declined|reversed/i.test(eventType);
}

export async function processNombaWebhookEvent(input: {
  eventId: string;
  mode: ApiKeyMode;
  eventType?: string | null;
  payload: unknown;
  skipTransactionVerification?: boolean;
}) {
  const checkoutReference = extractReference(input.payload);
  const merchantTxRef = extractMerchantTxRef(input.payload);
  const paymentAttemptReference = merchantTxRef ?? checkoutReference;

  if (
    !checkoutReference &&
    !merchantTxRef &&
    !eventLooksSuccessful(input.eventType) &&
    !eventLooksFailed(input.eventType)
  ) {
    await prisma.webhookEvent.update({
      where: { id: input.eventId },
      data: { status: "PROCESSED", processedAt: new Date() },
    });
    return;
  }

  const paymentAttempt = paymentAttemptReference
    ? await prisma.paymentAttempt.findFirst({
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

  if (
    checkoutReference &&
    eventLooksSuccessful(input.eventType) &&
    !paymentAttempt
  ) {
    const reusableReference = extractReusablePaymentReference(input.payload);
    const providerCustomerReference = extractProviderCustomerReference(input.payload);
    const card = extractCardSummary(input.payload);
    const possibleReferences = extractPossibleSetupReferences(input.payload);

    const paymentMethod = await prisma.paymentMethod.findFirst({
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
      observeEvent("warn", "provider_webhook.payment_method_token_missing", {
        mode: input.mode,
        eventId: input.eventId,
        checkoutReference,
        provider: "nomba",
        message:
          "Payment method setup webhook matched, but Nomba payload did not include cardId/token reference",
      });

      await markWebhookProcessedWithNote({
        eventId: input.eventId,
        note:
          "Payment method setup webhook matched, but Nomba payload did not include cardId/token reference",
      });
      return;
    }

    if (paymentMethod && reusableReference) {
      const updatedPaymentMethod = await prisma.paymentMethod.update({
        where: { id: paymentMethod.id },
        data: {
          status: "ACTIVE",
          reusable: true,
          type: "CARD",
          providerPaymentMethodReference: reusableReference,
          providerCustomerReference:
            providerCustomerReference ??
            paymentMethod.providerCustomerReference ??
            paymentMethod.customerId,
          brand: card.brand,
          last4: card.last4,
        },
      });
      const portalUpdateSubscriptionId = getMetadataString(
        paymentMethod.metadata,
        "portalUpdateSubscriptionId"
      );

      if (portalUpdateSubscriptionId) {
        await prisma.subscription.updateMany({
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

      observeEvent("info", "provider_webhook.payment_method_activated", {
        businessId: updatedPaymentMethod.businessId,
        mode: updatedPaymentMethod.mode,
        eventId: input.eventId,
        paymentMethodId: updatedPaymentMethod.id,
        customerId: updatedPaymentMethod.customerId,
        checkoutReference,
        provider: "nomba",
        message: "Nomba webhook activated reusable payment method",
      });

      void emitMerchantWebhook({
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

    if (
      webhookAmountMinor !== paymentAttempt.amountMinor ||
      webhookCurrency !== paymentAttempt.currency
    ) {
      observeEvent("error", "provider_webhook.payment_attempt_mismatch", {
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
        failureReason:
          "Nomba webhook amount/currency does not match payment attempt",
      });

      await prisma.webhookEvent.update({
        where: { id: input.eventId },
        data: {
          status: "FAILED",
          processedAt: new Date(),
          failureReason:
            "Nomba webhook amount/currency does not match payment attempt",
        },
      });
      return;
    }

    const verified = input.skipTransactionVerification
      ? { status: "PAYMENT SUCCESSFUL" }
      : await paymentProvider.getTransaction(
          paymentAttempt.providerReference!,
          paymentAttempt.mode
        );

    if (/success|successful|succeeded|paid|approved/i.test(verified.status)) {
      const paymentUpdates: Prisma.PrismaPromise<unknown>[] = [
        prisma.paymentAttempt.update({
          where: { id: paymentAttempt.id },
          data: { status: "SUCCEEDED", processedAt: new Date() },
        }),
        prisma.invoice.update({
          where: { id: paymentAttempt.invoiceId },
          data: {
            status: "PAID",
            paidAt: new Date(),
            amountPaidMinor: paymentAttempt.amountMinor,
          },
        }),
      ];

      if (!["CANCELLED", "EXPIRED"].includes(paymentAttempt.subscription.status)) {
        paymentUpdates.push(
          prisma.subscription.update({
            where: { id: paymentAttempt.subscriptionId },
            data: {
              ...subscriptionTransitionData(
                paymentAttempt.subscription.status,
                "ACTIVE"
              ),
              nextBillingAt: paymentAttempt.subscription.currentPeriodEnd,
            },
          })
        );
      }

      await prisma.$transaction(paymentUpdates);

      observeEvent("info", "provider_webhook.payment_attempt_succeeded", {
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

      const settledPaymentAttempt = await prisma.paymentAttempt.findUnique({
        where: { id: paymentAttempt.id },
        include: { invoice: true, subscription: true },
      });

      if (settledPaymentAttempt) {
        void emitMerchantWebhook({
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

        void emitMerchantWebhook({
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
        where: { id: paymentAttempt.invoiceId },
        data: { status: "PAYMENT_FAILED" },
      }),
    ]);

    observeEvent("warn", "provider_webhook.payment_attempt_failed", {
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

    await scheduleNextDunningAttempt({
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

    const failedPaymentAttempt = await prisma.paymentAttempt.findUnique({
      where: { id: paymentAttempt.id },
      include: { invoice: true, subscription: true },
    });

    if (failedPaymentAttempt) {
      void emitMerchantWebhook({
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

  await prisma.webhookEvent.update({
    where: { id: input.eventId },
    data: { status: "PROCESSED", processedAt: new Date() },
  });
}
