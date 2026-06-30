import { z } from "zod";

export const createApiKeySchema = z.object({
  name: z.string().trim().min(2).max(120),
});

export const apiKeyIdParamsSchema = z.object({
  id: z.uuid(),
});
