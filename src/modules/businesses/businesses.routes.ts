import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { writeAuditLog } from "../../lib/audit";
import { ApiError, requireMerchantUser } from "../../lib/errors";
import { dateRangeFilter, paginateResults, paginationArgs } from "../../lib/pagination";
import { prisma } from "../../lib/prisma";
import { sendSuccess } from "../../lib/responses";
import { generateUniqueBusinessSlug } from "../../lib/slug";
import { merchantSessionMiddleware } from "../../middlewares/merchant-session.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { apiKeysRouter } from "../api-keys/api-keys.routes";
import { operationalLogsRouter } from "../operational-logs/operational-logs.routes";
import { webhookEndpointsRouter } from "../webhook-endpoints/webhook-endpoints.routes";
import {
  businessIdParamsSchema,
  createBusinessSchema,
  listBusinessesQuerySchema,
  updateBusinessSchema,
} from "./businesses.schema";

export const businessesRouter = Router();

businessesRouter.use(merchantSessionMiddleware);

businessesRouter.post(
  "/",
  validate({ body: createBusinessSchema }),
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);
    const name =
      req.body.type === "BUSINESS" ? req.body.businessName : req.body.legalName;
    const slug = await generateUniqueBusinessSlug(name);

    const business = await prisma.business.create({
      data: {
        ownerUserId: user.id,
        type: req.body.type,
        slug,
        name,
        status: "ACTIVE",
        businessName:
          req.body.type === "BUSINESS" ? req.body.businessName : undefined,
        businessRegistrationNumber:
          req.body.type === "BUSINESS"
            ? req.body.businessRegistrationNumber
            : undefined,
        taxId: req.body.type === "BUSINESS" ? req.body.taxId : undefined,
        website: req.body.type === "BUSINESS" ? req.body.website : undefined,
        legalName: req.body.type === "INDIVIDUAL" ? req.body.legalName : undefined,
        contactName: req.body.contactName,
        contactEmail: req.body.contactEmail,
        contactPhone: req.body.contactPhone,
        country: req.body.country,
        members: {
          create: {
            userId: user.id,
            role: "OWNER",
          },
        },
      },
    });

    await writeAuditLog({
      businessId: business.id,
      action: "business.created",
      entity: "business",
      entityId: business.id,
      metadata: { ownerUserId: user.id },
    });

    sendSuccess(res, 201, "Business created", { business });
  })
);

businessesRouter.get(
  "/",
  validate({ query: listBusinessesQuerySchema }),
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);
    const query = req.validatedQuery as typeof listBusinessesQuerySchema._output;
    const businesses = await prisma.business.findMany({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(dateRangeFilter(query) ? { createdAt: dateRangeFilter(query) } : {}),
        members: {
          some: { userId: user.id },
        },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...paginationArgs(query),
    });
    const page = paginateResults(businesses, query.limit);

    sendSuccess(res, 200, "Businesses returned", {
      businesses: page.data,
      pagination: page.pagination,
    });
  })
);

businessesRouter.get(
  "/:businessId",
  validate({ params: businessIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);
    const business = await prisma.business.findFirst({
      where: {
        id: String(req.params.businessId),
        members: {
          some: { userId: user.id },
        },
      },
    });

    if (!business) {
      throw new ApiError(404, "Business not found");
    }

    sendSuccess(res, 200, "Business returned", { business });
  })
);

businessesRouter.patch(
  "/:businessId",
  validate({ params: businessIdParamsSchema, body: updateBusinessSchema }),
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);
    const businessId = String(req.params.businessId);

    if (Object.keys(req.body).length === 0) {
      throw new ApiError(400, "At least one field is required", [], "EMPTY_UPDATE");
    }

    const membership = await prisma.businessMember.findFirst({
      where: {
        businessId,
        userId: user.id,
        role: { in: ["OWNER", "ADMIN"] },
      },
      include: { business: true },
    });

    if (!membership) {
      throw new ApiError(404, "Business not found", [], "BUSINESS_NOT_FOUND");
    }

    const nextType = req.body.type ?? membership.business.type;
    const name =
      nextType === "BUSINESS"
        ? req.body.businessName
        : nextType === "INDIVIDUAL"
          ? req.body.legalName
          : undefined;

    if (nextType === "BUSINESS" && !req.body.businessName && req.body.type) {
      throw new ApiError(
        400,
        "businessName is required when changing type to BUSINESS",
        [],
        "BUSINESS_NAME_REQUIRED"
      );
    }

    if (nextType === "INDIVIDUAL" && !req.body.legalName && req.body.type) {
      throw new ApiError(
        400,
        "legalName is required when changing type to INDIVIDUAL",
        [],
        "LEGAL_NAME_REQUIRED"
      );
    }

    const business = await prisma.business.update({
      where: { id: businessId },
      data: {
        ...req.body,
        name,
      },
    });

    await writeAuditLog({
      businessId,
      action: "business.updated",
      entity: "business",
      entityId: businessId,
      metadata: { userId: user.id },
    });

    sendSuccess(res, 200, "Business updated", { business });
  })
);

businessesRouter.use("/:businessId/api-keys", apiKeysRouter);
businessesRouter.use("/:businessId/webhook-endpoints", webhookEndpointsRouter);
businessesRouter.use("/:businessId/logs", operationalLogsRouter);
