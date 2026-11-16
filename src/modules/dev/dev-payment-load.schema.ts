import { z } from "zod";

export const simulateMockLoadSchema = z.object({
  businessId: z.uuid(),
  paymentMethodId: z.uuid(),
  amountMinor: z.number().int().min(100).max(500_000_000).default(500_000),
  telemetryRunId: z.uuid().optional(),
  timestamp: z.iso.datetime().optional(),
  vu: z.number().int().positive().optional(),
  iteration: z.number().int().nonnegative().optional(),
});

export const createMockLoadRunSchema = z.object({
  businessId: z.uuid(),
  profile: z.enum(["low", "moderate", "high"]),
  targetRate: z.number().int().positive(),
  durationSeconds: z.number().int().positive(),
});

export const mockLoadRunParamsSchema = z.object({
  runId: z.uuid(),
});
