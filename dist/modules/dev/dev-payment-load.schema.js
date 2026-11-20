"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mockLoadRunParamsSchema = exports.createMockLoadRunSchema = exports.simulateMockLoadSchema = void 0;
const zod_1 = require("zod");
exports.simulateMockLoadSchema = zod_1.z.object({
    businessId: zod_1.z.uuid(),
    paymentMethodId: zod_1.z.uuid(),
    amountMinor: zod_1.z.number().int().min(100).max(500_000_000).default(500_000),
    telemetryRunId: zod_1.z.uuid().optional(),
    timestamp: zod_1.z.iso.datetime().optional(),
    vu: zod_1.z.number().int().positive().optional(),
    iteration: zod_1.z.number().int().nonnegative().optional(),
});
exports.createMockLoadRunSchema = zod_1.z.object({
    businessId: zod_1.z.uuid(),
    profile: zod_1.z.enum(["low", "moderate", "high"]),
    targetRate: zod_1.z.number().int().positive(),
    durationSeconds: zod_1.z.number().int().positive(),
});
exports.mockLoadRunParamsSchema = zod_1.z.object({
    runId: zod_1.z.uuid(),
});
