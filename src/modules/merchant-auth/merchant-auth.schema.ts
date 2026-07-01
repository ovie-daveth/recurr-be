import { z } from "zod";

const merchantSignupBaseSchema = z.object({
  email: z.email().toLowerCase(),
  password: z.string().min(8).max(128),
  contactPhone: z.string().trim().min(5),
  country: z.string().trim().length(2).toUpperCase().default("NG"),
});

export const merchantSignupSchema = z.discriminatedUnion("type", [
  merchantSignupBaseSchema.extend({
    type: z.literal("BUSINESS"),
    name: z.string().trim().min(2),
    businessName: z.string().trim().min(2),
    businessRegistrationNumber: z.string().trim().min(2).optional(),
    taxId: z.string().trim().min(2).optional(),
    website: z.url().optional(),
    contactName: z.string().trim().min(2),
  }),
  merchantSignupBaseSchema.extend({
    type: z.literal("INDIVIDUAL"),
    legalName: z.string().trim().min(2),
    displayName: z.string().trim().min(2).optional(),
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

export const merchantRefreshSessionSchema = z.object({
  refreshToken: z.string().trim().min(32),
});

export const merchantLogoutSchema = z.object({
  refreshToken: z.string().trim().min(32).optional(),
});

export const merchantForgotPasswordSchema = z.object({
  email: z.email().toLowerCase(),
});

export const merchantResetPasswordSchema = z.object({
  email: z.email().toLowerCase(),
  token: z.string().trim().min(16),
  password: z.string().min(8).max(128),
});

export const updateMerchantProfileSchema = z.object({
  name: z.string().trim().min(2).optional(),
});
