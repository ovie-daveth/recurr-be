import { Router } from "express";
import { Prisma } from "../../generated/prisma/client";
import { generateVerificationToken, hashApiKey } from "../../lib/api-keys";
import { asyncHandler } from "../../lib/async-handler";
import { writeAuditLog } from "../../lib/audit";
import { ApiError, requireApiKey, requireBusiness } from "../../lib/errors";
import {
  dateRangeFilter,
  paginateResults,
  paginationArgs,
} from "../../lib/pagination";
import { prisma } from "../../lib/prisma";
import { sendSuccess } from "../../lib/responses";
import { businessApiKeyMiddleware } from "../../middlewares/business-api-key.middleware";
import { validate } from "../../middlewares/validate.middleware";
import {
  createPortalSessionSchema,
  listPortalSessionsQuerySchema,
  portalSessionIdParamsSchema,
  portalSessionTokenParamsSchema,
} from "./portal.schema";

export const portalRouter = Router();

function buildPortalUrl(token: string) {
  const baseUrl =
    process.env.PORTAL_BASE_URL ||
    process.env.FRONTEND_BASE_URL ||
    process.env.APP_BASE_URL ||
    "http://localhost:5173";
  const url = new URL(`/portal/session/${token}`, baseUrl);
  return url.toString();
}

function addMinutes(date: Date, minutes: number) {
  const next = new Date(date);
  next.setMinutes(next.getMinutes() + minutes);
  return next;
}

function publicPaymentMethod(paymentMethod: {
  id: string;
  type: string;
  status: string;
  provider: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  reusable: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: paymentMethod.id,
    type: paymentMethod.type,
    status: paymentMethod.status,
    provider: paymentMethod.provider,
    brand: paymentMethod.brand,
    last4: paymentMethod.last4,
    expMonth: paymentMethod.expMonth,
    expYear: paymentMethod.expYear,
    reusable: paymentMethod.reusable,
    createdAt: paymentMethod.createdAt,
    updatedAt: paymentMethod.updatedAt,
  };
}

portalRouter.post(
  "/sessions",
  businessApiKeyMiddleware,
  validate({ body: createPortalSessionSchema }),
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const apiKey = requireApiKey(req);

    const customer = await prisma.customer.findFirst({
      where: {
        id: req.body.customerId,
        businessId: business.id,
        mode: apiKey.mode,
      },
    });

    if (!customer) {
      throw new ApiError(404, "Customer not found");
    }

    if (customer.status !== "ACTIVE") {
      throw new ApiError(409, "Customer is not active", [], "CUSTOMER_NOT_ACTIVE");
    }

    const generated = generateVerificationToken();
    const expiresAt = addMinutes(new Date(), req.body.expiresInMinutes);

    const portalSession = await prisma.portalSession.create({
      data: {
        businessId: business.id,
        customerId: customer.id,
        mode: apiKey.mode,
        tokenHash: generated.hash,
        returnUrl: req.body.returnUrl,
        expiresAt,
        metadata: req.body.metadata as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        businessId: true,
        customerId: true,
        mode: true,
        status: true,
        returnUrl: true,
        expiresAt: true,
        usedAt: true,
        revokedAt: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await writeAuditLog({
      businessId: business.id,
      action: "portal_session.created",
      entity: "portal_session",
      entityId: portalSession.id,
      metadata: {
        customerId: customer.id,
        mode: apiKey.mode,
      },
    });

    sendSuccess(res, 201, "Portal session created", {
      portalSession,
      url: buildPortalUrl(generated.token),
      token: generated.token,
      warning:
        "Return the URL to the subscriber. The raw token is only returned once.",
    });
  })
);

portalRouter.get(
  "/sessions",
  businessApiKeyMiddleware,
  validate({ query: listPortalSessionsQuerySchema }),
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const apiKey = requireApiKey(req);
    const query = req.validatedQuery as typeof listPortalSessionsQuerySchema._output;

    const sessions = await prisma.portalSession.findMany({
      where: {
        businessId: business.id,
        mode: apiKey.mode,
        ...(query.status ? { status: query.status } : {}),
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(dateRangeFilter(query) ? { createdAt: dateRangeFilter(query) } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...paginationArgs(query),
      select: {
        id: true,
        businessId: true,
        customerId: true,
        mode: true,
        status: true,
        returnUrl: true,
        expiresAt: true,
        usedAt: true,
        revokedAt: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const page = paginateResults(sessions, query.limit);

    sendSuccess(res, 200, "Portal sessions returned", {
      portalSessions: page.data,
      pagination: page.pagination,
    });
  })
);

portalRouter.post(
  "/sessions/:id/revoke",
  businessApiKeyMiddleware,
  validate({ params: portalSessionIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const apiKey = requireApiKey(req);

    const existing = await prisma.portalSession.findFirst({
      where: {
        id: String(req.params.id),
        businessId: business.id,
        mode: apiKey.mode,
      },
    });

    if (!existing) {
      throw new ApiError(404, "Portal session not found");
    }

    const portalSession = await prisma.portalSession.update({
      where: { id: existing.id },
      data: {
        status: "REVOKED",
        revokedAt: existing.revokedAt ?? new Date(),
      },
    });

    await writeAuditLog({
      businessId: business.id,
      action: "portal_session.revoked",
      entity: "portal_session",
      entityId: portalSession.id,
      metadata: { mode: apiKey.mode },
    });

    sendSuccess(res, 200, "Portal session revoked", { portalSession });
  })
);

portalRouter.get(
  "/sessions/:token",
  validate({ params: portalSessionTokenParamsSchema }),
  asyncHandler(async (req, res) => {
    const tokenHash = hashApiKey(String(req.params.token));
    const portalSession = await prisma.portalSession.findUnique({
      where: { tokenHash },
    });

    if (!portalSession) {
      throw new ApiError(404, "Portal session not found");
    }

    if (portalSession.revokedAt || portalSession.status === "REVOKED") {
      throw new ApiError(410, "Portal session has been revoked", [], "PORTAL_SESSION_REVOKED");
    }

    if (portalSession.expiresAt <= new Date()) {
      await prisma.portalSession.update({
        where: { id: portalSession.id },
        data: { status: "EXPIRED" },
      });
      throw new ApiError(410, "Portal session has expired", [], "PORTAL_SESSION_EXPIRED");
    }

    if (!portalSession.usedAt) {
      await prisma.portalSession.update({
        where: { id: portalSession.id },
        data: { usedAt: new Date() },
      });
    }

    const [business, customer, subscriptions, invoices, paymentMethods] =
      await Promise.all([
        prisma.business.findUnique({
          where: { id: portalSession.businessId },
          select: {
            id: true,
            name: true,
            type: true,
            contactEmail: true,
            contactPhone: true,
            country: true,
          },
        }),
        prisma.customer.findFirst({
          where: {
            id: portalSession.customerId,
            businessId: portalSession.businessId,
            mode: portalSession.mode,
          },
          select: {
            id: true,
            email: true,
            name: true,
            phone: true,
            externalReference: true,
            status: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        prisma.subscription.findMany({
          where: {
            customerId: portalSession.customerId,
            businessId: portalSession.businessId,
            mode: portalSession.mode,
          },
          include: {
            plan: true,
            paymentMethod: true,
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }),
        prisma.invoice.findMany({
          where: {
            customerId: portalSession.customerId,
            businessId: portalSession.businessId,
            mode: portalSession.mode,
          },
          include: {
            items: true,
            attempts: true,
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 20,
        }),
        prisma.paymentMethod.findMany({
          where: {
            customerId: portalSession.customerId,
            businessId: portalSession.businessId,
            mode: portalSession.mode,
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        }),
      ]);

    sendSuccess(res, 200, "Portal session returned", {
      portalSession: {
        id: portalSession.id,
        mode: portalSession.mode,
        status: portalSession.status,
        returnUrl: portalSession.returnUrl,
        expiresAt: portalSession.expiresAt,
      },
      business,
      customer,
      subscriptions: subscriptions.map((subscription) => ({
        ...subscription,
        paymentMethod: publicPaymentMethod(subscription.paymentMethod),
      })),
      invoices,
      paymentMethods: paymentMethods.map(publicPaymentMethod),
    });
  })
);
