import crypto from "crypto";
import { Prisma, type WebhookEndpoint } from "../../generated/prisma/client";
import {
  advisoryLockKey,
  tryAcquireTransactionAdvisoryLock,
} from "../../lib/advisory-lock";
import { incrementMetric, observeEvent } from "../../lib/observability";
import { prisma } from "../../lib/prisma";

export type MerchantWebhookEventType =
  | "customer.created"
  | "plan.created"
  | "subscription.created"
  | "subscription.trialing"
  | "subscription.active"
  | "subscription.past_due"
  | "subscription.cancelled"
  | "subscription.plan_changed"
  | "invoice.created"
  | "invoice.payment_succeeded"
  | "invoice.payment_failed"
  | "payment_method.updated"
  | "dunning.retry_scheduled"
  | "dunning.exhausted"
  | "webhook_endpoint.test";

type MerchantWebhookPayload = {
  id: string;
  type: MerchantWebhookEventType;
  businessId: string;
  data: Record<string, unknown>;
  createdAt: string;
};

const DEFAULT_RETRY_DELAYS_MINUTES = [1, 5, 30, 120, 720];

function retryDelaysMinutes() {
  const configured = process.env.WEBHOOK_RETRY_DELAYS_MINUTES;
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

function nextRetryDate(attempts: number) {
  const delayMinutes = retryDelaysMinutes()[attempts - 1];
  return delayMinutes ? addMinutes(new Date(), delayMinutes) : null;
}

function generateEventId() {
  return `evt_${crypto.randomUUID()}`;
}

export function generateWebhookSigningSecret() {
  return `whsec_${crypto.randomBytes(32).toString("base64url")}`;
}

function signPayload(input: {
  secret: string;
  timestamp: string;
  rawBody: string;
}) {
  return crypto
    .createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.rawBody}`)
    .digest("hex");
}

function responseBodyPreview(body: string) {
  return body.length > 1000 ? body.slice(0, 1000) : body;
}

async function postWithTimeout(input: {
  url: string;
  headers: Record<string, string>;
  rawBody: string;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    return await fetch(input.url, {
      method: "POST",
      headers: input.headers,
      body: input.rawBody,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function deliverToEndpoint(input: {
  endpoint: WebhookEndpoint;
  payload: MerchantWebhookPayload;
}) {
  const rawBody = JSON.stringify(input.payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signPayload({
    secret: input.endpoint.secret,
    timestamp,
    rawBody,
  });

  const delivery = await prisma.webhookDelivery.create({
    data: {
      businessId: input.endpoint.businessId,
      endpointId: input.endpoint.id,
      eventId: input.payload.id,
      eventType: input.payload.type,
      payload: input.payload as Prisma.InputJsonValue,
      status: "PENDING",
    },
  });

  try {
    const response = await postWithTimeout({
      url: input.endpoint.url,
      rawBody,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Recurr-Webhooks/1.0",
        "X-Recurr-Event": input.payload.type,
        "X-Recurr-Delivery": delivery.id,
        "X-Recurr-Timestamp": timestamp,
        "X-Recurr-Signature": signature,
      },
    });
    const responseText = await response.text().catch(() => "");
    const delivered = response.status >= 200 && response.status < 300;

    const attempts = delivery.attempts + 1;
    const nextAttemptAt = delivered ? null : nextRetryDate(attempts);
    if (!delivered) {
      incrementMetric("webhooks.delivery_failed", {
        businessId: input.endpoint.businessId,
        eventType: input.payload.type,
        final: !nextAttemptAt,
      });
      observeEvent("warn", "webhooks.delivery_failed", {
        businessId: input.endpoint.businessId,
        endpointId: input.endpoint.id,
        deliveryId: delivery.id,
        eventId: input.payload.id,
        eventType: input.payload.type,
        statusCode: response.status,
        attempts,
        nextAttemptAt,
        final: !nextAttemptAt,
      });
    }

    return prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        attempts,
        status: delivered ? "DELIVERED" : nextAttemptAt ? "RETRYING" : "FAILED",
        nextAttemptAt,
        lastAttemptAt: new Date(),
        deliveredAt: delivered ? new Date() : null,
        lastStatusCode: response.status,
        lastResponseBody: responseBodyPreview(responseText),
        failureReason: delivered
          ? null
          : `Endpoint returned HTTP ${response.status}`,
      },
    });
  } catch (error) {
    const attempts = delivery.attempts + 1;
    const nextAttemptAt = nextRetryDate(attempts);
    const failureReason =
      error instanceof Error ? error.message : "Webhook delivery failed";
    incrementMetric("webhooks.delivery_failed", {
      businessId: input.endpoint.businessId,
      eventType: input.payload.type,
      final: !nextAttemptAt,
    });
    observeEvent("error", "webhooks.delivery_failed", {
      businessId: input.endpoint.businessId,
      endpointId: input.endpoint.id,
      deliveryId: delivery.id,
      eventId: input.payload.id,
      eventType: input.payload.type,
      attempts,
      nextAttemptAt,
      final: !nextAttemptAt,
      failureReason,
    });

    return prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        attempts,
        status: nextAttemptAt ? "RETRYING" : "FAILED",
        nextAttemptAt,
        lastAttemptAt: new Date(),
        failureReason,
      },
    });
  }
}

export async function emitMerchantWebhook(input: {
  businessId: string;
  type: MerchantWebhookEventType;
  data: Record<string, unknown>;
}) {
  const payload: MerchantWebhookPayload = {
    id: generateEventId(),
    type: input.type,
    businessId: input.businessId,
    data: input.data,
    createdAt: new Date().toISOString(),
  };

  const endpoints = await prisma.webhookEndpoint.findMany({
    where: {
      businessId: input.businessId,
      status: "ACTIVE",
      OR: [{ events: { has: "*" } }, { events: { has: input.type } }],
    },
  });

  await Promise.all(
    endpoints.map((endpoint) => deliverToEndpoint({ endpoint, payload }))
  );

  return { event: payload, endpointCount: endpoints.length };
}

export async function sendWebhookEndpointTest(input: {
  endpointId: string;
  businessId: string;
}) {
  const endpoint = await prisma.webhookEndpoint.findFirst({
    where: {
      id: input.endpointId,
      businessId: input.businessId,
      status: "ACTIVE",
    },
  });

  if (!endpoint) {
    return null;
  }

  const payload: MerchantWebhookPayload = {
    id: generateEventId(),
    type: "webhook_endpoint.test",
    businessId: input.businessId,
    data: {
      message: "Recurr webhook endpoint test",
      endpointId: endpoint.id,
    },
    createdAt: new Date().toISOString(),
  };

  return deliverToEndpoint({ endpoint, payload });
}

async function redeliverExistingDelivery(input: {
  deliveryId: string;
}) {
  const claim = await prisma.$transaction(async (tx) => {
    const locked = await tryAcquireTransactionAdvisoryLock(
      tx,
      advisoryLockKey("webhook-delivery", input.deliveryId)
    );

    if (!locked) {
      return null;
    }

    const delivery = await tx.webhookDelivery.findUnique({
      where: { id: input.deliveryId },
      include: { endpoint: true },
    });

    if (!delivery) {
      return null;
    }

    if (
      delivery.status === "RETRYING" &&
      delivery.nextAttemptAt &&
      delivery.nextAttemptAt.getTime() <= Date.now()
    ) {
      const claimedDelivery = await tx.webhookDelivery.update({
        where: { id: delivery.id },
        data: { nextAttemptAt: null },
        include: { endpoint: true },
      });

      return claimedDelivery;
    }

    return delivery;
  });

  if (!claim) {
    return null;
  }

  const delivery = claim;

  if (delivery.status === "DELIVERED") {
    return delivery;
  }

  if (delivery.endpoint.status !== "ACTIVE") {
    incrementMetric("webhooks.delivery_failed", {
      businessId: delivery.businessId,
      eventType: delivery.eventType,
      final: true,
    });
    observeEvent("warn", "webhooks.delivery_failed", {
      businessId: delivery.businessId,
      endpointId: delivery.endpointId,
      deliveryId: delivery.id,
      eventId: delivery.eventId,
      eventType: delivery.eventType,
      final: true,
      failureReason: "Webhook endpoint is not active",
    });
    return prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "FAILED",
        failureReason: "Webhook endpoint is not active",
        nextAttemptAt: null,
      },
    });
  }

  const rawBody = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = signPayload({
    secret: delivery.endpoint.secret,
    timestamp,
    rawBody,
  });

  try {
    const response = await postWithTimeout({
      url: delivery.endpoint.url,
      rawBody,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Recurr-Webhooks/1.0",
        "X-Recurr-Event": delivery.eventType,
        "X-Recurr-Delivery": delivery.id,
        "X-Recurr-Timestamp": timestamp,
        "X-Recurr-Signature": signature,
      },
    });
    const responseText = await response.text().catch(() => "");
    const delivered = response.status >= 200 && response.status < 300;
    const attempts = delivery.attempts + 1;
    const nextAttemptAt = delivered ? null : nextRetryDate(attempts);
    if (!delivered) {
      incrementMetric("webhooks.delivery_failed", {
        businessId: delivery.businessId,
        eventType: delivery.eventType,
        final: !nextAttemptAt,
      });
      observeEvent("warn", "webhooks.delivery_failed", {
        businessId: delivery.businessId,
        endpointId: delivery.endpointId,
        deliveryId: delivery.id,
        eventId: delivery.eventId,
        eventType: delivery.eventType,
        statusCode: response.status,
        attempts,
        nextAttemptAt,
        final: !nextAttemptAt,
      });
    }

    return prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        attempts,
        status: delivered ? "DELIVERED" : nextAttemptAt ? "RETRYING" : "FAILED",
        nextAttemptAt,
        lastAttemptAt: new Date(),
        deliveredAt: delivered ? new Date() : delivery.deliveredAt,
        lastStatusCode: response.status,
        lastResponseBody: responseBodyPreview(responseText),
        failureReason: delivered
          ? null
          : `Endpoint returned HTTP ${response.status}`,
      },
    });
  } catch (error) {
    const attempts = delivery.attempts + 1;
    const nextAttemptAt = nextRetryDate(attempts);
    const failureReason =
      error instanceof Error ? error.message : "Webhook delivery failed";
    incrementMetric("webhooks.delivery_failed", {
      businessId: delivery.businessId,
      eventType: delivery.eventType,
      final: !nextAttemptAt,
    });
    observeEvent("error", "webhooks.delivery_failed", {
      businessId: delivery.businessId,
      endpointId: delivery.endpointId,
      deliveryId: delivery.id,
      eventId: delivery.eventId,
      eventType: delivery.eventType,
      attempts,
      nextAttemptAt,
      final: !nextAttemptAt,
      failureReason,
    });

    return prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        attempts,
        status: nextAttemptAt ? "RETRYING" : "FAILED",
        nextAttemptAt,
        lastAttemptAt: new Date(),
        failureReason,
      },
    });
  }
}

export async function runDueWebhookDeliveries(input: {
  businessId?: string;
  endpointId?: string;
  limit?: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 50;

  const deliveries = await prisma.webhookDelivery.findMany({
    where: {
      ...(input.businessId ? { businessId: input.businessId } : {}),
      ...(input.endpointId ? { endpointId: input.endpointId } : {}),
      status: "RETRYING",
      nextAttemptAt: { lte: now },
    },
    orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true },
  });

  const results = [];

  for (const delivery of deliveries) {
    try {
      const webhookDelivery = await redeliverExistingDelivery({
        deliveryId: delivery.id,
      });
      results.push({
        deliveryId: delivery.id,
        status: webhookDelivery?.status ?? "FAILED",
      });
    } catch (error) {
      results.push({
        deliveryId: delivery.id,
        status: "FAILED",
        reason:
          error instanceof Error ? error.message : "Webhook retry processing failed",
      });
    }
  }

  return {
    processedAt: now,
    count: results.length,
    results,
  };
}
