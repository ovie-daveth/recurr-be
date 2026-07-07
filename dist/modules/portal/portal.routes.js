"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.portalRouter = void 0;
const crypto_1 = __importDefault(require("crypto"));
const express_1 = require("express");
const advisory_lock_1 = require("../../lib/advisory-lock");
const api_keys_1 = require("../../lib/api-keys");
const async_handler_1 = require("../../lib/async-handler");
const audit_1 = require("../../lib/audit");
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
const portal_schema_1 = require("./portal.schema");
exports.portalRouter = (0, express_1.Router)();
function buildPortalUrl(token) {
    const baseUrl = process.env.PORTAL_BASE_URL ||
        process.env.FRONTEND_BASE_URL ||
        process.env.APP_BASE_URL ||
        "http://localhost:5173";
    const url = new URL(`/portal/session/${token}`, baseUrl);
    return url.toString();
}
function addMinutes(date, minutes) {
    const next = new Date(date);
    next.setMinutes(next.getMinutes() + minutes);
    return next;
}
function publicPaymentMethod(paymentMethod) {
    return {
        id: paymentMethod.id,
        type: paymentMethod.type,
        status: paymentMethod.status,
        provider: paymentMethod.provider,
        brand: paymentMethod.brand,
        last4: paymentMethod.last4,
        expMonth: paymentMethod.expMonth,
        expYear: paymentMethod.expYear,
        reusable: paymentMethod.reusable,
        createdAt: paymentMethod.createdAt,
        updatedAt: paymentMethod.updatedAt,
    };
}
async function requireActivePortalSession(token) {
    const tokenHash = (0, api_keys_1.hashApiKey)(token);
    const portalSession = await prisma_1.prisma.portalSession.findUnique({
        where: { tokenHash },
    });
    if (!portalSession) {
        throw new errors_1.ApiError(404, "Portal session not found");
    }
    if (portalSession.revokedAt || portalSession.status === "REVOKED") {
        throw new errors_1.ApiError(410, "Portal session has been revoked", [], "PORTAL_SESSION_REVOKED");
    }
    if (portalSession.expiresAt <= new Date()) {
        await prisma_1.prisma.portalSession.update({
            where: { id: portalSession.id },
            data: { status: "EXPIRED" },
        });
        throw new errors_1.ApiError(410, "Portal session has expired", [], "PORTAL_SESSION_EXPIRED");
    }
    if (!portalSession.usedAt) {
        await prisma_1.prisma.portalSession.update({
            where: { id: portalSession.id },
            data: { usedAt: new Date() },
        });
    }
    return portalSession;
}
function sanitizeProviderResult(result) {
    const { raw: _raw, ...safeResult } = result;
    return safeResult;
}
function successfulProviderStatus(status) {
    return /success|successful|succeeded|paid|approved/i.test(status);
}
function compatibleForImmediateProration(input) {
    return (input.oldPlan.currency === input.newPlan.currency &&
        input.oldPlan.interval === input.newPlan.interval &&
        input.oldPlan.intervalCount === input.newPlan.intervalCount);
}
function calculateProrationAmountMinor(input) {
    const totalMs = Math.max(1, input.periodEnd.getTime() - input.periodStart.getTime());
    const remainingMs = Math.min(totalMs, Math.max(0, input.periodEnd.getTime() - input.now.getTime()));
    const amountDifferenceMinor = input.newAmountMinor - input.oldAmountMinor;
    return {
        amountMinor: Math.max(0, Math.ceil((amountDifferenceMinor * remainingMs) / totalMs)),
        remainingMs,
        totalMs,
        remainingRatio: remainingMs / totalMs,
    };
}
exports.portalRouter.post("/sessions", business_resource_auth_middleware_1.businessResourceAuthMiddleware, (0, validate_middleware_1.validate)({ body: portal_schema_1.createPortalSessionSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const mode = (0, errors_1.requireBusinessMode)(req);
    const customer = await prisma_1.prisma.customer.findFirst({
        where: {
            id: req.body.customerId,
            businessId: business.id,
            mode: mode,
        },
    });
    if (!customer) {
        throw new errors_1.ApiError(404, "Customer not found");
    }
    if (customer.status !== "ACTIVE") {
        throw new errors_1.ApiError(409, "Customer is not active", [], "CUSTOMER_NOT_ACTIVE");
    }
    const generated = (0, api_keys_1.generateVerificationToken)();
    const expiresAt = addMinutes(new Date(), req.body.expiresInMinutes);
    const portalSession = await prisma_1.prisma.portalSession.create({
        data: {
            businessId: business.id,
            customerId: customer.id,
            mode: mode,
            tokenHash: generated.hash,
            returnUrl: req.body.returnUrl,
            expiresAt,
            metadata: req.body.metadata,
        },
        select: {
            id: true,
            businessId: true,
            customerId: true,
            mode: true,
            status: true,
            returnUrl: true,
            expiresAt: true,
            usedAt: true,
            revokedAt: true,
            metadata: true,
            createdAt: true,
            updatedAt: true,
        },
    });
    await (0, audit_1.writeAuditLog)({
        businessId: business.id,
        action: "portal_session.created",
        entity: "portal_session",
        entityId: portalSession.id,
        metadata: {
            customerId: customer.id,
            mode: mode,
        },
    });
    (0, responses_1.sendSuccess)(res, 201, "Portal session created", {
        portalSession,
        url: buildPortalUrl(generated.token),
        token: generated.token,
        warning: "Return the URL to the subscriber. The raw token is only returned once.",
    });
}));
exports.portalRouter.get("/sessions", business_resource_auth_middleware_1.businessResourceAuthMiddleware, (0, validate_middleware_1.validate)({ query: portal_schema_1.listPortalSessionsQuerySchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const mode = (0, errors_1.requireBusinessMode)(req);
    const query = req.validatedQuery;
    const sessions = await prisma_1.prisma.portalSession.findMany({
        where: {
            businessId: business.id,
            mode: mode,
            ...(query.status ? { status: query.status } : {}),
            ...(query.customerId ? { customerId: query.customerId } : {}),
            ...((0, pagination_1.dateRangeFilter)(query) ? { createdAt: (0, pagination_1.dateRangeFilter)(query) } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...(0, pagination_1.paginationArgs)(query),
        select: {
            id: true,
            businessId: true,
            customerId: true,
            mode: true,
            status: true,
            returnUrl: true,
            expiresAt: true,
            usedAt: true,
            revokedAt: true,
            metadata: true,
            createdAt: true,
            updatedAt: true,
        },
    });
    const page = (0, pagination_1.paginateResults)(sessions, query.limit);
    (0, responses_1.sendSuccess)(res, 200, "Portal sessions returned", {
        portalSessions: page.data,
        pagination: page.pagination,
    });
}));
exports.portalRouter.post("/sessions/:id/revoke", business_resource_auth_middleware_1.businessResourceAuthMiddleware, (0, validate_middleware_1.validate)({ params: portal_schema_1.portalSessionIdParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const mode = (0, errors_1.requireBusinessMode)(req);
    const existing = await prisma_1.prisma.portalSession.findFirst({
        where: {
            id: String(req.params.id),
            businessId: business.id,
            mode: mode,
        },
    });
    if (!existing) {
        throw new errors_1.ApiError(404, "Portal session not found");
    }
    const portalSession = await prisma_1.prisma.portalSession.update({
        where: { id: existing.id },
        data: {
            status: "REVOKED",
            revokedAt: existing.revokedAt ?? new Date(),
        },
    });
    await (0, audit_1.writeAuditLog)({
        businessId: business.id,
        action: "portal_session.revoked",
        entity: "portal_session",
        entityId: portalSession.id,
        metadata: { mode: mode },
    });
    (0, responses_1.sendSuccess)(res, 200, "Portal session revoked", { portalSession });
}));
exports.portalRouter.get("/sessions/:token", (0, validate_middleware_1.validate)({ params: portal_schema_1.portalSessionTokenParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const portalSession = await requireActivePortalSession(String(req.params.token));
    const [business, customer, subscriptions, invoices, paymentMethods] = await Promise.all([
        prisma_1.prisma.business.findUnique({
            where: { id: portalSession.businessId },
            select: {
                id: true,
                name: true,
                type: true,
                contactEmail: true,
                contactPhone: true,
                country: true,
            },
        }),
        prisma_1.prisma.customer.findFirst({
            where: {
                id: portalSession.customerId,
                businessId: portalSession.businessId,
                mode: portalSession.mode,
            },
            select: {
                id: true,
                email: true,
                name: true,
                phone: true,
                externalReference: true,
                status: true,
                createdAt: true,
                updatedAt: true,
            },
        }),
        prisma_1.prisma.subscription.findMany({
            where: {
                customerId: portalSession.customerId,
                businessId: portalSession.businessId,
                mode: portalSession.mode,
            },
            include: {
                plan: true,
                paymentMethod: true,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }),
        prisma_1.prisma.invoice.findMany({
            where: {
                customerId: portalSession.customerId,
                businessId: portalSession.businessId,
                mode: portalSession.mode,
            },
            include: {
                items: true,
                attempts: true,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 20,
        }),
        prisma_1.prisma.paymentMethod.findMany({
            where: {
                customerId: portalSession.customerId,
                businessId: portalSession.businessId,
                mode: portalSession.mode,
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }),
    ]);
    (0, responses_1.sendSuccess)(res, 200, "Portal session returned", {
        portalSession: {
            id: portalSession.id,
            mode: portalSession.mode,
            status: portalSession.status,
            returnUrl: portalSession.returnUrl,
            expiresAt: portalSession.expiresAt,
        },
        business,
        customer,
        subscriptions: subscriptions.map((subscription) => ({
            ...subscription,
            paymentMethod: publicPaymentMethod(subscription.paymentMethod),
        })),
        invoices,
        paymentMethods: paymentMethods.map(publicPaymentMethod),
    });
}));
exports.portalRouter.post("/sessions/:token/invoices/:invoiceId/pay", (0, validate_middleware_1.validate)({
    params: portal_schema_1.portalInvoicePayParamsSchema,
    body: portal_schema_1.portalInvoicePaySchema,
}), idempotency_middleware_1.idempotencyMiddleware, (0, async_handler_1.asyncHandler)(async (req, res) => {
    const portalSession = await requireActivePortalSession(String(req.params.token));
    const invoice = await prisma_1.prisma.invoice.findFirst({
        where: {
            id: String(req.params.invoiceId),
            businessId: portalSession.businessId,
            customerId: portalSession.customerId,
            mode: portalSession.mode,
        },
        include: {
            attempts: true,
            subscription: {
                include: { paymentMethod: true },
            },
        },
    });
    if (!invoice) {
        throw new errors_1.ApiError(404, "Invoice not found");
    }
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
    const maxAttempt = await prisma_1.prisma.paymentAttempt.aggregate({
        where: { invoiceId: invoice.id },
        _max: { attemptNumber: true },
    });
    const attemptNumber = (maxAttempt._max.attemptNumber ?? 0) + 1;
    const paymentAttempt = await prisma_1.prisma.paymentAttempt.create({
        data: {
            businessId: portalSession.businessId,
            mode: portalSession.mode,
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
            businessId: portalSession.businessId,
            mode: portalSession.mode,
            customerId: invoice.customerId,
            providerCustomerReference: paymentMethod.providerCustomerReference,
            paymentMethodReference: paymentMethod.providerPaymentMethodReference,
            reference: providerReference,
            amountMinor: remainingAmount,
            currency: invoice.currency,
            metadata: {
                ...(req.body.metadata ?? {}),
                source: "portal_invoice_pay",
                recurrInvoiceId: invoice.id,
                recurrSubscriptionId: invoice.subscriptionId,
                recurrPaymentAttemptId: paymentAttempt.id,
            },
        });
        if (charge.status === "SUCCEEDED") {
            const verification = await nomba_service_1.paymentProvider.getTransaction(providerReference, portalSession.mode);
            if (!successfulProviderStatus(verification.status)) {
                const updatedAttempt = await prisma_1.prisma.paymentAttempt.update({
                    where: { id: paymentAttempt.id },
                    data: { status: "PROCESSING" },
                });
                (0, responses_1.sendSuccess)(res, 200, "Invoice payment is processing", {
                    invoice: await prisma_1.prisma.invoice.findUnique({ where: { id: invoice.id } }),
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
                    data: { status: "SUCCEEDED", processedAt: new Date() },
                }),
                prisma_1.prisma.subscription.update({
                    where: { id: invoice.subscriptionId },
                    data: {
                        ...(0, subscriptions_state_1.subscriptionTransitionData)(invoice.subscription.status, "ACTIVE"),
                        nextBillingAt: invoice.subscription.currentPeriodEnd,
                    },
                }),
            ]);
            void (0, merchant_webhooks_service_1.emitMerchantWebhook)({
                businessId: portalSession.businessId,
                type: "invoice.payment_succeeded",
                data: {
                    invoice: updatedInvoice,
                    paymentAttempt: updatedAttempt,
                    subscription,
                },
            }).catch((error) => {
                console.error("Failed to emit invoice.payment_succeeded webhook", error);
            });
            (0, responses_1.sendSuccess)(res, 200, "Invoice paid", {
                invoice: updatedInvoice,
                paymentAttempt: updatedAttempt,
                subscription,
                paymentProviderResult: sanitizeProviderResult(charge),
                verificationResult: sanitizeProviderResult(verification),
            });
            return;
        }
        if (charge.status === "FAILED") {
            const [updatedInvoice, updatedAttempt, subscription] = await prisma_1.prisma.$transaction([
                prisma_1.prisma.invoice.update({
                    where: { id: invoice.id },
                    data: { status: "PAYMENT_FAILED" },
                }),
                prisma_1.prisma.paymentAttempt.update({
                    where: { id: paymentAttempt.id },
                    data: {
                        status: "FAILED",
                        failureReason: charge.failureReason,
                        processedAt: new Date(),
                    },
                }),
                prisma_1.prisma.subscription.update({
                    where: { id: invoice.subscriptionId },
                    data: (0, subscriptions_state_1.subscriptionTransitionData)(invoice.subscription.status, "PAST_DUE"),
                }),
            ]);
            const dunningAttempt = await (0, dunning_service_1.scheduleNextDunningAttempt)({
                businessId: portalSession.businessId,
                subscriptionId: invoice.subscriptionId,
                invoiceId: invoice.id,
                customerId: invoice.customerId,
                mode: portalSession.mode,
                failureReason: charge.failureReason,
                metadata: { source: "portal_invoice_pay", paymentAttemptId: paymentAttempt.id },
            });
            void (0, merchant_webhooks_service_1.emitMerchantWebhook)({
                businessId: portalSession.businessId,
                type: "invoice.payment_failed",
                data: {
                    invoice: updatedInvoice,
                    paymentAttempt: updatedAttempt,
                    subscription,
                    dunningAttempt,
                },
            }).catch((error) => {
                console.error("Failed to emit invoice.payment_failed webhook", error);
            });
            (0, responses_1.sendSuccess)(res, 200, "Invoice payment failed", {
                invoice: updatedInvoice,
                paymentAttempt: updatedAttempt,
                subscription,
                dunningAttempt,
                paymentProviderResult: sanitizeProviderResult(charge),
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
            invoice: await prisma_1.prisma.invoice.findUnique({ where: { id: invoice.id } }),
            paymentAttempt: updatedAttempt,
            paymentProviderResult: sanitizeProviderResult(charge),
        });
    }
    catch (error) {
        const failureReason = error instanceof Error ? error.message : "Nomba charge request failed";
        const updatedAttempt = await prisma_1.prisma.paymentAttempt.update({
            where: { id: paymentAttempt.id },
            data: { status: "PENDING", failureReason },
        });
        throw new errors_1.ApiError(502, "Invoice payment provider request failed", [{ failureReason, paymentAttemptId: updatedAttempt.id, invoiceId: invoice.id }], "PAYMENT_PROVIDER_FAILED");
    }
}));
exports.portalRouter.post("/sessions/:token/payment-methods/setup-checkout", (0, validate_middleware_1.validate)({
    params: portal_schema_1.portalSessionTokenParamsSchema,
    body: portal_schema_1.portalPaymentMethodSetupSchema,
}), idempotency_middleware_1.idempotencyMiddleware, (0, async_handler_1.asyncHandler)(async (req, res) => {
    const portalSession = await requireActivePortalSession(String(req.params.token));
    if (req.body.subscriptionId) {
        const subscription = await prisma_1.prisma.subscription.findFirst({
            where: {
                id: req.body.subscriptionId,
                businessId: portalSession.businessId,
                customerId: portalSession.customerId,
                mode: portalSession.mode,
            },
        });
        if (!subscription) {
            throw new errors_1.ApiError(404, "Subscription not found");
        }
    }
    const customer = await prisma_1.prisma.customer.findFirst({
        where: {
            id: portalSession.customerId,
            businessId: portalSession.businessId,
            mode: portalSession.mode,
        },
    });
    if (!customer) {
        throw new errors_1.ApiError(404, "Customer not found");
    }
    if (customer.status !== "ACTIVE") {
        throw new errors_1.ApiError(409, "Customer is not active", [], "CUSTOMER_NOT_ACTIVE");
    }
    const reference = `pm_setup_${crypto_1.default.randomUUID().replace(/-/g, "")}`;
    const metadata = {
        ...(req.body.metadata ?? {}),
        source: "portal_payment_method_update",
        portalSessionId: portalSession.id,
        portalUpdateSubscriptionId: req.body.subscriptionId,
    };
    const checkout = await nomba_service_1.paymentProvider.createCheckoutOrder({
        businessId: portalSession.businessId,
        mode: portalSession.mode,
        customerId: customer.id,
        customerEmail: customer.email,
        customerName: customer.name,
        reference,
        amountMinor: 100,
        currency: "NGN",
        callbackUrl: req.body.callbackUrl,
        metadata,
    });
    const paymentMethod = await prisma_1.prisma.paymentMethod.create({
        data: {
            businessId: portalSession.businessId,
            mode: portalSession.mode,
            customerId: customer.id,
            provider: "NOMBA",
            type: "UNKNOWN",
            status: "PENDING_SETUP",
            providerSetupReference: checkout.reference,
            metadata: {
                ...metadata,
                requestedSetupReference: reference,
                checkoutRaw: checkout.raw,
            },
        },
    });
    await (0, audit_1.writeAuditLog)({
        businessId: portalSession.businessId,
        action: "portal.payment_method.setup_requested",
        entity: "payment_method",
        entityId: paymentMethod.id,
        metadata: {
            customerId: customer.id,
            subscriptionId: req.body.subscriptionId,
            mode: portalSession.mode,
        },
    });
    (0, responses_1.sendSuccess)(res, 201, "Payment method setup checkout created", {
        paymentMethod: publicPaymentMethod(paymentMethod),
        checkout: {
            provider: checkout.provider,
            reference: checkout.reference,
            checkoutUrl: checkout.checkoutUrl,
        },
    });
}));
exports.portalRouter.post("/sessions/:token/subscriptions/:subscriptionId/cancel", (0, validate_middleware_1.validate)({
    params: portal_schema_1.portalSubscriptionActionParamsSchema,
    body: portal_schema_1.portalCancelSubscriptionSchema,
}), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const portalSession = await requireActivePortalSession(String(req.params.token));
    const existing = await prisma_1.prisma.subscription.findFirst({
        where: {
            id: String(req.params.subscriptionId),
            businessId: portalSession.businessId,
            customerId: portalSession.customerId,
            mode: portalSession.mode,
        },
    });
    if (!existing) {
        throw new errors_1.ApiError(404, "Subscription not found");
    }
    if (["CANCELLED", "EXPIRED"].includes(existing.status)) {
        throw new errors_1.ApiError(409, "Subscription is already cancelled or expired", [], "SUBSCRIPTION_NOT_CANCELLABLE");
    }
    const subscription = req.body.cancelAtPeriodEnd
        ? await prisma_1.prisma.subscription.update({
            where: { id: existing.id },
            data: { cancelAtPeriodEnd: true },
        })
        : await prisma_1.prisma.subscription.update({
            where: { id: existing.id },
            data: (0, subscriptions_state_1.subscriptionTransitionData)(existing.status, "CANCELLED"),
        });
    await (0, audit_1.writeAuditLog)({
        businessId: portalSession.businessId,
        action: req.body.cancelAtPeriodEnd
            ? "portal.subscription.cancel_scheduled"
            : "portal.subscription.cancelled",
        entity: "subscription",
        entityId: subscription.id,
        metadata: {
            customerId: portalSession.customerId,
            mode: portalSession.mode,
        },
    });
    if (!req.body.cancelAtPeriodEnd) {
        void (0, merchant_webhooks_service_1.emitMerchantWebhook)({
            businessId: portalSession.businessId,
            type: "subscription.cancelled",
            data: { subscription },
        }).catch((error) => {
            console.error("Failed to emit subscription.cancelled webhook", error);
        });
    }
    (0, responses_1.sendSuccess)(res, 200, req.body.cancelAtPeriodEnd
        ? "Subscription will cancel at period end"
        : "Subscription cancelled", { subscription });
}));
exports.portalRouter.post("/sessions/:token/subscriptions/:subscriptionId/change-plan", (0, validate_middleware_1.validate)({
    params: portal_schema_1.portalSubscriptionActionParamsSchema,
    body: portal_schema_1.portalChangePlanSchema,
}), idempotency_middleware_1.idempotencyMiddleware, (0, async_handler_1.asyncHandler)(async (req, res) => {
    const portalSession = await requireActivePortalSession(String(req.params.token));
    const now = new Date();
    const result = await prisma_1.prisma.$transaction(async (tx) => {
        const locked = await (0, advisory_lock_1.tryAcquireTransactionAdvisoryLock)(tx, (0, advisory_lock_1.advisoryLockKey)("portal-subscription-change-plan", String(req.params.subscriptionId)));
        if (!locked) {
            throw new errors_1.ApiError(409, "Subscription plan change is already being processed", [], "SUBSCRIPTION_CHANGE_IN_PROGRESS");
        }
        const subscription = await tx.subscription.findFirst({
            where: {
                id: String(req.params.subscriptionId),
                businessId: portalSession.businessId,
                customerId: portalSession.customerId,
                mode: portalSession.mode,
            },
            include: {
                plan: true,
                paymentMethod: true,
            },
        });
        if (!subscription) {
            throw new errors_1.ApiError(404, "Subscription not found");
        }
        if (subscription.status !== "ACTIVE") {
            throw new errors_1.ApiError(409, "Only active subscriptions can change plan", [], "SUBSCRIPTION_NOT_ACTIVE");
        }
        const newPlan = await tx.plan.findFirst({
            where: {
                id: req.body.newPlanId,
                businessId: portalSession.businessId,
                mode: portalSession.mode,
            },
        });
        if (!newPlan) {
            throw new errors_1.ApiError(404, "New plan not found");
        }
        if (newPlan.status !== "ACTIVE") {
            throw new errors_1.ApiError(409, "New plan is not active", [], "PLAN_NOT_ACTIVE");
        }
        if (newPlan.id === subscription.planId) {
            throw new errors_1.ApiError(409, "Subscription is already on this plan", [], "SUBSCRIPTION_ALREADY_ON_PLAN");
        }
        if (newPlan.currency !== subscription.plan.currency) {
            throw new errors_1.ApiError(409, "Plan currency must match current subscription currency", [], "PLAN_CURRENCY_MISMATCH");
        }
        const isDowngrade = newPlan.amountMinor < subscription.plan.amountMinor;
        const scheduleForPeriodEnd = req.body.effective === "PERIOD_END" || isDowngrade;
        await tx.subscriptionScheduleChange.updateMany({
            where: {
                subscriptionId: subscription.id,
                status: "PENDING",
            },
            data: {
                status: "CANCELLED",
                cancelledAt: now,
            },
        });
        if (scheduleForPeriodEnd) {
            const scheduledChange = await tx.subscriptionScheduleChange.create({
                data: {
                    businessId: portalSession.businessId,
                    mode: portalSession.mode,
                    subscriptionId: subscription.id,
                    fromPlanId: subscription.planId,
                    toPlanId: newPlan.id,
                    effectiveAt: subscription.currentPeriodEnd,
                    metadata: {
                        ...(req.body.metadata ?? {}),
                        source: "portal_change_plan",
                        requestedEffective: req.body.effective,
                        reason: isDowngrade
                            ? "downgrade_scheduled_for_period_end"
                            : "customer_requested_period_end",
                    },
                },
            });
            return {
                action: "SCHEDULED",
                subscription,
                oldPlan: subscription.plan,
                newPlan,
                scheduledChange,
                invoice: null,
                paymentAttempt: null,
            };
        }
        if (!compatibleForImmediateProration({ oldPlan: subscription.plan, newPlan })) {
            throw new errors_1.ApiError(409, "Immediate proration requires plans with the same currency and billing interval", [], "PLAN_INTERVAL_MISMATCH");
        }
        const proration = req.body.prorationBehavior === "NONE"
            ? { amountMinor: 0, remainingMs: 0, totalMs: 0, remainingRatio: 0 }
            : calculateProrationAmountMinor({
                oldAmountMinor: subscription.plan.amountMinor,
                newAmountMinor: newPlan.amountMinor,
                periodStart: subscription.currentPeriodStart,
                periodEnd: subscription.currentPeriodEnd,
                now,
            });
        if (proration.amountMinor <= 0) {
            const updatedSubscription = await tx.subscription.update({
                where: { id: subscription.id },
                data: { planId: newPlan.id },
            });
            return {
                action: "CHANGED",
                subscription: updatedSubscription,
                oldPlan: subscription.plan,
                newPlan,
                proration,
                invoice: null,
                paymentAttempt: null,
            };
        }
        const paymentMethod = subscription.paymentMethod;
        if (paymentMethod.status !== "ACTIVE" ||
            !paymentMethod.reusable ||
            !paymentMethod.providerPaymentMethodReference ||
            !paymentMethod.providerCustomerReference) {
            throw new errors_1.ApiError(409, "Payment method is not active and reusable", [], "PAYMENT_METHOD_NOT_USABLE");
        }
        const invoice = await tx.invoice.create({
            data: {
                businessId: portalSession.businessId,
                mode: portalSession.mode,
                subscriptionId: subscription.id,
                customerId: portalSession.customerId,
                status: "OPEN",
                amountDueMinor: proration.amountMinor,
                currency: newPlan.currency,
                dueAt: now,
                periodStart: now,
                periodEnd: subscription.currentPeriodEnd,
                metadata: {
                    ...(req.body.metadata ?? {}),
                    type: "PORTAL_PLAN_CHANGE_PRORATION",
                    oldPlanId: subscription.planId,
                    newPlanId: newPlan.id,
                    proration,
                },
                items: {
                    create: [
                        {
                            businessId: portalSession.businessId,
                            subscriptionId: subscription.id,
                            planId: newPlan.id,
                            description: `Proration: ${subscription.plan.name} to ${newPlan.name}`,
                            amountMinor: proration.amountMinor,
                            currency: newPlan.currency,
                            periodStart: now,
                            periodEnd: subscription.currentPeriodEnd,
                            metadata: {
                                type: "PORTAL_PLAN_CHANGE_PRORATION",
                                oldPlanId: subscription.planId,
                                newPlanId: newPlan.id,
                                proration,
                            },
                        },
                    ],
                },
            },
            include: { items: true },
        });
        const paymentAttempt = await tx.paymentAttempt.create({
            data: {
                businessId: portalSession.businessId,
                mode: portalSession.mode,
                subscriptionId: subscription.id,
                invoiceId: invoice.id,
                customerId: portalSession.customerId,
                paymentMethodId: paymentMethod.id,
                provider: "NOMBA",
                amountMinor: proration.amountMinor,
                currency: newPlan.currency,
                status: "PENDING",
                attemptNumber: 1,
            },
        });
        return {
            action: "PAYMENT_REQUIRED",
            subscription,
            oldPlan: subscription.plan,
            newPlan,
            proration,
            invoice,
            paymentAttempt,
            paymentMethod,
        };
    });
    if (!result.invoice || !result.paymentAttempt || !("paymentMethod" in result)) {
        if (result.action === "CHANGED") {
            void (0, merchant_webhooks_service_1.emitMerchantWebhook)({
                businessId: portalSession.businessId,
                type: "subscription.plan_changed",
                data: {
                    subscription: result.subscription,
                    oldPlan: result.oldPlan,
                    newPlan: result.newPlan,
                },
            }).catch((error) => {
                console.error("Failed to emit subscription.plan_changed webhook", error);
            });
        }
        (0, responses_1.sendSuccess)(res, 200, result.action === "SCHEDULED"
            ? "Subscription plan change scheduled"
            : "Subscription plan changed", result);
        return;
    }
    const providerReference = `recur_attempt_${result.paymentAttempt.id}`;
    await prisma_1.prisma.$transaction([
        prisma_1.prisma.paymentAttempt.update({
            where: { id: result.paymentAttempt.id },
            data: { providerReference, status: "PROCESSING" },
        }),
        prisma_1.prisma.invoice.update({
            where: { id: result.invoice.id },
            data: { status: "PAYMENT_PROCESSING" },
        }),
    ]);
    const charge = await nomba_service_1.paymentProvider.chargeTokenizedCard({
        businessId: portalSession.businessId,
        mode: portalSession.mode,
        customerId: portalSession.customerId,
        providerCustomerReference: result.paymentMethod.providerCustomerReference,
        paymentMethodReference: result.paymentMethod.providerPaymentMethodReference,
        reference: providerReference,
        amountMinor: result.paymentAttempt.amountMinor,
        currency: result.paymentAttempt.currency,
        metadata: {
            source: "portal_subscription_plan_change",
            recurrSubscriptionId: result.subscription.id,
            recurrInvoiceId: result.invoice.id,
            recurrPaymentAttemptId: result.paymentAttempt.id,
            oldPlanId: result.oldPlan.id,
            newPlanId: result.newPlan.id,
        },
    });
    if (charge.status === "SUCCEEDED") {
        const verification = await nomba_service_1.paymentProvider.getTransaction(providerReference, portalSession.mode);
        if (successfulProviderStatus(verification.status)) {
            const [subscription, invoice, paymentAttempt] = await prisma_1.prisma.$transaction([
                prisma_1.prisma.subscription.update({
                    where: { id: result.subscription.id },
                    data: { planId: result.newPlan.id },
                }),
                prisma_1.prisma.invoice.update({
                    where: { id: result.invoice.id },
                    data: {
                        status: "PAID",
                        paidAt: new Date(),
                        amountPaidMinor: result.paymentAttempt.amountMinor,
                    },
                }),
                prisma_1.prisma.paymentAttempt.update({
                    where: { id: result.paymentAttempt.id },
                    data: { status: "SUCCEEDED", processedAt: new Date() },
                }),
            ]);
            void (0, merchant_webhooks_service_1.emitMerchantWebhook)({
                businessId: portalSession.businessId,
                type: "subscription.plan_changed",
                data: {
                    subscription,
                    oldPlan: result.oldPlan,
                    newPlan: result.newPlan,
                    invoice,
                    paymentAttempt,
                },
            }).catch((error) => {
                console.error("Failed to emit subscription.plan_changed webhook", error);
            });
            (0, responses_1.sendSuccess)(res, 200, "Subscription plan changed", {
                ...result,
                action: "CHANGED",
                subscription,
                invoice,
                paymentAttempt,
                paymentProviderResult: sanitizeProviderResult(charge),
                verificationResult: sanitizeProviderResult(verification),
            });
            return;
        }
    }
    if (charge.status === "FAILED") {
        const [invoice, paymentAttempt] = await prisma_1.prisma.$transaction([
            prisma_1.prisma.invoice.update({
                where: { id: result.invoice.id },
                data: { status: "PAYMENT_FAILED" },
            }),
            prisma_1.prisma.paymentAttempt.update({
                where: { id: result.paymentAttempt.id },
                data: {
                    status: "FAILED",
                    failureReason: charge.failureReason,
                    processedAt: new Date(),
                },
            }),
        ]);
        (0, responses_1.sendSuccess)(res, 200, "Subscription plan change payment failed", {
            ...result,
            action: "PAYMENT_FAILED",
            invoice,
            paymentAttempt,
            paymentProviderResult: sanitizeProviderResult(charge),
        });
        return;
    }
    const paymentAttempt = await prisma_1.prisma.paymentAttempt.update({
        where: { id: result.paymentAttempt.id },
        data: {
            status: charge.status === "REQUIRES_ACTION" ? "REQUIRES_ACTION" : "PROCESSING",
        },
    });
    (0, responses_1.sendSuccess)(res, 200, "Subscription plan change payment is processing", {
        ...result,
        paymentAttempt,
        paymentProviderResult: sanitizeProviderResult(charge),
    });
}));
