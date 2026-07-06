import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { ApiError, requireMerchantUser } from "../../lib/errors";
import {
  dateRangeFilter,
  paginateResults,
  paginationArgs,
} from "../../lib/pagination";
import { prisma } from "../../lib/prisma";
import { sendSuccess } from "../../lib/responses";
import { validate } from "../../middlewares/validate.middleware";
import {
  listOperationalLogsQuerySchema,
  operationalLogIdParamsSchema,
  operationalLogsBusinessParamsSchema,
} from "./operational-logs.schema";

export const operationalLogsRouter = Router({ mergeParams: true });

async function requireBusinessLogAccess(input: {
  businessId: string;
  userId: string;
}) {
  const membership = await prisma.businessMember.findFirst({
    where: {
      businessId: input.businessId,
      userId: input.userId,
    },
  });

  if (!membership) {
    throw new ApiError(404, "Business not found", [], "BUSINESS_NOT_FOUND");
  }

  return membership;
}

operationalLogsRouter.get(
  "/",
  validate({
    params: operationalLogsBusinessParamsSchema,
    query: listOperationalLogsQuerySchema,
  }),
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);
    const businessId = String(req.params.businessId);
    const query =
      req.validatedQuery as typeof listOperationalLogsQuerySchema._output;

    await requireBusinessLogAccess({ businessId, userId: user.id });

    const logs = await prisma.operationalLog.findMany({
      where: {
        businessId,
        ...(query.severity ? { severity: query.severity } : {}),
        ...(query.event ? { event: query.event } : {}),
        ...(query.mode ? { mode: query.mode } : {}),
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
        ...(query.requestId ? { requestId: query.requestId } : {}),
        ...(dateRangeFilter(query) ? { createdAt: dateRangeFilter(query) } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...paginationArgs(query),
    });
    const page = paginateResults(logs, query.limit);

    sendSuccess(res, 200, "Operational logs returned", {
      logs: page.data,
      pagination: page.pagination,
    });
  })
);

operationalLogsRouter.get(
  "/summary",
  validate({
    params: operationalLogsBusinessParamsSchema,
    query: listOperationalLogsQuerySchema.omit({ cursor: true, limit: true }),
  }),
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);
    const businessId = String(req.params.businessId);
    const query = req.validatedQuery as Omit<
      typeof listOperationalLogsQuerySchema._output,
      "cursor" | "limit"
    >;

    await requireBusinessLogAccess({ businessId, userId: user.id });

    const where = {
      businessId,
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.event ? { event: query.event } : {}),
      ...(query.mode ? { mode: query.mode } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(query.requestId ? { requestId: query.requestId } : {}),
      ...(dateRangeFilter(query) ? { createdAt: dateRangeFilter(query) } : {}),
    };

    const [total, bySeverity, byEvent] = await Promise.all([
      prisma.operationalLog.count({ where }),
      prisma.operationalLog.groupBy({
        by: ["severity"],
        where,
        _count: { _all: true },
      }),
      prisma.operationalLog.groupBy({
        by: ["event"],
        where,
        _count: { _all: true },
        orderBy: { _count: { event: "desc" } },
        take: 20,
      }),
    ]);

    sendSuccess(res, 200, "Operational log summary returned", {
      total,
      bySeverity: Object.fromEntries(
        bySeverity.map((item) => [item.severity, item._count._all])
      ),
      topEvents: byEvent.map((item) => ({
        event: item.event,
        count: item._count._all,
      })),
    });
  })
);

operationalLogsRouter.get(
  "/:logId",
  validate({ params: operationalLogIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);
    const businessId = String(req.params.businessId);

    await requireBusinessLogAccess({ businessId, userId: user.id });

    const log = await prisma.operationalLog.findFirst({
      where: {
        id: String(req.params.logId),
        businessId,
      },
    });

    if (!log) {
      throw new ApiError(404, "Operational log not found");
    }

    sendSuccess(res, 200, "Operational log returned", { log });
  })
);
