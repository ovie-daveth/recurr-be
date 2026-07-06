"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.operationalLogsRouter = void 0;
const express_1 = require("express");
const async_handler_1 = require("../../lib/async-handler");
const errors_1 = require("../../lib/errors");
const pagination_1 = require("../../lib/pagination");
const prisma_1 = require("../../lib/prisma");
const responses_1 = require("../../lib/responses");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const operational_logs_schema_1 = require("./operational-logs.schema");
exports.operationalLogsRouter = (0, express_1.Router)({ mergeParams: true });
async function requireBusinessLogAccess(input) {
    const membership = await prisma_1.prisma.businessMember.findFirst({
        where: {
            businessId: input.businessId,
            userId: input.userId,
        },
    });
    if (!membership) {
        throw new errors_1.ApiError(404, "Business not found", [], "BUSINESS_NOT_FOUND");
    }
    return membership;
}
exports.operationalLogsRouter.get("/", (0, validate_middleware_1.validate)({
    params: operational_logs_schema_1.operationalLogsBusinessParamsSchema,
    query: operational_logs_schema_1.listOperationalLogsQuerySchema,
}), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const businessId = String(req.params.businessId);
    const query = req.validatedQuery;
    await requireBusinessLogAccess({ businessId, userId: user.id });
    const logs = await prisma_1.prisma.operationalLog.findMany({
        where: {
            businessId,
            ...(query.severity ? { severity: query.severity } : {}),
            ...(query.event ? { event: query.event } : {}),
            ...(query.mode ? { mode: query.mode } : {}),
            ...(query.entityType ? { entityType: query.entityType } : {}),
            ...(query.entityId ? { entityId: query.entityId } : {}),
            ...(query.requestId ? { requestId: query.requestId } : {}),
            ...((0, pagination_1.dateRangeFilter)(query) ? { createdAt: (0, pagination_1.dateRangeFilter)(query) } : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...(0, pagination_1.paginationArgs)(query),
    });
    const page = (0, pagination_1.paginateResults)(logs, query.limit);
    (0, responses_1.sendSuccess)(res, 200, "Operational logs returned", {
        logs: page.data,
        pagination: page.pagination,
    });
}));
exports.operationalLogsRouter.get("/summary", (0, validate_middleware_1.validate)({
    params: operational_logs_schema_1.operationalLogsBusinessParamsSchema,
    query: operational_logs_schema_1.listOperationalLogsQuerySchema.omit({ cursor: true, limit: true }),
}), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const businessId = String(req.params.businessId);
    const query = req.validatedQuery;
    await requireBusinessLogAccess({ businessId, userId: user.id });
    const where = {
        businessId,
        ...(query.severity ? { severity: query.severity } : {}),
        ...(query.event ? { event: query.event } : {}),
        ...(query.mode ? { mode: query.mode } : {}),
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
        ...(query.requestId ? { requestId: query.requestId } : {}),
        ...((0, pagination_1.dateRangeFilter)(query) ? { createdAt: (0, pagination_1.dateRangeFilter)(query) } : {}),
    };
    const [total, bySeverity, byEvent] = await Promise.all([
        prisma_1.prisma.operationalLog.count({ where }),
        prisma_1.prisma.operationalLog.groupBy({
            by: ["severity"],
            where,
            _count: { _all: true },
        }),
        prisma_1.prisma.operationalLog.groupBy({
            by: ["event"],
            where,
            _count: { _all: true },
            orderBy: { _count: { event: "desc" } },
            take: 20,
        }),
    ]);
    (0, responses_1.sendSuccess)(res, 200, "Operational log summary returned", {
        total,
        bySeverity: Object.fromEntries(bySeverity.map((item) => [item.severity, item._count._all])),
        topEvents: byEvent.map((item) => ({
            event: item.event,
            count: item._count._all,
        })),
    });
}));
exports.operationalLogsRouter.get("/:logId", (0, validate_middleware_1.validate)({ params: operational_logs_schema_1.operationalLogIdParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const businessId = String(req.params.businessId);
    await requireBusinessLogAccess({ businessId, userId: user.id });
    const log = await prisma_1.prisma.operationalLog.findFirst({
        where: {
            id: String(req.params.logId),
            businessId,
        },
    });
    if (!log) {
        throw new errors_1.ApiError(404, "Operational log not found");
    }
    (0, responses_1.sendSuccess)(res, 200, "Operational log returned", { log });
}));
