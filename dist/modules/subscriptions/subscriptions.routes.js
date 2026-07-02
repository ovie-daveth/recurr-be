"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscriptionsRouter = void 0;
const express_1 = require("express");
const async_handler_1 = require("../../lib/async-handler");
const audit_1 = require("../../lib/audit");
const errors_1 = require("../../lib/errors");
const pagination_1 = require("../../lib/pagination");
const prisma_1 = require("../../lib/prisma");
const responses_1 = require("../../lib/responses");
const business_api_key_middleware_1 = require("../../middlewares/business-api-key.middleware");
const idempotency_middleware_1 = require("../../middlewares/idempotency.middleware");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const dunning_service_1 = require("../dunning/dunning.service");
const nomba_service_1 = require("../nomba/nomba.service");
const merchant_webhooks_service_1 = require("../webhook-endpoints/merchant-webhooks.service");
const billing_dates_1 = require("./billing-dates");
const subscriptions_schema_1 = require("./subscriptions.schema");
const subscriptions_state_1 = require("./subscriptions.state");
exports.subscriptionsRouter = (0, express_1.Router)();
exports.subscriptionsRouter.use(business_api_key_middleware_1.businessApiKeyMiddleware);
exports.subscriptionsRouter.post("/", (0, validate_middleware_1.validate)({ body: subscriptions_schema_1.createSubscriptionSchema }), idempotency_middleware_1.idempotencyMiddleware, (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const apiKey = (0, errors_1.requireApiKey)(req);
    const result = await prisma_1.prisma.$transaction(async (tx) => {
        const [customer, plan, paymentMethod] = await Promise.all([
            tx.customer.findFirst({
                where: {
                    id: req.body.customerId,
                    businessId: business.id,
                    mode: apiKey.mode,
                },
            }),
            tx.plan.findFirst({
                where: {
                    id: req.body.planId,
                    businessId: business.id,
                    mode: apiKey.mode,
                },
            }),
            tx.paymentMethod.findFirst({
                where: {
                    id: req.body.paymentMethodId,
                    businessId: business.id,
                    mode: apiKey.mode,
                },
            }),
        ]);
        if (!customer) {
            throw new errors_1.ApiError(404, "Customer not found");
        }
        if (!plan) {
            throw new errors_1.ApiError(404, "Plan not found");
        }
        if (!paymentMethod) {
            throw new errors_1.ApiError(404, "Payment method not found");
        }
        if (customer.status !== "ACTIVE") {
            throw new errors_1.ApiError(409, "Customer is not active", [], "CUSTOMER_NOT_ACTIVE");
        }
        if (plan.status !== "ACTIVE") {
            throw new errors_1.ApiError(409, "Plan is not active", [], "PLAN_NOT_ACTIVE");
        }
        if (paymentMethod.customerId !== customer.id ||
            paymentMethod.status !== "ACTIVE" ||
            !paymentMethod.reusable ||
            !paymentMethod.providerPaymentMethodReference ||
            !paymentMethod.providerCustomerReference) {
            throw new errors_1.ApiError(409, "Payment method is not active and reusable", [], "PAYMENT_METHOD_NOT_USABLE");
        }
        const duplicate = await tx.subscription.findFirst({
            where: {
                businessId: business.id,
                mode: apiKey.mode,
                customerId: customer.id,
                planId: plan.id,
                status: {
                    in: ["INCOMPLETE", "TRIALING", "ACTIVE", "PAST_DUE", "PAUSED"],
                },
            },
        });
        if (duplicate) {
            throw new errors_1.ApiError(409, "Customer already has an open subscription for this plan", [{ subscriptionId: duplicate.id }], "DUPLICATE_SUBSCRIPTION");
        }
        const now = new Date();
        const trialDays = req.body.trialDays ?? plan.trialDays;
        const hasTrial = trialDays > 0;
        const currentPeriodEnd = hasTrial
            ? (0, billing_dates_1.addDays)(now, trialDays)
            : (0, billing_dates_1.addBillingInterval)(now, plan.interval, plan.intervalCount);
        const subscription = await tx.subscription.create({
            data: {
                businessId: business.id,
                mode: apiKey.mode,
                customerId: customer.id,
                planId: plan.id,
                paymentMethodId: paymentMethod.id,
                status: hasTrial ? "TRIALING" : "INCOMPLETE",
                currentPeriodStart: now,
                currentPeriodEnd,
                nextBillingAt: hasTrial ? currentPeriodEnd : null,
                trialEndsAt: hasTrial ? currentPeriodEnd : null,
                metadata: req.body.metadata,
            },
        });
        if (hasTrial) {
            return { subscription, invoice: null, paymentAttempt: null, paymentMethod };
        }
        const invoice = await tx.invoice.create({
            data: {
                businessId: business.id,
                mode: apiKey.mode,
                subscriptionId: subscription.id,
                customerId: customer.id,
                status: "OPEN",
                amountDueMinor: plan.amountMinor,
                currency: plan.currency,
                dueAt: now,
                periodStart: now,
                periodEnd: currentPeriodEnd,
                items: {
                    create: [
                        {
                            businessId: business.id,
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
                businessId: business.id,
                mode: apiKey.mode,
                subscriptionId: subscription.id,
                invoiceId: invoice.id,
                customerId: customer.id,
                paymentMethodId: paymentMethod.id,
                provider: "NOMBA",
                amountMinor: plan.amountMinor,
                currency: plan.currency,
                status: "PENDING",
                attemptNumber: 1,
            },
        });
        return { subscription, invoice, paymentAttempt, paymentMethod };
    });
    const paymentResult = await processInitialPaymentAttempt(result);
    await (0, audit_1.writeAuditLog)({
        businessId: business.id,
        action: "subscription.created",
        entity: "subscription",
        entityId: result.subscription.id,
        metadata: { mode: apiKey.mode },
    });
    const finalSubscription = paymentResult.subscription ?? result.subscription;
    void (0, merchant_webhooks_service_1.emitMerchantWebhook)({
        businessId: business.id,
        type: "subscription.created",
        data: {
            subscription: finalSubscription,
            invoice: paymentResult.invoice,
            paymentAttempt: paymentResult.paymentAttempt,
        },
    }).catch((error) => {
        console.error("Failed to emit subscription.created webhook", error);
    });
    const statusEvent = subscriptionStatusWebhookEvent(finalSubscription.status);
    if (statusEvent) {
        void (0, merchant_webhooks_service_1.emitMerchantWebhook)({
            businessId: business.id,
            type: statusEvent,
            data: {
                subscription: finalSubscription,
                invoice: paymentResult.invoice,
                paymentAttempt: paymentResult.paymentAttempt,
            },
        }).catch((error) => {
            console.error(`Failed to emit ${statusEvent} webhook`, error);
        });
    }
    (0, responses_1.sendSuccess)(res, 201, "Subscription created", sanitizeSubscriptionCreateResult(paymentResult));
}));
function subscriptionStatusWebhookEvent(status) {
    switch (status) {
        case "TRIALING":
            return "subscription.trialing";
        case "ACTIVE":
            return "subscription.active";
        case "PAST_DUE":
            return "subscription.past_due";
        case "CANCELLED":
            return "subscription.cancelled";
        default:
            return null;
    }
}
function sanitizeSubscriptionCreateResult(result) {
    const { paymentMethod: _paymentMethod, ...safeResult } = result;
    const { raw: _chargeRaw, ...paymentProviderResult } = result.paymentProviderResult ?? {};
    const { raw: _verificationRaw, ...verificationResult } = result.verificationResult ?? {};
    return {
        ...safeResult,
        ...(result.paymentProviderResult ? { paymentProviderResult } : {}),
        ...(result.verificationResult ? { verificationResult } : {}),
    };
}
async function processInitialPaymentAttempt(result) {
    if (!result.invoice || !result.paymentAttempt) {
        return result;
    }
    const providerReference = `recur_attempt_${result.paymentAttempt.id}`;
    await prisma_1.prisma.$transaction([
        prisma_1.prisma.paymentAttempt.update({
            where: { id: result.paymentAttempt.id },
            data: {
                providerReference,
                status: "PROCESSING",
            },
        }),
        prisma_1.prisma.invoice.update({
            where: { id: result.invoice.id },
            data: { status: "PAYMENT_PROCESSING" },
        }),
    ]);
    try {
        const charge = await nomba_service_1.paymentProvider.chargeTokenizedCard({
            businessId: result.subscription.businessId,
            mode: result.subscription.mode,
            customerId: result.paymentMethod.customerId,
            providerCustomerReference: result.paymentMethod.providerCustomerReference,
            paymentMethodReference: result.paymentMethod.providerPaymentMethodReference,
            reference: providerReference,
            amountMinor: result.paymentAttempt.amountMinor,
            currency: result.paymentAttempt.currency,
            metadata: {
                recurrSubscriptionId: result.subscription.id,
                recurrInvoiceId: result.invoice.id,
                recurrPaymentAttemptId: result.paymentAttempt.id,
            },
        });
        if (charge.status === "SUCCEEDED") {
            const verified = await nomba_service_1.paymentProvider.getTransaction(providerReference);
            if (!/success|successful|succeeded|paid|approved/i.test(verified.status)) {
                return {
                    ...result,
                    paymentProviderResult: charge,
                    verificationResult: verified,
                };
            }
            const [subscription, invoice, paymentAttempt] = await prisma_1.prisma.$transaction([
                prisma_1.prisma.subscription.update({
                    where: { id: result.subscription.id },
                    data: {
                        ...(0, subscriptions_state_1.subscriptionTransitionData)(result.subscription.status, "ACTIVE"),
                        nextBillingAt: result.subscription.currentPeriodEnd,
                    },
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
                    data: {
                        status: "SUCCEEDED",
                        processedAt: new Date(),
                    },
                }),
            ]);
            return {
                ...result,
                subscription,
                invoice,
                paymentAttempt,
                paymentProviderResult: charge,
                verificationResult: verified,
            };
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
            const dunningAttempt = await (0, dunning_service_1.scheduleNextDunningAttempt)({
                businessId: result.subscription.businessId,
                subscriptionId: result.subscription.id,
                invoiceId: result.invoice.id,
                customerId: result.paymentMethod.customerId,
                mode: result.subscription.mode,
                failureReason: charge.failureReason,
                metadata: {
                    source: "subscription_initial_charge",
                    paymentAttemptId: result.paymentAttempt.id,
                },
            });
            return {
                ...result,
                invoice,
                paymentAttempt,
                dunningAttempt,
                paymentProviderResult: charge,
            };
        }
        const paymentAttempt = await prisma_1.prisma.paymentAttempt.update({
            where: { id: result.paymentAttempt.id },
            data: {
                status: charge.status === "REQUIRES_ACTION" ? "REQUIRES_ACTION" : "PROCESSING",
            },
        });
        return {
            ...result,
            paymentAttempt,
            paymentProviderResult: charge,
        };
    }
    catch (error) {
        const paymentAttempt = await prisma_1.prisma.paymentAttempt.update({
            where: { id: result.paymentAttempt.id },
            data: {
                status: "PENDING",
                failureReason: error instanceof Error ? error.message : "Nomba charge request failed",
            },
        });
        return {
            ...result,
            paymentAttempt,
            paymentProviderError: error instanceof Error ? error.message : "Nomba charge request failed",
        };
    }
}
exports.subscriptionsRouter.get("/", (0, validate_middleware_1.validate)({ query: subscriptions_schema_1.listSubscriptionsQuerySchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const apiKey = (0, errors_1.requireApiKey)(req);
    const query = req.validatedQuery;
    const subscriptions = await prisma_1.prisma.subscription.findMany({
        where: {
            businessId: business.id,
            mode: apiKey.mode,
            ...(query.status ? { status: query.status } : {}),
            ...((0, pagination_1.dateRangeFilter)(query) ? { createdAt: (0, pagination_1.dateRangeFilter)(query) } : {}),
        },
        include: {
            customer: true,
            plan: true,
            paymentMethod: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...(0, pagination_1.paginationArgs)(query),
    });
    const page = (0, pagination_1.paginateResults)(subscriptions, query.limit);
    (0, responses_1.sendSuccess)(res, 200, "Subscriptions returned", {
        subscriptions: page.data,
        pagination: page.pagination,
    });
}));
exports.subscriptionsRouter.get("/:id", (0, validate_middleware_1.validate)({ params: subscriptions_schema_1.subscriptionIdParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const apiKey = (0, errors_1.requireApiKey)(req);
    const subscription = await prisma_1.prisma.subscription.findFirst({
        where: {
            id: String(req.params.id),
            businessId: business.id,
            mode: apiKey.mode,
        },
        include: {
            customer: true,
            plan: true,
            paymentMethod: true,
            invoices: {
                orderBy: [{ createdAt: "desc" }],
                include: { items: true, attempts: true },
            },
        },
    });
    if (!subscription) {
        throw new errors_1.ApiError(404, "Subscription not found");
    }
    (0, responses_1.sendSuccess)(res, 200, "Subscription returned", { subscription });
}));
async function transitionSubscription(req, action) {
    const business = (0, errors_1.requireBusiness)(req);
    const apiKey = (0, errors_1.requireApiKey)(req);
    const id = String(req.params.id);
    const existing = await prisma_1.prisma.subscription.findFirst({
        where: {
            id,
            businessId: business.id,
            mode: apiKey.mode,
        },
    });
    if (!existing) {
        throw new errors_1.ApiError(404, "Subscription not found");
    }
    const targetStatus = action === "pause" ? "PAUSED" : action === "resume" ? "ACTIVE" : "CANCELLED";
    const subscription = await prisma_1.prisma.subscription.update({
        where: { id: existing.id },
        data: (0, subscriptions_state_1.subscriptionTransitionData)(existing.status, targetStatus),
    });
    await (0, audit_1.writeAuditLog)({
        businessId: business.id,
        action: {
            pause: "subscription.paused",
            resume: "subscription.resumed",
            cancel: "subscription.cancelled",
        }[action],
        entity: "subscription",
        entityId: subscription.id,
        metadata: { from: existing.status, to: targetStatus, mode: apiKey.mode },
    });
    if (action === "cancel") {
        void (0, merchant_webhooks_service_1.emitMerchantWebhook)({
            businessId: business.id,
            type: "subscription.cancelled",
            data: { subscription },
        }).catch((error) => {
            console.error("Failed to emit subscription.cancelled webhook", error);
        });
    }
    return subscription;
}
exports.subscriptionsRouter.post("/:id/pause", (0, validate_middleware_1.validate)({ params: subscriptions_schema_1.subscriptionIdParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const subscription = await transitionSubscription(req, "pause");
    (0, responses_1.sendSuccess)(res, 200, "Subscription paused", { subscription });
}));
exports.subscriptionsRouter.post("/:id/resume", (0, validate_middleware_1.validate)({ params: subscriptions_schema_1.subscriptionIdParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const subscription = await transitionSubscription(req, "resume");
    (0, responses_1.sendSuccess)(res, 200, "Subscription resumed", { subscription });
}));
exports.subscriptionsRouter.post("/:id/cancel", (0, validate_middleware_1.validate)({ params: subscriptions_schema_1.subscriptionIdParamsSchema, body: subscriptions_schema_1.cancelSubscriptionSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    if (!req.body.cancelAtPeriodEnd) {
        const subscription = await transitionSubscription(req, "cancel");
        (0, responses_1.sendSuccess)(res, 200, "Subscription cancelled", { subscription });
        return;
    }
    const business = (0, errors_1.requireBusiness)(req);
    const apiKey = (0, errors_1.requireApiKey)(req);
    const id = String(req.params.id);
    const existing = await prisma_1.prisma.subscription.findFirst({
        where: {
            id,
            businessId: business.id,
            mode: apiKey.mode,
        },
    });
    if (!existing) {
        throw new errors_1.ApiError(404, "Subscription not found");
    }
    if (["CANCELLED", "EXPIRED"].includes(existing.status)) {
        throw new errors_1.ApiError(409, "Subscription is already cancelled or expired", [], "SUBSCRIPTION_NOT_CANCELLABLE");
    }
    const subscription = await prisma_1.prisma.subscription.update({
        where: { id: existing.id },
        data: {
            cancelAtPeriodEnd: true,
        },
    });
    await (0, audit_1.writeAuditLog)({
        businessId: business.id,
        action: "subscription.cancel_scheduled",
        entity: "subscription",
        entityId: subscription.id,
        metadata: {
            mode: apiKey.mode,
            currentPeriodEnd: subscription.currentPeriodEnd,
        },
    });
    (0, responses_1.sendSuccess)(res, 200, "Subscription will cancel at period end", {
        subscription,
    });
}));
