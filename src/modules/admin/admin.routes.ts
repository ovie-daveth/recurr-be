import { Prisma } from "../../generated/prisma/client";
import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { ApiError, requireMerchantUser } from "../../lib/errors";
import { paginateResults, paginationArgs } from "../../lib/pagination";
import { prisma } from "../../lib/prisma";
import { sendSuccess } from "../../lib/responses";
import { merchantSessionMiddleware } from "../../middlewares/merchant-session.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { sendAdminMessage } from "../../lib/mailer";
import {
  adminEmailSchema,
  listMerchantsQuerySchema,
  merchantApiKeyParamsSchema,
  merchantIdParamsSchema,
} from "./admin.schema";

export const adminRouter = Router();

adminRouter.use(merchantSessionMiddleware);
adminRouter.use(
  asyncHandler(async (req, _res, next) => {
    const user = requireMerchantUser(req);
    const admin = await prisma.merchantUser.findUnique({
      where: { id: user.id },
      select: { isPlatformAdmin: true },
    });

    if (!admin?.isPlatformAdmin) {
      throw new ApiError(403, "Platform administrator access is required");
    }

    next();
  })
);

const merchantSummarySelect = {
  id: true,
  email: true,
  name: true,
  status: true,
  isPlatformAdmin: true,
  deletedAt: true,
  emailVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
  ownedBusinesses: {
    select: {
      id: true,
      name: true,
      status: true,
      type: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" as const },
  },
} satisfies Prisma.MerchantUserSelect;

async function findTargetMerchant(merchantId: string) {
  const merchant = await prisma.merchantUser.findUnique({
    where: { id: merchantId },
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      isPlatformAdmin: true,
      deletedAt: true,
      ownedBusinesses: {
        select: { id: true },
      },
    },
  });

  if (!merchant) {
    throw new ApiError(404, "Merchant not found");
  }
  if (merchant.isPlatformAdmin) {
    throw new ApiError(409, "Platform administrator accounts cannot be changed here");
  }
  if (merchant.deletedAt) {
    throw new ApiError(409, "Deleted merchants cannot be changed");
  }

  return merchant;
}

async function recordAdminAction(input: {
  actorUserId: string;
  targetUserId: string;
  action: string;
  entityId?: string;
  details?: Record<string, unknown>;
}) {
  await prisma.adminActionLog.create({
    data: {
      actorUserId: input.actorUserId,
      targetUserId: input.targetUserId,
      action: input.action,
      entityId: input.entityId,
      details: input.details as Prisma.InputJsonValue | undefined,
    },
  });
}

adminRouter.get(
  "/merchants",
  validate({ query: listMerchantsQuerySchema }),
  asyncHandler(async (req, res) => {
    const query = req.validatedQuery as typeof listMerchantsQuerySchema._output;
    const search = query.search;
    const merchants = await prisma.merchantUser.findMany({
      where: {
        ...(query.status === "DELETED"
          ? { deletedAt: { not: null } }
          : {
              deletedAt: null,
              ...(query.status ? { status: query.status } : {}),
            }),
        ...(search
          ? {
              OR: [
                { email: { contains: search, mode: "insensitive" } },
                { name: { contains: search, mode: "insensitive" } },
                {
                  ownedBusinesses: {
                    some: { name: { contains: search, mode: "insensitive" } },
                  },
                },
              ],
            }
          : {}),
      },
      select: merchantSummarySelect,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...paginationArgs(query),
    });
    const page = paginateResults(merchants, query.limit);

    sendSuccess(res, 200, "Merchants returned", {
      merchants: page.data,
      pagination: page.pagination,
    });
  })
);

adminRouter.get(
  "/merchants/:merchantId",
  validate({ params: merchantIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const merchant = await prisma.merchantUser.findUnique({
      where: { id: String(req.params.merchantId) },
      select: {
        ...merchantSummarySelect,
        memberships: {
          select: {
            role: true,
            business: {
              select: {
                id: true,
                name: true,
                status: true,
                type: true,
              },
            },
          },
        },
        sessions: {
          select: {
            id: true,
            userAgent: true,
            ipAddress: true,
            lastUsedAt: true,
            expiresAt: true,
            revokedAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
        _count: {
          select: {
            passwordResetTokens: true,
            adminActionsPerformed: true,
            adminActionsReceived: true,
          },
        },
      },
    });

    if (!merchant) {
      throw new ApiError(404, "Merchant not found");
    }

    const businessIds = merchant.ownedBusinesses.map((business) => business.id);
    const apiKeys = await prisma.apiKey.findMany({
      where: { businessId: { in: businessIds } },
      select: {
        id: true,
        businessId: true,
        name: true,
        mode: true,
        prefix: true,
        lastUsedAt: true,
        revokedAt: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    sendSuccess(res, 200, "Merchant returned", { merchant, apiKeys });
  })
);

adminRouter.post(
  "/merchants/:merchantId/suspend",
  validate({ params: merchantIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const actor = requireMerchantUser(req);
    const merchant = await findTargetMerchant(String(req.params.merchantId));
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.merchantUser.update({
        where: { id: merchant.id },
        data: { status: "DISABLED" },
      });
      await tx.business.updateMany({
        where: { ownerUserId: merchant.id },
        data: { status: "SUSPENDED" },
      });
      await tx.merchantSession.updateMany({
        where: { userId: merchant.id, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.merchantPasswordResetToken.updateMany({
        where: { userId: merchant.id, usedAt: null },
        data: { usedAt: now },
      });
      await tx.adminActionLog.create({
        data: {
          actorUserId: actor.id,
          targetUserId: merchant.id,
          action: "merchant.suspended",
          details: { affectedBusinessCount: merchant.ownedBusinesses.length },
        },
      });
    });

    sendSuccess(res, 200, "Merchant suspended", {
      merchantId: merchant.id,
      status: "DISABLED",
      affectedBusinessCount: merchant.ownedBusinesses.length,
    });
  })
);

adminRouter.post(
  "/merchants/:merchantId/delete",
  validate({ params: merchantIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const actor = requireMerchantUser(req);
    const merchant = await findTargetMerchant(String(req.params.merchantId));
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.merchantUser.update({
        where: { id: merchant.id },
        data: { status: "DISABLED", deletedAt: now },
      });
      await tx.business.updateMany({
        where: { ownerUserId: merchant.id },
        data: { status: "SUSPENDED" },
      });
      await tx.merchantSession.updateMany({
        where: { userId: merchant.id, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.apiKey.updateMany({
        where: {
          revokedAt: null,
          business: { ownerUserId: merchant.id },
        },
        data: { revokedAt: now },
      });
      await tx.merchantPasswordResetToken.updateMany({
        where: { userId: merchant.id, usedAt: null },
        data: { usedAt: now },
      });
      await tx.adminActionLog.create({
        data: {
          actorUserId: actor.id,
          targetUserId: merchant.id,
          action: "merchant.soft_deleted",
          details: { affectedBusinessCount: merchant.ownedBusinesses.length },
        },
      });
    });

    sendSuccess(res, 200, "Merchant soft-deleted; records were retained", {
      merchantId: merchant.id,
      deletedAt: now,
      affectedBusinessCount: merchant.ownedBusinesses.length,
    });
  })
);

adminRouter.post(
  "/merchants/:merchantId/businesses/:businessId/api-keys/:apiKeyId/revoke",
  validate({ params: merchantApiKeyParamsSchema }),
  asyncHandler(async (req, res) => {
    const actor = requireMerchantUser(req);
    const merchant = await findTargetMerchant(String(req.params.merchantId));
    const apiKey = await prisma.apiKey.findFirst({
      where: {
        id: String(req.params.apiKeyId),
        businessId: String(req.params.businessId),
        business: { ownerUserId: merchant.id },
      },
      select: {
        id: true,
        businessId: true,
        name: true,
        mode: true,
        prefix: true,
        revokedAt: true,
      },
    });

    if (!apiKey) {
      throw new ApiError(404, "Merchant API key not found");
    }

    const updatedApiKey = await prisma.$transaction(async (tx) => {
      const revokedAt = apiKey.revokedAt ?? new Date();
      const updated = await tx.apiKey.update({
        where: { id: apiKey.id },
        data: { revokedAt },
        select: {
          id: true,
          businessId: true,
          name: true,
          mode: true,
          prefix: true,
          revokedAt: true,
        },
      });

      await tx.adminActionLog.create({
        data: {
          actorUserId: actor.id,
          targetUserId: merchant.id,
          action: "merchant.api_key_revoked",
          entityId: apiKey.id,
          details: { businessId: apiKey.businessId, mode: apiKey.mode },
        },
      });

      return updated;
    });

    sendSuccess(res, 200, "Merchant API key revoked", { apiKey: updatedApiKey });
  })
);

adminRouter.post(
  "/merchants/:merchantId/email",
  validate({ params: merchantIdParamsSchema, body: adminEmailSchema }),
  asyncHandler(async (req, res) => {
    const actor = requireMerchantUser(req);
    const merchant = await findTargetMerchant(String(req.params.merchantId));
    await sendAdminMessage({
      to: merchant.email,
      merchantName: merchant.name,
      subject: req.body.subject,
      message: req.body.message,
    });

    await recordAdminAction({
      actorUserId: actor.id,
      targetUserId: merchant.id,
      action: "merchant.email_sent",
      details: { subject: req.body.subject },
    });

    sendSuccess(res, 200, "Email sent to merchant", {
      merchantId: merchant.id,
      recipient: merchant.email,
      sent: true,
    });
  })
);
