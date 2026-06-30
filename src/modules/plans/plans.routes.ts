import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { writeAuditLog } from "../../lib/audit";
import { ApiError, requireApiKey, requireBusiness } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { sendSuccess } from "../../lib/responses";
import { businessApiKeyMiddleware } from "../../middlewares/business-api-key.middleware";
import { idempotencyMiddleware } from "../../middlewares/idempotency.middleware";
import { validate } from "../../middlewares/validate.middleware";
import {
  createPlanSchema,
  planIdParamsSchema,
  updatePlanSchema,
} from "./plans.schema";

export const plansRouter = Router();

plansRouter.use(businessApiKeyMiddleware);

plansRouter.post(
  "/",
  validate({ body: createPlanSchema }),
  idempotencyMiddleware,
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const apiKey = requireApiKey(req);

    const plan = await prisma.plan.create({
      data: {
        businessId: business.id,
        mode: apiKey.mode,
        ...req.body,
      },
    });

    await writeAuditLog({
      businessId: business.id,
      action: "plan.created",
      entity: "plan",
      entityId: plan.id,
      metadata: { code: plan.code },
    });

    sendSuccess(res, 201, "Plan created", { plan });
  })
);

plansRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const apiKey = requireApiKey(req);
    const plans = await prisma.plan.findMany({
      where: { businessId: business.id, mode: apiKey.mode },
      orderBy: { createdAt: "desc" },
    });

    sendSuccess(res, 200, "Plans returned", { plans });
  })
);

plansRouter.get(
  "/:id",
  validate({ params: planIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const apiKey = requireApiKey(req);
    const id = String(req.params.id);
    const plan = await prisma.plan.findFirst({
      where: {
        id,
        businessId: business.id,
        mode: apiKey.mode,
      },
    });

    if (!plan) {
      throw new ApiError(404, "Plan not found");
    }

    sendSuccess(res, 200, "Plan returned", { plan });
  })
);

plansRouter.patch(
  "/:id",
  validate({ params: planIdParamsSchema, body: updatePlanSchema }),
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const apiKey = requireApiKey(req);
    const id = String(req.params.id);
    const existingPlan = await prisma.plan.findFirst({
      where: {
        id,
        businessId: business.id,
        mode: apiKey.mode,
      },
    });

    if (!existingPlan) {
      throw new ApiError(404, "Plan not found");
    }

    const plan = await prisma.plan.update({
      where: { id: existingPlan.id },
      data: req.body,
    });

    await writeAuditLog({
      businessId: business.id,
      action: "plan.updated",
      entity: "plan",
      entityId: plan.id,
    });

    sendSuccess(res, 200, "Plan updated", { plan });
  })
);

plansRouter.delete(
  "/:id",
  validate({ params: planIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const apiKey = requireApiKey(req);
    const id = String(req.params.id);
    const existingPlan = await prisma.plan.findFirst({
      where: {
        id,
        businessId: business.id,
        mode: apiKey.mode,
      },
    });

    if (!existingPlan) {
      throw new ApiError(404, "Plan not found");
    }

    const plan = await prisma.plan.update({
      where: { id: existingPlan.id },
      data: { status: "ARCHIVED" },
    });

    await writeAuditLog({
      businessId: business.id,
      action: "plan.archived",
      entity: "plan",
      entityId: plan.id,
    });

    sendSuccess(res, 200, "Plan archived", { plan });
  })
);
