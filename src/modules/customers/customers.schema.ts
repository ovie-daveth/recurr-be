import { z } from "zod";

const metadataSchema = z.record(z.string(), z.unknown()).optional();

export const customerIdParamsSchema = z.object({
  id: z.uuid(),
});

export const createCustomerSchema = z.object({
  email: z.email().toLowerCase(),
  name: z.string().trim().min(1).optional(),
  phone: z.string().trim().min(5).optional(),
  externalReference: z.string().trim().min(1).optional(),
  metadata: metadataSchema,
});

export const updateCustomerSchema = createCustomerSchema.partial();
