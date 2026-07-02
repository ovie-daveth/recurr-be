import crypto from "crypto";
import { Prisma, type WebhookEndpoint } from "../../generated/prisma/client";
import { prisma } from "../../lib/prisma";

export type MerchantWebhookEventType =
  | "customer.created"
  | "plan.created"
  | "subscription.created"
  | "subscription.trialing"
  | "subscription.active"
  | "subscription.past_due"
  | "subscription.cancelled"
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

    return prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        attempts: { increment: 1 },
        status: delivered ? "DELIVERED" : "FAILED",
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
    return prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        attempts: { increment: 1 },
        status: "FAILED",
        lastAttemptAt: new Date(),
        failureReason:
          error instanceof Error ? error.message : "Webhook delivery failed",
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
