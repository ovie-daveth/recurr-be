import { z } from "zod";
import { paginationQuerySchema } from "../../lib/pagination";

export const businessIdParamsSchema = z.object({
  businessId: z.uuid(),
});

const baseBusinessSchema = z.object({
  contactName: z.string().trim().min(2),
  contactEmail: z.email().toLowerCase(),
  contactPhone: z.string().trim().min(5),
  country: z.string().trim().length(2).toUpperCase().default("NG"),
});

export const createBusinessSchema = z.discriminatedUnion("type", [
  baseBusinessSchema.extend({
    type: z.literal("BUSINESS"),
    businessName: z.string().trim().min(2),
    businessRegistrationNumber: z.string().trim().min(2).optional(),
    taxId: z.string().trim().min(2).optional(),
    website: z.url().optional(),
  }),
  baseBusinessSchema.extend({
    type: z.literal("INDIVIDUAL"),
    legalName: z.string().trim().min(2),
  }),
]);

export const updateBusinessSchema = z.object({
  type: z.enum(["BUSINESS", "INDIVIDUAL"]).optional(),
  businessName: z.string().trim().min(2).optional(),
  businessRegistrationNumber: z.string().trim().min(2).optional(),
  taxId: z.string().trim().min(2).optional(),
  website: z.url().optional(),
  legalName: z.string().trim().min(2).optional(),
  contactName: z.string().trim().min(2).optional(),
  contactEmail: z.email().toLowerCase().optional(),
  contactPhone: z.string().trim().min(5).optional(),
  country: z.string().trim().length(2).toUpperCase().optional(),
});

export const listBusinessesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["PENDING_VERIFICATION", "ACTIVE", "SUSPENDED"]).optional(),
});
