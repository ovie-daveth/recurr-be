"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.publicSubscriptionsRouter = void 0;
const crypto_1 = __importDefault(require("crypto"));
const express_1 = require("express");
const async_handler_1 = require("../../lib/async-handler");
const audit_1 = require("../../lib/audit");
const errors_1 = require("../../lib/errors");
const prisma_1 = require("../../lib/prisma");
const responses_1 = require("../../lib/responses");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const nomba_service_1 = require("../nomba/nomba.service");
const merchant_webhooks_service_1 = require("../webhook-endpoints/merchant-webhooks.service");
const public_subscriptions_schema_1 = require("./public-subscriptions.schema");
exports.publicSubscriptionsRouter = (0, express_1.Router)();
exports.publicSubscriptionsRouter.get("/subscribe/:businessSlug/:planCode", (0, validate_middleware_1.validate)({ params: public_subscriptions_schema_1.publicSubscribeParamsSchema, query: public_subscriptions_schema_1.publicSubscribeQuerySchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const { businessSlug, planCode } = req.params;
    const { mode } = req.validatedQuery;
    const plan = await prisma_1.prisma.plan.findFirst({
        where: {
            code: planCode,
            mode,
            status: "ACTIVE",
            business: {
                slug: businessSlug,
                status: "ACTIVE",
            },
        },
        include: {
            business: {
                select: {
                    id: true,
                    slug: true,
                    name: true,
                    website: true,
                    country: true,
                },
            },
        },
    });
    if (!plan) {
        throw new errors_1.ApiError(404, "Subscription page not found");
    }
    (0, responses_1.sendSuccess)(res, 200, "Subscription page returned", {
        business: plan.business,
        plan,
    });
}));
exports.publicSubscriptionsRouter.post("/subscribe/:businessSlug/:planCode/start", (0, validate_middleware_1.validate)({
    params: public_subscriptions_schema_1.publicSubscribeParamsSchema,
    body: public_subscriptions_schema_1.startPublicSubscriptionSchema,
}), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const { businessSlug, planCode } = req.params;
    const mode = req.body.mode;
    const plan = await prisma_1.prisma.plan.findFirst({
        where: {
            code: planCode,
            mode,
            status: "ACTIVE",
            business: {
                slug: businessSlug,
                status: "ACTIVE",
            },
        },
        include: { business: true },
    });
    if (!plan) {
        throw new errors_1.ApiError(404, "Subscription page not found");
    }
    const customer = await prisma_1.prisma.customer.upsert({
        where: {
            businessId_mode_email: {
                businessId: plan.businessId,
                mode,
                email: req.body.email,
            },
        },
        create: {
            businessId: plan.businessId,
            mode,
            email: req.body.email,
            name: req.body.name,
            phone: req.body.phone,
            externalReference: req.body.externalReference,
            metadata: {
                ...(req.body.metadata ?? {}),
                source: "hosted_subscription_page",
            },
        },
        update: {
            status: "ACTIVE",
            ...(req.body.name ? { name: req.body.name } : {}),
            ...(req.body.phone ? { phone: req.body.phone } : {}),
            ...(req.body.externalReference
                ? { externalReference: req.body.externalReference }
                : {}),
        },
    });
    const duplicate = await prisma_1.prisma.subscription.findFirst({
        where: {
            businessId: plan.businessId,
            mode,
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
    const requestedSetupReference = `hosted_sub_${crypto_1.default
        .randomUUID()
        .replace(/-/g, "")}`;
    const checkout = await nomba_service_1.paymentProvider.createCheckoutOrder({
        businessId: plan.businessId,
        mode,
        customerId: customer.id,
        customerEmail: customer.email,
        customerName: customer.name,
        reference: requestedSetupReference,
        amountMinor: plan.amountMinor,
        currency: plan.currency,
        callbackUrl: req.body.callbackUrl,
        metadata: {
            ...(req.body.metadata ?? {}),
            source: "hosted_subscription_page",
            hostedSubscriptionPlanId: plan.id,
            hostedSubscriptionPlanCode: plan.code,
            hostedSubscriptionCustomerId: customer.id,
            hostedSubscriptionBusinessSlug: businessSlug,
        },
    });
    const paymentMethod = await prisma_1.prisma.paymentMethod.create({
        data: {
            businessId: plan.businessId,
            mode,
            customerId: customer.id,
            provider: "NOMBA",
            type: "UNKNOWN",
            status: "PENDING_SETUP",
            providerSetupReference: checkout.reference,
            metadata: {
                ...(req.body.metadata ?? {}),
                source: "hosted_subscription_page",
                requestedSetupReference,
                hostedSubscriptionPlanId: plan.id,
                hostedSubscriptionPlanCode: plan.code,
                hostedSubscriptionInitialAmountMinor: plan.amountMinor,
                checkoutRaw: checkout.raw,
            },
        },
    });
    await (0, audit_1.writeAuditLog)({
        businessId: plan.businessId,
        action: "hosted_subscription.started",
        entity: "payment_method",
        entityId: paymentMethod.id,
        metadata: { customerId: customer.id, planId: plan.id, mode },
    });
    void (0, merchant_webhooks_service_1.emitMerchantWebhook)({
        businessId: plan.businessId,
        type: "payment_method.updated",
        data: { paymentMethod, customer, plan },
    }).catch((error) => {
        console.error("Failed to emit payment_method.updated webhook", error);
    });
    (0, responses_1.sendSuccess)(res, 201, "Subscription checkout created", {
        business: {
            id: plan.business.id,
            slug: plan.business.slug,
            name: plan.business.name,
        },
        customer,
        plan,
        paymentMethod,
        checkout: {
            provider: checkout.provider,
            reference: checkout.reference,
            checkoutUrl: checkout.checkoutUrl,
        },
    });
}));
