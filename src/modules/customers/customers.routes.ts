import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { writeAuditLog } from "../../lib/audit";
import { ApiError, requireTenant } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { tenantMiddleware } from "../../middlewares/tenant.middleware";
import { validate } from "../../middlewares/validate.middleware";
import {
  createCustomerSchema,
  customerIdParamsSchema,
  updateCustomerSchema,
} from "./customers.schema";

export const customersRouter = Router();

customersRouter.use(tenantMiddleware);

customersRouter.post(
  "/",
  validate({ body: createCustomerSchema }),
  asyncHandler(async (req, res) => {
    const tenant = requireTenant(req);

    const customer = await prisma.customer.create({
      data: {
        tenantId: tenant.id,
        ...req.body,
      },
    });

    await writeAuditLog({
      tenantId: tenant.id,
      action: "customer.created",
      entity: "customer",
      entityId: customer.id,
      metadata: { email: customer.email },
    });

    res.status(201).json({ customer });
  })
);

customersRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const tenant = requireTenant(req);
    const customers = await prisma.customer.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({ customers });
  })
);

customersRouter.get(
  "/:id",
  validate({ params: customerIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const tenant = requireTenant(req);
    const id = String(req.params.id);
    const customer = await prisma.customer.findFirst({
      where: {
        id,
        tenantId: tenant.id,
      },
    });

    if (!customer) {
      throw new ApiError(404, "Customer not found");
    }

    res.status(200).json({ customer });
  })
);

customersRouter.patch(
  "/:id",
  validate({ params: customerIdParamsSchema, body: updateCustomerSchema }),
  asyncHandler(async (req, res) => {
    const tenant = requireTenant(req);
    const id = String(req.params.id);
    const existingCustomer = await prisma.customer.findFirst({
      where: {
        id,
        tenantId: tenant.id,
      },
    });

    if (!existingCustomer) {
      throw new ApiError(404, "Customer not found");
    }

    const customer = await prisma.customer.update({
      where: { id: existingCustomer.id },
      data: req.body,
    });

    await writeAuditLog({
      tenantId: tenant.id,
      action: "customer.updated",
      entity: "customer",
      entityId: customer.id,
    });

    res.status(200).json({ customer });
  })
);
