import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { ApiError, requireBusiness, requireBusinessMode } from "../../lib/errors";
import {
  dateRangeFilter,
  paginateResults,
  paginationArgs,
} from "../../lib/pagination";
import { prisma } from "../../lib/prisma";
import { sendSuccess } from "../../lib/responses";
import { businessResourceAuthMiddleware } from "../../middlewares/business-resource-auth.middleware";
import { idempotencyMiddleware } from "../../middlewares/idempotency.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { scheduleNextDunningAttempt } from "../dunning/dunning.service";
import { paymentProvider } from "../nomba/nomba.service";
import { subscriptionTransitionData } from "../subscriptions/subscriptions.state";
import { emitMerchantWebhook } from "../webhook-endpoints/merchant-webhooks.service";
import {
  invoiceIdParamsSchema,
  listInvoicesQuerySchema,
  payInvoiceSchema,
} from "./invoices.schema";

export const invoicesRouter = Router();

invoicesRouter.use(businessResourceAuthMiddleware);

type PayableInvoice = NonNullable<
  Awaited<ReturnType<typeof loadPayableInvoice>>
>;

function isSuccessfulProviderStatus(status: string) {
  return /success|successful|succeeded|paid|approved/i.test(status);
}

async function loadPayableInvoice(input: {
  invoiceId: string;
  businessId: string;
  mode: "TEST" | "LIVE";
}) {
  return prisma.invoice.findFirst({
    where: {
      id: input.invoiceId,
      businessId: input.businessId,
      mode: input.mode,
    },
    include: {
      customer: true,
      items: true,
      attempts: true,
      dunningAttempts: true,
      subscription: {
        include: {
          paymentMethod: true,
        },
      },
    },
  });
}

function assertInvoiceCanBePaid(invoice: PayableInvoice) {
  if (invoice.status === "PAID") {
    throw new ApiError(409, "Invoice is already paid", [], "INVOICE_ALREADY_PAID");
  }

  if (["DRAFT", "VOID", "UNCOLLECTIBLE"].includes(invoice.status)) {
    throw new ApiError(
      409,
      "Invoice cannot be paid in its current state",
      [{ status: invoice.status }],
      "INVOICE_NOT_PAYABLE"
    );
  }

  if (invoice.status === "PAYMENT_PROCESSING") {
    throw new ApiError(
      409,
      "Invoice already has a payment in progress",
      [],
      "INVOICE_PAYMENT_IN_PROGRESS"
    );
  }

  const remainingAmount = invoice.amountDueMinor - invoice.amountPaidMinor;
  if (remainingAmount <= 0) {
    throw new ApiError(
      409,
      "Invoice has no remaining amount to pay",
      [],
      "INVOICE_NOT_PAYABLE"
    );
  }

  const paymentMethod = invoice.subscription.paymentMethod;
  if (
    paymentMethod.customerId !== invoice.customerId ||
    paymentMethod.status !== "ACTIVE" ||
    !paymentMethod.reusable ||
    !paymentMethod.providerPaymentMethodReference ||
    !paymentMethod.providerCustomerReference
  ) {
    throw new ApiError(
      409,
      "Invoice payment method is not active and reusable",
      [],
      "PAYMENT_METHOD_NOT_USABLE"
    );
  }
}

function sanitizeProviderResult<T extends { raw?: unknown } & Record<string, unknown>>(
  result: T
) {
  const { raw: _raw, ...safeResult } = result;
  return safeResult;
}

async function markInvoicePaymentFailed(input: {
  invoice: PayableInvoice;
  paymentAttemptId: string;
  failureReason?: string;
}) {
  const { invoice, paymentAttemptId, failureReason } = input;
  const shouldMarkPastDue = ["TRIALING", "ACTIVE", "PAST_DUE"].includes(
    invoice.subscription.status
  );

  const result = await prisma.$transaction(async (tx) => {
    const updatedInvoice = await tx.invoice.update({
      where: { id: invoice.id },
      data: { status: "PAYMENT_FAILED" },
    });
    const paymentAttempt = await tx.paymentAttempt.update({
      where: { id: paymentAttemptId },
      data: {
        status: "FAILED",
        failureReason,
        processedAt: new Date(),
      },
    });
    const subscription = shouldMarkPastDue
      ? await tx.subscription.update({
          where: { id: invoice.subscriptionId },
          data: subscriptionTransitionData(invoice.subscription.status, "PAST_DUE"),
        })
      : invoice.subscription;

    return { invoice: updatedInvoice, paymentAttempt, subscription };
  });

  const dunningAttempt = await scheduleNextDunningAttempt({
    businessId: invoice.businessId,
    subscriptionId: invoice.subscriptionId,
    invoiceId: invoice.id,
    customerId: invoice.customerId,
    mode: invoice.mode,
    failureReason,
    metadata: {
      source: "manual_invoice_pay",
      paymentAttemptId,
    },
  });

  return { ...result, dunningAttempt };
}

invoicesRouter.get(
  "/",
  validate({ query: listInvoicesQuerySchema }),
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const mode = requireBusinessMode(req);
    const query = req.validatedQuery as typeof listInvoicesQuerySchema._output;

    const invoices = await prisma.invoice.findMany({
      where: {
        businessId: business.id,
        mode: mode,
        ...(query.status ? { status: query.status } : {}),
        ...(query.subscriptionId ? { subscriptionId: query.subscriptionId } : {}),
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(dateRangeFilter(query) ? { createdAt: dateRangeFilter(query) } : {}),
      },
      include: {
        customer: true,
        subscription: true,
        items: true,
        attempts: true,
        dunningAttempts: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...paginationArgs(query),
    });
    const page = paginateResults(invoices, query.limit);

    sendSuccess(res, 200, "Invoices returned", {
      invoices: page.data,
      pagination: page.pagination,
    });
  })
);

invoicesRouter.post(
  "/:id/pay",
  validate({ params: invoiceIdParamsSchema, body: payInvoiceSchema }),
  idempotencyMiddleware,
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const mode = requireBusinessMode(req);

    const invoice = await loadPayableInvoice({
      invoiceId: String(req.params.id),
      businessId: business.id,
      mode: mode,
    });

    if (!invoice) {
      throw new ApiError(404, "Invoice not found");
    }

    assertInvoiceCanBePaid(invoice);

    const paymentMethod = invoice.subscription.paymentMethod;
    const remainingAmount = invoice.amountDueMinor - invoice.amountPaidMinor;
    const maxAttempt = await prisma.paymentAttempt.aggregate({
      where: { invoiceId: invoice.id },
      _max: { attemptNumber: true },
    });
    const attemptNumber = (maxAttempt._max.attemptNumber ?? 0) + 1;

    const paymentAttempt = await prisma.paymentAttempt.create({
      data: {
        businessId: business.id,
        mode: mode,
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

    try {
      const charge = await paymentProvider.chargeTokenizedCard({
        businessId: business.id,
        mode: mode,
        customerId: invoice.customerId,
        providerCustomerReference: paymentMethod.providerCustomerReference!,
        paymentMethodReference: paymentMethod.providerPaymentMethodReference!,
        reference: providerReference,
        amountMinor: remainingAmount,
        currency: invoice.currency,
        metadata: {
          ...(req.body.metadata ?? {}),
          recurrInvoiceId: invoice.id,
          recurrSubscriptionId: invoice.subscriptionId,
          recurrPaymentAttemptId: paymentAttempt.id,
          source: "manual_invoice_pay",
        },
      });

      if (charge.status === "SUCCEEDED") {
        const verification = await paymentProvider.getTransaction(providerReference);
        if (!isSuccessfulProviderStatus(verification.status)) {
          const updatedAttempt = await prisma.paymentAttempt.update({
            where: { id: paymentAttempt.id },
            data: { status: "PROCESSING" },
          });

          sendSuccess(res, 200, "Invoice payment is processing", {
            invoice: await loadPayableInvoice({
              invoiceId: invoice.id,
              businessId: business.id,
              mode: mode,
            }),
            paymentAttempt: updatedAttempt,
            paymentProviderResult: sanitizeProviderResult(charge),
            verificationResult: sanitizeProviderResult(verification),
          });
          return;
        }

        const [updatedInvoice, updatedAttempt, subscription] =
          await prisma.$transaction([
            prisma.invoice.update({
              where: { id: invoice.id },
              data: {
                status: "PAID",
                amountPaidMinor: invoice.amountDueMinor,
                paidAt: new Date(),
              },
            }),
            prisma.paymentAttempt.update({
              where: { id: paymentAttempt.id },
              data: {
                status: "SUCCEEDED",
                processedAt: new Date(),
              },
            }),
            prisma.subscription.update({
              where: { id: invoice.subscriptionId },
              data: {
                ...subscriptionTransitionData(invoice.subscription.status, "ACTIVE"),
                nextBillingAt: invoice.subscription.currentPeriodEnd,
              },
            }),
          ]);

        sendSuccess(res, 200, "Invoice paid", {
          invoice: updatedInvoice,
          paymentAttempt: updatedAttempt,
          subscription,
          paymentProviderResult: sanitizeProviderResult(charge),
          verificationResult: sanitizeProviderResult(verification),
        });
        void emitMerchantWebhook({
          businessId: business.id,
          type: "invoice.payment_succeeded",
          data: {
            invoice: updatedInvoice,
            paymentAttempt: updatedAttempt,
            subscription,
          },
        }).catch((error) => {
          console.error("Failed to emit invoice.payment_succeeded webhook", error);
        });
        return;
      }

      if (charge.status === "FAILED") {
        const failed = await markInvoicePaymentFailed({
          invoice,
          paymentAttemptId: paymentAttempt.id,
          failureReason: charge.failureReason,
        });

        sendSuccess(res, 200, "Invoice payment failed", {
          ...failed,
          paymentProviderResult: sanitizeProviderResult(charge),
        });
        void emitMerchantWebhook({
          businessId: business.id,
          type: "invoice.payment_failed",
          data: failed,
        }).catch((error) => {
          console.error("Failed to emit invoice.payment_failed webhook", error);
        });
        return;
      }

      const updatedAttempt = await prisma.paymentAttempt.update({
        where: { id: paymentAttempt.id },
        data: {
          status:
            charge.status === "REQUIRES_ACTION" ? "REQUIRES_ACTION" : "PROCESSING",
        },
      });

      sendSuccess(res, 200, "Invoice payment is processing", {
        invoice: await loadPayableInvoice({
          invoiceId: invoice.id,
          businessId: business.id,
          mode: mode,
        }),
        paymentAttempt: updatedAttempt,
        paymentProviderResult: sanitizeProviderResult(charge),
      });
    } catch (error) {
      const failureReason =
        error instanceof Error ? error.message : "Nomba charge request failed";
      await markInvoicePaymentFailed({
        invoice,
        paymentAttemptId: paymentAttempt.id,
        failureReason,
      });

      throw new ApiError(
        502,
        "Invoice payment provider request failed",
        [{ failureReason, paymentAttemptId: paymentAttempt.id, invoiceId: invoice.id }],
        "PAYMENT_PROVIDER_FAILED"
      );
    }
  })
);

invoicesRouter.get(
  "/:id",
  validate({ params: invoiceIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const mode = requireBusinessMode(req);

    const invoice = await prisma.invoice.findFirst({
      where: {
        id: String(req.params.id),
        businessId: business.id,
        mode: mode,
      },
      include: {
        customer: true,
        subscription: true,
        items: true,
        attempts: true,
        dunningAttempts: true,
      },
    });

    if (!invoice) {
      throw new ApiError(404, "Invoice not found");
    }

    sendSuccess(res, 200, "Invoice returned", { invoice });
  })
);

