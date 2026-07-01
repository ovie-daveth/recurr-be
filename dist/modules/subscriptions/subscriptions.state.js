"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertSubscriptionTransition = assertSubscriptionTransition;
exports.subscriptionTransitionData = subscriptionTransitionData;
const errors_1 = require("../../lib/errors");
const allowedTransitions = {
    INCOMPLETE: ["ACTIVE", "CANCELLED"],
    TRIALING: ["ACTIVE", "PAST_DUE", "CANCELLED"],
    ACTIVE: ["PAST_DUE", "PAUSED", "CANCELLED"],
    PAST_DUE: ["ACTIVE", "CANCELLED", "PAUSED"],
    PAUSED: ["ACTIVE", "CANCELLED"],
    CANCELLED: [],
    EXPIRED: [],
};
function assertSubscriptionTransition(from, to) {
    if (from === to) {
        return;
    }
    if (!allowedTransitions[from].includes(to)) {
        throw new errors_1.ApiError(409, `Subscription cannot move from ${from} to ${to}`, [], "INVALID_SUBSCRIPTION_STATUS_TRANSITION");
    }
}
function subscriptionTransitionData(from, to) {
    assertSubscriptionTransition(from, to);
    const now = new Date();
    return {
        status: to,
        ...(to === "PAUSED" ? { pausedAt: now } : {}),
        ...(from === "PAUSED" && to === "ACTIVE" ? { pausedAt: null } : {}),
        ...(to === "CANCELLED"
            ? { cancelledAt: now, nextBillingAt: null, cancelAtPeriodEnd: false }
            : {}),
    };
}
