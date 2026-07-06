import type { ApiKeyMode, Prisma } from "../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { scheduleNextDunningAttempt } from "../dunning/dunning.service";
import { paymentProvider } from "../nomba/nomba.service";
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
  return (
    getStringProperty(extractNombaData(payload), ["merchantTxRef"]) ??
    getStringProperty(getRecord(extractNombaData(payload)?.transaction), [
      "merchantTxRef",
    ])
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

  if (checkoutReference && eventLooksSuccessful(input.eventType) && !merchantTxRef) {
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
            providerCustomerReference ?? paymentMethod.providerCustomerReference,
          brand: card.brand,
          last4: card.last4,
        },
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

  const paymentAttempt = merchantTxRef
    ? await prisma.paymentAttempt.findFirst({
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

    if (
      webhookAmountMinor !== paymentAttempt.amountMinor ||
      webhookCurrency !== paymentAttempt.currency
    ) {
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
      : await paymentProvider.getTransaction(merchantTxRef!);

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
