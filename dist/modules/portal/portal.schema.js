"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listPortalSessionsQuerySchema = exports.portalSessionIdParamsSchema = exports.portalSessionTokenParamsSchema = exports.createPortalSessionSchema = void 0;
const zod_1 = require("zod");
const pagination_1 = require("../../lib/pagination");
const metadataSchema = zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional();
exports.createPortalSessionSchema = zod_1.z.object({
    customerId: zod_1.z.uuid(),
    returnUrl: zod_1.z.url().optional(),
    expiresInMinutes: zod_1.z.coerce.number().int().min(5).max(1440).default(60),
    metadata: metadataSchema,
});
exports.portalSessionTokenParamsSchema = zod_1.z.object({
    token: zod_1.z.string().trim().min(16),
});
exports.portalSessionIdParamsSchema = zod_1.z.object({
    id: zod_1.z.uuid(),
});
exports.listPortalSessionsQuerySchema = pagination_1.paginationQuerySchema.extend({
    status: zod_1.z.enum(["ACTIVE", "EXPIRED", "REVOKED"]).optional(),
    customerId: zod_1.z.uuid().optional(),
});
