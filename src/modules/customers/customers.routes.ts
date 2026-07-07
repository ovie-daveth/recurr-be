import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { writeAuditLog } from "../../lib/audit";
import { ApiError, requireBusiness, requireBusinessMode } from "../../lib/errors";
import { dateRangeFilter, paginateResults, paginationArgs } from "../../lib/pagination";
import { prisma } from "../../lib/prisma";
import { sendSuccess } from "../../lib/responses";
import { businessResourceAuthMiddleware } from "../../middlewares/business-resource-auth.middleware";
import { idempotencyMiddleware } from "../../middlewares/idempotency.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { emitMerchantWebhook } from "../webhook-endpoints/merchant-webhooks.service";
import {
  createCustomerSchema,
  customerIdParamsSchema,
  listCustomersQuerySchema,
  updateCustomerSchema,
  updateCustomerStatusSchema,
} from "./customers.schema";

export const customersRouter = Router();

customersRouter.use(businessResourceAuthMiddleware);

customersRouter.post(
  "/",
  validate({ body: createCustomerSchema }),
  idempotencyMiddleware,
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const mode = requireBusinessMode(req);

    const customer = await prisma.customer.create({
      data: {
        businessId: business.id,
        mode,
        ...req.body,
      },
    });

    await writeAuditLog({
      businessId: business.id,
      action: "customer.created",
      entity: "customer",
      entityId: customer.id,
      metadata: { email: customer.email },
    });

    void emitMerchantWebhook({
      businessId: business.id,
      type: "customer.created",
      data: { customer },
    }).catch((error) => {
      console.error("Failed to emit customer.created webhook", error);
    });

    sendSuccess(res, 201, "Customer created", { customer });
  })
);

customersRouter.get(
  "/",
  validate({ query: listCustomersQuerySchema }),
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const mode = requireBusinessMode(req);
    const query = req.validatedQuery as typeof listCustomersQuerySchema._output;
    const customers = await prisma.customer.findMany({
      where: {
        businessId: business.id,
        mode,
        ...(query.status ? { status: query.status } : {}),
        ...(dateRangeFilter(query) ? { createdAt: dateRangeFilter(query) } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...paginationArgs(query),
    });
    const page = paginateResults(customers, query.limit);

    sendSuccess(res, 200, "Customers returned", {
      customers: page.data,
      pagination: page.pagination,
    });
  })
);

customersRouter.get(
  "/:id",
  validate({ params: customerIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const mode = requireBusinessMode(req);
    const id = String(req.params.id);
    const customer = await prisma.customer.findFirst({
      where: {
        id,
        businessId: business.id,
        mode,
      },
    });

    if (!customer) {
      throw new ApiError(404, "Customer not found");
    }

    sendSuccess(res, 200, "Customer returned", { customer });
  })
);

customersRouter.patch(
  "/:id",
  validate({ params: customerIdParamsSchema, body: updateCustomerSchema }),
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const mode = requireBusinessMode(req);
    const id = String(req.params.id);
    const existingCustomer = await prisma.customer.findFirst({
      where: {
        id,
        businessId: business.id,
        mode,
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
      businessId: business.id,
      action: "customer.updated",
      entity: "customer",
      entityId: customer.id,
    });

    sendSuccess(res, 200, "Customer updated", { customer });
  })
);

customersRouter.post(
  "/:id/status",
  validate({ params: customerIdParamsSchema, body: updateCustomerStatusSchema }),
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const mode = requireBusinessMode(req);
    const id = String(req.params.id);
    const existingCustomer = await prisma.customer.findFirst({
      where: {
        id,
        businessId: business.id,
        mode,
      },
    });

    if (!existingCustomer) {
      throw new ApiError(404, "Customer not found");
    }

    const customer = await prisma.customer.update({
      where: { id: existingCustomer.id },
      data: { status: req.body.status },
    });

    await writeAuditLog({
      businessId: business.id,
      action: "customer.status_updated",
      entity: "customer",
      entityId: customer.id,
      metadata: { status: customer.status, mode },
    });

    sendSuccess(res, 200, "Customer status updated", { customer });
  })
);

customersRouter.delete(
  "/:id",
  validate({ params: customerIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const mode = requireBusinessMode(req);
    const id = String(req.params.id);
    const existingCustomer = await prisma.customer.findFirst({
      where: {
        id,
        businessId: business.id,
        mode,
      },
    });

    if (!existingCustomer) {
      throw new ApiError(404, "Customer not found");
    }

    const customer = await prisma.customer.update({
      where: { id: existingCustomer.id },
      data: { status: "DISABLED" },
    });

    await writeAuditLog({
      businessId: business.id,
      action: "customer.disabled",
      entity: "customer",
      entityId: customer.id,
      metadata: { mode },
    });

    sendSuccess(res, 200, "Customer disabled", { customer });
  })
);
