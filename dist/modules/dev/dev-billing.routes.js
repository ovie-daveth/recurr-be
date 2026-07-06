"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.devBillingRouter = void 0;
const express_1 = require("express");
const async_handler_1 = require("../../lib/async-handler");
const errors_1 = require("../../lib/errors");
const prisma_1 = require("../../lib/prisma");
const responses_1 = require("../../lib/responses");
const merchant_session_middleware_1 = require("../../middlewares/merchant-session.middleware");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const billing_service_1 = require("../billing/billing.service");
const dev_billing_schema_1 = require("./dev-billing.schema");
exports.devBillingRouter = (0, express_1.Router)();
exports.devBillingRouter.use(merchant_session_middleware_1.merchantSessionMiddleware);
async function requireBillingDevAccess(businessId, userId) {
    const membership = await prisma_1.prisma.businessMember.findFirst({
        where: {
            businessId,
            userId,
            role: { in: ["OWNER", "ADMIN", "DEVELOPER"] },
        },
    });
    if (!membership) {
        throw new errors_1.ApiError(404, "Business not found", [], "BUSINESS_NOT_FOUND");
    }
}
exports.devBillingRouter.post("/run-due", (0, validate_middleware_1.validate)({ body: dev_billing_schema_1.runDueBillingSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const input = req.body;
    await requireBillingDevAccess(input.businessId, user.id);
    const result = await (0, billing_service_1.runDueBilling)(input);
    (0, responses_1.sendSuccess)(res, 200, "Due billing run completed", result);
}));
exports.devBillingRouter.post("/subscriptions/:id/fast-forward", (0, validate_middleware_1.validate)({
    params: dev_billing_schema_1.fastForwardSubscriptionParamsSchema,
    body: dev_billing_schema_1.fastForwardSubscriptionBillingSchema,
}), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const input = req.body;
    const subscriptionId = String(req.params.id);
    await requireBillingDevAccess(input.businessId, user.id);
    const subscription = await prisma_1.prisma.subscription.findFirst({
        where: {
            id: subscriptionId,
            businessId: input.businessId,
            mode: input.mode,
        },
    });
    if (!subscription) {
        throw new errors_1.ApiError(404, "Subscription not found", [], "SUBSCRIPTION_NOT_FOUND");
    }
    if (!["ACTIVE", "TRIALING"].includes(subscription.status)) {
        throw new errors_1.ApiError(409, "Only ACTIVE or TRIALING subscriptions can be fast-forwarded for billing", [{ status: subscription.status }], "SUBSCRIPTION_NOT_BILLABLE");
    }
    if (subscription.cancelAtPeriodEnd) {
        throw new errors_1.ApiError(409, "Subscription is scheduled to cancel at period end", [], "SUBSCRIPTION_CANCEL_SCHEDULED");
    }
    const nextBillingAt = new Date(Date.now() - input.minutesAgo * 60 * 1000);
    const updatedSubscription = await prisma_1.prisma.subscription.update({
        where: { id: subscription.id },
        data: { nextBillingAt },
    });
    (0, responses_1.sendSuccess)(res, 200, "Subscription billing date fast-forwarded", {
        subscription: updatedSubscription,
        workerHint: "The billing worker should pick this subscription up on its next billing.runDue cycle.",
    });
}));
