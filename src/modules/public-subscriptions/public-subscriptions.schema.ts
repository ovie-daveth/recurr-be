import { z } from "zod";

export const publicSubscribeParamsSchema = z.object({
  businessSlug: z.string().trim().min(2),
  planCode: z.string().trim().min(1),
});

export const publicSubscribeQuerySchema = z.object({
  mode: z.enum(["TEST", "LIVE"]).default("TEST"),
});

export const startPublicSubscriptionSchema = z.object({
  mode: z.enum(["TEST", "LIVE"]).default("TEST"),
  email: z.email(),
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  externalReference: z.string().trim().max(120).optional(),
  callbackUrl: z.url().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
