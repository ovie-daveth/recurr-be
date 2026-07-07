"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invoicesRouter = void 0;
const express_1 = require("express");
const async_handler_1 = require("../../lib/async-handler");
const errors_1 = require("../../lib/errors");
const pagination_1 = require("../../lib/pagination");
const prisma_1 = require("../../lib/prisma");
const responses_1 = require("../../lib/responses");
const business_resource_auth_middleware_1 = require("../../middlewares/business-resource-auth.middleware");
const idempotency_middleware_1 = require("../../middlewares/idempotency.middleware");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const dunning_service_1 = require("../dunning/dunning.service");
const nomba_service_1 = require("../nomba/nomba.service");
const subscriptions_state_1 = require("../subscriptions/subscriptions.state");
const merchant_webhooks_service_1 = require("../webhook-endpoints/merchant-webhooks.service");
const invoices_schema_1 = require("./invoices.schema");
exports.invoicesRouter = (0, express_1.Router)();
exports.invoicesRouter.use(business_resource_auth_middleware_1.businessResourceAuthMiddleware);
function isSuccessfulProviderStatus(status) {
    return /success|successful|succeeded|paid|approved/i.test(status);
}
async function loadPayableInvoice(input) {
    return prisma_1.prisma.invoice.findFirst({
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
function assertInvoiceCanBePaid(invoice) {
    if (invoice.status === "PAID") {
        throw new errors_1.ApiError(409, "Invoice is already paid", [], "INVOICE_ALREADY_PAID");
    }
    if (["DRAFT", "VOID", "UNCOLLECTIBLE"].includes(invoice.status)) {
        throw new errors_1.ApiError(409, "Invoice cannot be paid in its current state", [{ status: invoice.status }], "INVOICE_NOT_PAYABLE");
    }
    if (invoice.status === "PAYMENT_PROCESSING") {
        throw new errors_1.ApiError(409, "Invoice already has a payment in progress", [], "INVOICE_PAYMENT_IN_PROGRESS");
    }
    const remainingAmount = invoice.amountDueMinor - invoice.amountPaidMinor;
    if (remainingAmount <= 0) {
        throw new errors_1.ApiError(409, "Invoice has no remaining amount to pay", [], "INVOICE_NOT_PAYABLE");
    }
    const paymentMethod = invoice.subscription.paymentMethod;
    if (paymentMethod.customerId !== invoice.customerId ||
        paymentMethod.status !== "ACTIVE" ||
        !paymentMethod.reusable ||
        !paymentMethod.providerPaymentMethodReference ||
        !paymentMethod.providerCustomerReference) {
        throw new errors_1.ApiError(409, "Invoice payment method is not active and reusable", [], "PAYMENT_METHOD_NOT_USABLE");
    }
}
function sanitizeProviderResult(result) {
    const { raw: _raw, ...safeResult } = result;
    return safeResult;
}
async function markInvoicePaymentFailed(input) {
    const { invoice, paymentAttemptId, failureReason } = input;
    const shouldMarkPastDue = ["TRIALING", "ACTIVE", "PAST_DUE"].includes(invoice.subscription.status);
    const result = await prisma_1.prisma.$transaction(async (tx) => {
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
                data: (0, subscriptions_state_1.subscriptionTransitionData)(invoice.subscription.status, "PAST_DUE"),
            })
            : invoice.subscription;
        return { invoice: updatedInvoice, paymentAttempt, subscription };
    });
    const dunningAttempt = await (0, dunning_service_1.scheduleNextDunningAttempt)({
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
exports.invoicesRouter.get("/", (0, validate_middleware_1.validate)({ query: invoices_schema_1.listInvoicesQuerySchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const mode = (0, errors_1.requireBusinessMode)(req);
    const query = req.validatedQuery;
    const invoices = await prisma_1.prisma.invoice.findMany({
        where: {
            businessId: business.id,
            mode: mode,
            ...(query.status ? { status: query.status } : {}),
            ...(query.subscriptionId ? { subscriptionId: query.subscriptionId } : {}),
            ...(query.customerId ? { customerId: query.customerId } : {}),
            ...((0, pagination_1.dateRangeFilter)(query) ? { createdAt: (0, pagination_1.dateRangeFilter)(query) } : {}),
        },
        include: {
            customer: true,
            subscription: true,
            items: true,
            attempts: true,
            dunningAttempts: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...(0, pagination_1.paginationArgs)(query),
    });
    const page = (0, pagination_1.paginateResults)(invoices, query.limit);
    (0, responses_1.sendSuccess)(res, 200, "Invoices returned", {
        invoices: page.data,
        pagination: page.pagination,
    });
}));
exports.invoicesRouter.post("/:id/pay", (0, validate_middleware_1.validate)({ params: invoices_schema_1.invoiceIdParamsSchema, body: invoices_schema_1.payInvoiceSchema }), idempotency_middleware_1.idempotencyMiddleware, (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const mode = (0, errors_1.requireBusinessMode)(req);
    const invoice = await loadPayableInvoice({
        invoiceId: String(req.params.id),
        businessId: business.id,
        mode: mode,
    });
    if (!invoice) {
        throw new errors_1.ApiError(404, "Invoice not found");
    }
    assertInvoiceCanBePaid(invoice);
    const paymentMethod = invoice.subscription.paymentMethod;
    const remainingAmount = invoice.amountDueMinor - invoice.amountPaidMinor;
    const maxAttempt = await prisma_1.prisma.paymentAttempt.aggregate({
        where: { invoiceId: invoice.id },
        _max: { attemptNumber: true },
    });
    const attemptNumber = (maxAttempt._max.attemptNumber ?? 0) + 1;
    const paymentAttempt = await prisma_1.prisma.paymentAttempt.create({
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
    try {
        const charge = await nomba_service_1.paymentProvider.chargeTokenizedCard({
            businessId: business.id,
            mode: mode,
            customerId: invoice.customerId,
            providerCustomerReference: paymentMethod.providerCustomerReference,
            paymentMethodReference: paymentMethod.providerPaymentMethodReference,
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
            const verification = await nomba_service_1.paymentProvider.getTransaction(providerReference, invoice.mode);
            if (!isSuccessfulProviderStatus(verification.status)) {
                const updatedAttempt = await prisma_1.prisma.paymentAttempt.update({
                    where: { id: paymentAttempt.id },
                    data: { status: "PROCESSING" },
                });
                (0, responses_1.sendSuccess)(res, 200, "Invoice payment is processing", {
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
            const [updatedInvoice, updatedAttempt, subscription] = await prisma_1.prisma.$transaction([
                prisma_1.prisma.invoice.update({
                    where: { id: invoice.id },
                    data: {
                        status: "PAID",
                        amountPaidMinor: invoice.amountDueMinor,
                        paidAt: new Date(),
                    },
                }),
                prisma_1.prisma.paymentAttempt.update({
                    where: { id: paymentAttempt.id },
                    data: {
                        status: "SUCCEEDED",
                        processedAt: new Date(),
                    },
                }),
                prisma_1.prisma.subscription.update({
                    where: { id: invoice.subscriptionId },
                    data: {
                        ...(0, subscriptions_state_1.subscriptionTransitionData)(invoice.subscription.status, "ACTIVE"),
                        nextBillingAt: invoice.subscription.currentPeriodEnd,
                    },
                }),
            ]);
            (0, responses_1.sendSuccess)(res, 200, "Invoice paid", {
                invoice: updatedInvoice,
                paymentAttempt: updatedAttempt,
                subscription,
                paymentProviderResult: sanitizeProviderResult(charge),
                verificationResult: sanitizeProviderResult(verification),
            });
            void (0, merchant_webhooks_service_1.emitMerchantWebhook)({
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
            (0, responses_1.sendSuccess)(res, 200, "Invoice payment failed", {
                ...failed,
                paymentProviderResult: sanitizeProviderResult(charge),
            });
            void (0, merchant_webhooks_service_1.emitMerchantWebhook)({
                businessId: business.id,
                type: "invoice.payment_failed",
                data: failed,
            }).catch((error) => {
                console.error("Failed to emit invoice.payment_failed webhook", error);
            });
            return;
        }
        const updatedAttempt = await prisma_1.prisma.paymentAttempt.update({
            where: { id: paymentAttempt.id },
            data: {
                status: charge.status === "REQUIRES_ACTION" ? "REQUIRES_ACTION" : "PROCESSING",
            },
        });
        (0, responses_1.sendSuccess)(res, 200, "Invoice payment is processing", {
            invoice: await loadPayableInvoice({
                invoiceId: invoice.id,
                businessId: business.id,
                mode: mode,
            }),
            paymentAttempt: updatedAttempt,
            paymentProviderResult: sanitizeProviderResult(charge),
        });
    }
    catch (error) {
        const failureReason = error instanceof Error ? error.message : "Nomba charge request failed";
        await markInvoicePaymentFailed({
            invoice,
            paymentAttemptId: paymentAttempt.id,
            failureReason,
        });
        throw new errors_1.ApiError(502, "Invoice payment provider request failed", [{ failureReason, paymentAttemptId: paymentAttempt.id, invoiceId: invoice.id }], "PAYMENT_PROVIDER_FAILED");
    }
}));
exports.invoicesRouter.get("/:id", (0, validate_middleware_1.validate)({ params: invoices_schema_1.invoiceIdParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const mode = (0, errors_1.requireBusinessMode)(req);
    const invoice = await prisma_1.prisma.invoice.findFirst({
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
        throw new errors_1.ApiError(404, "Invoice not found");
    }
    (0, responses_1.sendSuccess)(res, 200, "Invoice returned", { invoice });
}));
