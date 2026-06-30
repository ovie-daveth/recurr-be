import { z } from "zod";

const baseTenantSchema = z.object({
  email: z.email().toLowerCase(),
  contactName: z.string().trim().min(2),
  contactPhone: z.string().trim().min(5),
  country: z.string().trim().length(2).toUpperCase().default("NG"),
  apiKeyName: z.string().trim().min(2).default("Default API key"),
});

export const createTenantSchema = z.discriminatedUnion("type", [
  baseTenantSchema.extend({
    type: z.literal("BUSINESS"),
    businessName: z.string().trim().min(2),
    businessRegistrationNumber: z.string().trim().min(2).optional(),
    taxId: z.string().trim().min(2).optional(),
    website: z.url().optional(),
  }),
  baseTenantSchema.extend({
    type: z.literal("INDIVIDUAL"),
    legalName: z.string().trim().min(2),
  }),
]);

export const verifyTenantEmailSchema = z.object({
  email: z.email().toLowerCase(),
  token: z.string().trim().min(16),
});
