"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listApiKeysQuerySchema = exports.apiKeyIdParamsSchema = exports.createApiKeySchema = void 0;
const zod_1 = require("zod");
const pagination_1 = require("../../lib/pagination");
exports.createApiKeySchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2).max(120),
    mode: zod_1.z.enum(["TEST", "LIVE"]),
    expiresAt: zod_1.z.iso.datetime().optional(),
});
exports.apiKeyIdParamsSchema = zod_1.z.object({
    businessId: zod_1.z.uuid(),
    id: zod_1.z.uuid(),
});
exports.listApiKeysQuerySchema = pagination_1.paginationQuerySchema.extend({
    status: zod_1.z.enum(["ACTIVE", "REVOKED", "EXPIRED"]).optional(),
    mode: zod_1.z.enum(["TEST", "LIVE"]).optional(),
});
