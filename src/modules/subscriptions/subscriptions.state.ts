import { ApiError } from "../../lib/errors";
import type { SubscriptionStatus } from "../../generated/prisma/client";

const allowedTransitions: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  INCOMPLETE: ["ACTIVE", "CANCELLED"],
  TRIALING: ["ACTIVE", "PAST_DUE", "CANCELLED"],
  ACTIVE: ["PAST_DUE", "PAUSED", "CANCELLED"],
  PAST_DUE: ["ACTIVE", "CANCELLED", "PAUSED"],
  PAUSED: ["ACTIVE", "CANCELLED"],
  CANCELLED: [],
  EXPIRED: [],
};

export function assertSubscriptionTransition(
  from: SubscriptionStatus,
  to: SubscriptionStatus
) {
  if (from === to) {
    return;
  }

  if (!allowedTransitions[from].includes(to)) {
    throw new ApiError(
      409,
      `Subscription cannot move from ${from} to ${to}`,
      [],
      "INVALID_SUBSCRIPTION_STATUS_TRANSITION"
    );
  }
}

export function subscriptionTransitionData(
  from: SubscriptionStatus,
  to: SubscriptionStatus
) {
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
