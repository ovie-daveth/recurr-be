"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listOperationalLogsQuerySchema = exports.operationalLogsBusinessParamsSchema = exports.operationalLogIdParamsSchema = void 0;
const zod_1 = require("zod");
const pagination_1 = require("../../lib/pagination");
exports.operationalLogIdParamsSchema = zod_1.z.object({
    businessId: zod_1.z.uuid(),
    logId: zod_1.z.uuid(),
});
exports.operationalLogsBusinessParamsSchema = zod_1.z.object({
    businessId: zod_1.z.uuid(),
});
exports.listOperationalLogsQuerySchema = pagination_1.paginationQuerySchema.extend({
    severity: zod_1.z.enum(["INFO", "WARN", "ERROR"]).optional(),
    event: zod_1.z.string().trim().min(1).max(120).optional(),
    mode: zod_1.z.enum(["TEST", "LIVE"]).optional(),
    entityType: zod_1.z.string().trim().min(1).max(80).optional(),
    entityId: zod_1.z.string().trim().min(1).max(120).optional(),
    requestId: zod_1.z.string().trim().min(1).max(120).optional(),
});
