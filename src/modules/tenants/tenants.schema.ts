import { z } from "zod";

export const createTenantSchema = z.object({
  name: z.string().trim().min(2),
  email: z.email().toLowerCase(),
  apiKeyName: z.string().trim().min(2).default("Default API key"),
});
