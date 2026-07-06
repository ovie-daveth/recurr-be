import { z } from "zod";
import { paginationQuerySchema } from "../../lib/pagination";

const metadataSchema = z.record(z.string(), z.unknown()).optional();

const dunningPolicyStepSchema = z.object({
  delayMinutes: z.number().int().positive().max(43200),
  channel: z.string().trim().min(2).max(40).default("email"),
  metadata: metadataSchema,
});

const dunningPolicyBaseSchema = z.object({
  name: z.string().trim().min(2).max(120),
  status: z.enum(["ACTIVE", "DISABLED"]).default("ACTIVE"),
  isDefault: z.boolean().default(true),
  finalAction: z.enum([
    "CANCEL_SUBSCRIPTION",
    "PAUSE_SUBSCRIPTION",
    "MARK_INVOICE_UNCOLLECTIBLE",
  ]),
  steps: z.array(dunningPolicyStepSchema).min(1).max(10),
  metadata: metadataSchema,
});

export const createDunningPolicySchema = dunningPolicyBaseSchema.refine(
  (value) => !(value.status === "DISABLED" && value.isDefault),
  {
    path: ["isDefault"],
    message: "Disabled policy cannot be the default policy",
  }
);

export const updateDunningPolicySchema = dunningPolicyBaseSchema
  .partial()
  .refine((value) => !(value.status === "DISABLED" && value.isDefault), {
    path: ["isDefault"],
    message: "Disabled policy cannot be the default policy",
  });

export const dunningPolicyIdParamsSchema = z.object({
  id: z.uuid(),
});

export const listDunningPoliciesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  isDefault: z.coerce.boolean().optional(),
});
