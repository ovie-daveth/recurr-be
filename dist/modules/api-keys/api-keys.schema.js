"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiKeyIdParamsSchema = exports.createApiKeySchema = void 0;
const zod_1 = require("zod");
exports.createApiKeySchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2).max(120),
    mode: zod_1.z.enum(["TEST", "LIVE"]),
    expiresAt: zod_1.z.iso.datetime().optional(),
});
exports.apiKeyIdParamsSchema = zod_1.z.object({
    businessId: zod_1.z.uuid(),
    id: zod_1.z.uuid(),
});
