import { z } from "zod";

const businessProfileBaseSchema = z.object({
  email: z.email().toLowerCase(),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(2),
  contactName: z.string().trim().min(2),
  contactPhone: z.string().trim().min(5),
  country: z.string().trim().length(2).toUpperCase().default("NG"),
});

export const merchantSignupSchema = z.discriminatedUnion("type", [
  businessProfileBaseSchema.extend({
    type: z.literal("BUSINESS"),
    businessName: z.string().trim().min(2),
    businessRegistrationNumber: z.string().trim().min(2).optional(),
    taxId: z.string().trim().min(2).optional(),
    website: z.url().optional(),
  }),
  businessProfileBaseSchema.extend({
    type: z.literal("INDIVIDUAL"),
    legalName: z.string().trim().min(2),
  }),
]);

export const merchantVerifyEmailSchema = z.object({
  email: z.email().toLowerCase(),
  token: z.string().trim().min(16),
});

export const merchantLoginSchema = z.object({
  email: z.email().toLowerCase(),
  password: z.string().min(8).max(128),
});
