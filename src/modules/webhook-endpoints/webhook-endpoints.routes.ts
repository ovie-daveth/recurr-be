import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { writeAuditLog } from "../../lib/audit";
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
  generateWebhookSigningSecret,
  sendWebhookEndpointTest,
} from "./merchant-webhooks.service";
import {
  createWebhookEndpointSchema,
  listWebhookDeliveriesQuerySchema,
  listWebhookEndpointsQuerySchema,
  webhookEndpointIdParamsSchema,
} from "./webhook-endpoints.schema";

export const webhookEndpointsRouter = Router({ mergeParams: true });

async function requireWebhookManagementAccess(businessId: string, userId: string) {
  const membership = await prisma.businessMember.findFirst({
    where: {
      businessId,
      userId,
      role: { in: ["OWNER", "ADMIN", "DEVELOPER"] },
    },
  });

  if (!membership) {
    throw new ApiError(404, "Business not found");
  }
}

const webhookEndpointSafeSelect = {
  id: true,
  businessId: true,
  url: true,
  description: true,
  events: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  disabledAt: true,
} as const;

webhookEndpointsRouter.post(
  "/",
  validate({ body: createWebhookEndpointSchema }),
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);
    const businessId = String(req.params.businessId);
    await requireWebhookManagementAccess(businessId, user.id);

    const signingSecret = generateWebhookSigningSecret();
    const endpoint = await prisma.webhookEndpoint.create({
      data: {
        businessId,
        url: req.body.url,
        description: req.body.description,
        events: req.body.events,
        secret: signingSecret,
      },
      select: webhookEndpointSafeSelect,
    });

    await writeAuditLog({
      businessId,
      action: "webhook_endpoint.created",
      entity: "webhook_endpoint",
      entityId: endpoint.id,
      metadata: {
        userId: user.id,
        events: endpoint.events,
      },
    });

    sendSuccess(res, 201, "Webhook endpoint created", {
      webhookEndpoint: endpoint,
      signingSecret,
      warning:
        "Store this signing secret now. Recurr uses it to sign webhook deliveries.",
    });
  })
);

webhookEndpointsRouter.get(
  "/",
  validate({ query: listWebhookEndpointsQuerySchema }),
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);
    const businessId = String(req.params.businessId);
    const query =
      req.validatedQuery as typeof listWebhookEndpointsQuerySchema._output;
    await requireWebhookManagementAccess(businessId, user.id);

    const endpoints = await prisma.webhookEndpoint.findMany({
      where: {
        businessId,
        ...(query.status ? { status: query.status } : {}),
        ...(dateRangeFilter(query) ? { createdAt: dateRangeFilter(query) } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...paginationArgs(query),
      select: webhookEndpointSafeSelect,
    });
    const page = paginateResults(endpoints, query.limit);

    sendSuccess(res, 200, "Webhook endpoints returned", {
      webhookEndpoints: page.data,
      pagination: page.pagination,
    });
  })
);

webhookEndpointsRouter.get(
  "/:id",
  validate({ params: webhookEndpointIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);
    const businessId = String(req.params.businessId);
    const id = String(req.params.id);
    await requireWebhookManagementAccess(businessId, user.id);

    const endpoint = await prisma.webhookEndpoint.findFirst({
      where: { id, businessId },
      select: webhookEndpointSafeSelect,
    });

    if (!endpoint) {
      throw new ApiError(404, "Webhook endpoint not found");
    }

    sendSuccess(res, 200, "Webhook endpoint returned", {
      webhookEndpoint: endpoint,
    });
  })
);

webhookEndpointsRouter.delete(
  "/:id",
  validate({ params: webhookEndpointIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);
    const businessId = String(req.params.businessId);
    const id = String(req.params.id);
    await requireWebhookManagementAccess(businessId, user.id);

    const existing = await prisma.webhookEndpoint.findFirst({
      where: { id, businessId },
    });

    if (!existing) {
      throw new ApiError(404, "Webhook endpoint not found");
    }

    const endpoint = await prisma.webhookEndpoint.update({
      where: { id },
      data: {
        status: "DISABLED",
        disabledAt: existing.disabledAt ?? new Date(),
      },
      select: webhookEndpointSafeSelect,
    });

    await writeAuditLog({
      businessId,
      action: "webhook_endpoint.disabled",
      entity: "webhook_endpoint",
      entityId: endpoint.id,
      metadata: { userId: user.id },
    });

    sendSuccess(res, 200, "Webhook endpoint disabled", {
      webhookEndpoint: endpoint,
    });
  })
);

webhookEndpointsRouter.get(
  "/:id/deliveries",
  validate({
    params: webhookEndpointIdParamsSchema,
    query: listWebhookDeliveriesQuerySchema,
  }),
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);
    const businessId = String(req.params.businessId);
    const id = String(req.params.id);
    const query =
      req.validatedQuery as typeof listWebhookDeliveriesQuerySchema._output;
    await requireWebhookManagementAccess(businessId, user.id);

    const endpoint = await prisma.webhookEndpoint.findFirst({
      where: { id, businessId },
      select: { id: true },
    });

    if (!endpoint) {
      throw new ApiError(404, "Webhook endpoint not found");
    }

    const deliveries = await prisma.webhookDelivery.findMany({
      where: {
        businessId,
        endpointId: id,
        ...(query.status ? { status: query.status } : {}),
        ...(query.eventType ? { eventType: query.eventType } : {}),
        ...(dateRangeFilter(query) ? { createdAt: dateRangeFilter(query) } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...paginationArgs(query),
    });
    const page = paginateResults(deliveries, query.limit);

    sendSuccess(res, 200, "Webhook deliveries returned", {
      webhookDeliveries: page.data,
      pagination: page.pagination,
    });
  })
);

webhookEndpointsRouter.post(
  "/:id/test",
  validate({ params: webhookEndpointIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);
    const businessId = String(req.params.businessId);
    const id = String(req.params.id);
    await requireWebhookManagementAccess(businessId, user.id);

    const delivery = await sendWebhookEndpointTest({
      businessId,
      endpointId: id,
    });

    if (!delivery) {
      throw new ApiError(404, "Active webhook endpoint not found");
    }

    sendSuccess(res, 200, "Webhook test delivered", {
      webhookDelivery: delivery,
    });
  })
);
