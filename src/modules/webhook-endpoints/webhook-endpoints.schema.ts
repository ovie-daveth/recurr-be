import { z } from "zod";
import { paginationQuerySchema } from "../../lib/pagination";

export const merchantWebhookEvents = [
  "*",
  "customer.created",
  "plan.created",
  "subscription.created",
  "subscription.trialing",
  "subscription.active",
  "subscription.past_due",
  "subscription.cancelled",
  "invoice.created",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "payment_method.updated",
  "dunning.retry_scheduled",
  "dunning.exhausted",
] as const;

export const webhookEndpointIdParamsSchema = z.object({
  id: z.uuid(),
});

export const createWebhookEndpointSchema = z.object({
  url: z.url(),
  description: z.string().trim().max(255).optional(),
  events: z.array(z.enum(merchantWebhookEvents)).min(1).default(["*"]),
});

export const listWebhookEndpointsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});

export const listWebhookDeliveriesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["PENDING", "DELIVERED", "FAILED", "RETRYING"]).optional(),
  eventType: z.string().trim().optional(),
});
