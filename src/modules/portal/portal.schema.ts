import { z } from "zod";
import { paginationQuerySchema } from "../../lib/pagination";

const metadataSchema = z.record(z.string(), z.unknown()).optional();

export const createPortalSessionSchema = z.object({
  customerId: z.uuid(),
  returnUrl: z.url().optional(),
  expiresInMinutes: z.coerce.number().int().min(5).max(1440).default(60),
  metadata: metadataSchema,
});

export const portalSessionTokenParamsSchema = z.object({
  token: z.string().trim().min(16),
});

export const portalInvoicePayParamsSchema = portalSessionTokenParamsSchema.extend({
  invoiceId: z.uuid(),
});

export const portalSubscriptionActionParamsSchema =
  portalSessionTokenParamsSchema.extend({
    subscriptionId: z.uuid(),
  });

export const portalSessionIdParamsSchema = z.object({
  id: z.uuid(),
});

export const listPortalSessionsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["ACTIVE", "EXPIRED", "REVOKED"]).optional(),
  customerId: z.uuid().optional(),
});

export const portalInvoicePaySchema = z.object({
  metadata: metadataSchema,
});

export const portalPaymentMethodSetupSchema = z.object({
  callbackUrl: z.url().optional(),
  subscriptionId: z.uuid().optional(),
  metadata: metadataSchema,
});

export const portalCancelSubscriptionSchema = z.object({
  cancelAtPeriodEnd: z.boolean().default(true),
});

export const portalChangePlanSchema = z.object({
  newPlanId: z.uuid(),
  effective: z.enum(["IMMEDIATE", "PERIOD_END"]).default("IMMEDIATE"),
  prorationBehavior: z.enum(["CREATE_PRORATION", "NONE"]).default("CREATE_PRORATION"),
  metadata: metadataSchema,
});
