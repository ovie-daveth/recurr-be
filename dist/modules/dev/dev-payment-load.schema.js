"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.simulateMockLoadSchema = void 0;
const zod_1 = require("zod");
exports.simulateMockLoadSchema = zod_1.z.object({
    businessId: zod_1.z.uuid(),
    paymentMethodId: zod_1.z.uuid(),
    amountMinor: zod_1.z.number().int().min(100).max(500_000_000).default(500_000),
});
