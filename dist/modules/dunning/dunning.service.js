"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleNextDunningAttempt = scheduleNextDunningAttempt;
const prisma_1 = require("../../lib/prisma");
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
function addMinutes(date, minutes) {
    const next = new Date(date);
    next.setMinutes(next.getMinutes() + minutes);
    return next;
}
async function scheduleNextDunningAttempt(input) {
    const existingCount = await prisma_1.prisma.dunningAttempt.count({
        where: { invoiceId: input.invoiceId },
    });
    const attemptNumber = existingCount + 1;
    const delays = retryDelaysMinutes();
    const delayMinutes = delays[attemptNumber - 1];
    if (!delayMinutes) {
        return prisma_1.prisma.dunningAttempt.create({
            data: {
                businessId: input.businessId,
                subscriptionId: input.subscriptionId,
                invoiceId: input.invoiceId,
                customerId: input.customerId,
                mode: input.mode,
                attemptNumber,
                status: "EXHAUSTED",
                scheduledAt: new Date(),
                failureReason: input.failureReason ?? "Dunning retry policy has been exhausted",
                metadata: input.metadata,
            },
        });
    }
    return prisma_1.prisma.dunningAttempt.create({
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
                    ? input.metadata
                    : {}),
                delayMinutes,
            },
        },
    });
}
