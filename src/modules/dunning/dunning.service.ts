import type { ApiKeyMode, Prisma } from "../../generated/prisma/client";
import { prisma } from "../../lib/prisma";

const DEFAULT_RETRY_DELAYS_MINUTES = [60, 1440, 4320, 10080];

function retryDelaysMinutes() {
  const configured = process.env.DUNNING_RETRY_DELAYS_MINUTES;
  if (!configured) {
    return DEFAULT_RETRY_DELAYS_MINUTES;
  }

  const parsed = configured
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value) && value > 0);

  return parsed.length ? parsed : DEFAULT_RETRY_DELAYS_MINUTES;
}

function addMinutes(date: Date, minutes: number) {
  const next = new Date(date);
  next.setMinutes(next.getMinutes() + minutes);
  return next;
}

export async function scheduleNextDunningAttempt(input: {
  businessId: string;
  subscriptionId: string;
  invoiceId: string;
  customerId: string;
  mode: ApiKeyMode;
  failureReason?: string | null;
  metadata?: Prisma.InputJsonValue;
}) {
  const existingCount = await prisma.dunningAttempt.count({
    where: { invoiceId: input.invoiceId },
  });
  const attemptNumber = existingCount + 1;
  const delays = retryDelaysMinutes();
  const delayMinutes = delays[attemptNumber - 1];

  if (!delayMinutes) {
    return prisma.dunningAttempt.create({
      data: {
        businessId: input.businessId,
        subscriptionId: input.subscriptionId,
        invoiceId: input.invoiceId,
        customerId: input.customerId,
        mode: input.mode,
        attemptNumber,
        status: "EXHAUSTED",
        scheduledAt: new Date(),
        failureReason:
          input.failureReason ?? "Dunning retry policy has been exhausted",
        metadata: input.metadata,
      },
    });
  }

  return prisma.dunningAttempt.create({
    data: {
      businessId: input.businessId,
      subscriptionId: input.subscriptionId,
      invoiceId: input.invoiceId,
      customerId: input.customerId,
      mode: input.mode,
      attemptNumber,
      status: "SCHEDULED",
      scheduledAt: addMinutes(new Date(), delayMinutes),
      failureReason: input.failureReason,
      metadata: {
        ...(typeof input.metadata === "object" && input.metadata !== null
          ? (input.metadata as Record<string, unknown>)
          : {}),
        delayMinutes,
      },
    },
  });
}
