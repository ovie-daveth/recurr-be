import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler.js";
import { writeAuditLog } from "../../lib/audit.js";
import { ApiError, requireTenant } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { tenantMiddleware } from "../../middlewares/tenant.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import {
  createPlanSchema,
  planIdParamsSchema,
  updatePlanSchema,
} from "./plans.schema.js";

export const plansRouter = Router();

plansRouter.use(tenantMiddleware);

plansRouter.post(
  "/",
  validate({ body: createPlanSchema }),
  asyncHandler(async (req, res) => {
    const tenant = requireTenant(req);

    const plan = await prisma.plan.create({
      data: {
        tenantId: tenant.id,
        ...req.body,
      },
    });

    await writeAuditLog({
      tenantId: tenant.id,
      action: "plan.created",
      entity: "plan",
      entityId: plan.id,
      metadata: { code: plan.code },
    });

    res.status(201).json({ plan });
  })
);

plansRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const tenant = requireTenant(req);
    const plans = await prisma.plan.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({ plans });
  })
);

plansRouter.get(
  "/:id",
  validate({ params: planIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const tenant = requireTenant(req);
    const id = String(req.params.id);
    const plan = await prisma.plan.findFirst({
      where: {
        id,
        tenantId: tenant.id,
      },
    });

    if (!plan) {
      throw new ApiError(404, "Plan not found");
    }

    res.status(200).json({ plan });
  })
);

plansRouter.patch(
  "/:id",
  validate({ params: planIdParamsSchema, body: updatePlanSchema }),
  asyncHandler(async (req, res) => {
    const tenant = requireTenant(req);
    const id = String(req.params.id);
    const existingPlan = await prisma.plan.findFirst({
      where: {
        id,
        tenantId: tenant.id,
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
      tenantId: tenant.id,
      action: "plan.updated",
      entity: "plan",
      entityId: plan.id,
    });

    res.status(200).json({ plan });
  })
);

plansRouter.delete(
  "/:id",
  validate({ params: planIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const tenant = requireTenant(req);
    const id = String(req.params.id);
    const existingPlan = await prisma.plan.findFirst({
      where: {
        id,
        tenantId: tenant.id,
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
      tenantId: tenant.id,
      action: "plan.archived",
      entity: "plan",
      entityId: plan.id,
    });

    res.status(200).json({ plan });
  })
);
