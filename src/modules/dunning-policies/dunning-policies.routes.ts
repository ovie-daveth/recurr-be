import { Router } from "express";
import { Prisma } from "../../generated/prisma/client";
import { asyncHandler } from "../../lib/async-handler";
import { writeAuditLog } from "../../lib/audit";
import { ApiError, requireBusiness, requireBusinessMode } from "../../lib/errors";
import {
  dateRangeFilter,
  paginateResults,
  paginationArgs,
} from "../../lib/pagination";
import { prisma } from "../../lib/prisma";
import { sendSuccess } from "../../lib/responses";
import { businessResourceAuthMiddleware } from "../../middlewares/business-resource-auth.middleware";
import { idempotencyMiddleware } from "../../middlewares/idempotency.middleware";
import { validate } from "../../middlewares/validate.middleware";
import {
  createDunningPolicySchema,
  dunningPolicyIdParamsSchema,
  listDunningPoliciesQuerySchema,
  updateDunningPolicySchema,
} from "./dunning-policies.schema";

export const dunningPoliciesRouter = Router();

dunningPoliciesRouter.use(businessResourceAuthMiddleware);

function stepsCreateData(
  steps: Array<{
    delayMinutes: number;
    channel: string;
    metadata?: Record<string, unknown>;
  }>
) {
  return steps.map((step, index) => ({
    attemptNumber: index + 1,
    delayMinutes: step.delayMinutes,
    channel: step.channel,
    metadata: step.metadata as Prisma.InputJsonValue,
  }));
}

dunningPoliciesRouter.post(
  "/",
  validate({ body: createDunningPolicySchema }),
  idempotencyMiddleware,
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const mode = requireBusinessMode(req);

    const policy = await prisma.$transaction(async (tx) => {
      if (req.body.isDefault) {
        await tx.dunningPolicy.updateMany({
          where: {
            businessId: business.id,
            mode: mode,
            isDefault: true,
          },
          data: { isDefault: false },
        });
      }

      return tx.dunningPolicy.create({
        data: {
          businessId: business.id,
          mode: mode,
          name: req.body.name,
          status: req.body.status,
          isDefault: req.body.isDefault,
          finalAction: req.body.finalAction,
          metadata: req.body.metadata as Prisma.InputJsonValue,
          steps: {
            create: stepsCreateData(req.body.steps),
          },
        },
        include: { steps: { orderBy: { attemptNumber: "asc" } } },
      });
    });

    await writeAuditLog({
      businessId: business.id,
      action: "dunning_policy.created",
      entity: "dunning_policy",
      entityId: policy.id,
      metadata: {
        mode: mode,
        isDefault: policy.isDefault,
        finalAction: policy.finalAction,
      },
    });

    sendSuccess(res, 201, "Dunning policy created", { dunningPolicy: policy });
  })
);

dunningPoliciesRouter.get(
  "/",
  validate({ query: listDunningPoliciesQuerySchema }),
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const mode = requireBusinessMode(req);
    const query =
      req.validatedQuery as typeof listDunningPoliciesQuerySchema._output;

    const policies = await prisma.dunningPolicy.findMany({
      where: {
        businessId: business.id,
        mode: mode,
        ...(query.status ? { status: query.status } : {}),
        ...(typeof query.isDefault === "boolean"
          ? { isDefault: query.isDefault }
          : {}),
        ...(dateRangeFilter(query) ? { createdAt: dateRangeFilter(query) } : {}),
      },
      include: { steps: { orderBy: { attemptNumber: "asc" } } },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      ...paginationArgs(query),
    });
    const page = paginateResults(policies, query.limit);

    sendSuccess(res, 200, "Dunning policies returned", {
      dunningPolicies: page.data,
      pagination: page.pagination,
    });
  })
);

dunningPoliciesRouter.get(
  "/:id",
  validate({ params: dunningPolicyIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const mode = requireBusinessMode(req);

    const policy = await prisma.dunningPolicy.findFirst({
      where: {
        id: String(req.params.id),
        businessId: business.id,
        mode: mode,
      },
      include: { steps: { orderBy: { attemptNumber: "asc" } } },
    });

    if (!policy) {
      throw new ApiError(404, "Dunning policy not found");
    }

    sendSuccess(res, 200, "Dunning policy returned", {
      dunningPolicy: policy,
    });
  })
);

dunningPoliciesRouter.patch(
  "/:id",
  validate({
    params: dunningPolicyIdParamsSchema,
    body: updateDunningPolicySchema,
  }),
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const mode = requireBusinessMode(req);

    const existing = await prisma.dunningPolicy.findFirst({
      where: {
        id: String(req.params.id),
        businessId: business.id,
        mode: mode,
      },
    });

    if (!existing) {
      throw new ApiError(404, "Dunning policy not found");
    }

    if (req.body.status === "DISABLED" && (req.body.isDefault ?? existing.isDefault)) {
      throw new ApiError(
        409,
        "Default dunning policy cannot be disabled",
        [],
        "DEFAULT_DUNNING_POLICY_CANNOT_BE_DISABLED"
      );
    }

    const policy = await prisma.$transaction(async (tx) => {
      if (req.body.isDefault) {
        await tx.dunningPolicy.updateMany({
          where: {
            businessId: business.id,
            mode: mode,
            isDefault: true,
            id: { not: existing.id },
          },
          data: { isDefault: false },
        });
      }

      if (req.body.steps) {
        await tx.dunningPolicyStep.deleteMany({
          where: { policyId: existing.id },
        });
      }

      return tx.dunningPolicy.update({
        where: { id: existing.id },
        data: {
          ...(req.body.name ? { name: req.body.name } : {}),
          ...(req.body.status ? { status: req.body.status } : {}),
          ...(typeof req.body.isDefault === "boolean"
            ? { isDefault: req.body.isDefault }
            : {}),
          ...(req.body.finalAction
            ? { finalAction: req.body.finalAction }
            : {}),
          ...(req.body.metadata !== undefined
            ? { metadata: req.body.metadata as Prisma.InputJsonValue }
            : {}),
          ...(req.body.steps
            ? { steps: { create: stepsCreateData(req.body.steps) } }
            : {}),
        },
        include: { steps: { orderBy: { attemptNumber: "asc" } } },
      });
    });

    await writeAuditLog({
      businessId: business.id,
      action: "dunning_policy.updated",
      entity: "dunning_policy",
      entityId: policy.id,
      metadata: {
        mode: mode,
        isDefault: policy.isDefault,
        finalAction: policy.finalAction,
      },
    });

    sendSuccess(res, 200, "Dunning policy updated", {
      dunningPolicy: policy,
    });
  })
);

