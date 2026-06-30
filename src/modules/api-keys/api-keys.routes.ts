import { Router } from "express";
import { generateApiKey } from "../../lib/api-keys";
import { asyncHandler } from "../../lib/async-handler";
import { writeAuditLog } from "../../lib/audit";
import { ApiError, requireMerchantUser } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { validate } from "../../middlewares/validate.middleware";
import { apiKeyIdParamsSchema, createApiKeySchema } from "./api-keys.schema";

export const apiKeysRouter = Router({ mergeParams: true });

async function requireKeyManagementAccess(businessId: string, userId: string) {
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

apiKeysRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);
    const businessId = String(req.params.businessId);
    await requireKeyManagementAccess(businessId, user.id);

    const apiKeys = await prisma.apiKey.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        mode: true,
        prefix: true,
        expiresAt: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });

    res.status(200).json({ apiKeys });
  })
);

apiKeysRouter.post(
  "/",
  validate({ body: createApiKeySchema }),
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);
    const businessId = String(req.params.businessId);
    await requireKeyManagementAccess(businessId, user.id);

    const generated = generateApiKey(req.body.mode);
    const apiKey = await prisma.apiKey.create({
      data: {
        businessId,
        name: req.body.name,
        mode: req.body.mode,
        prefix: generated.prefix,
        keyHash: generated.hash,
        expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : undefined,
      },
      select: {
        id: true,
        name: true,
        mode: true,
        prefix: true,
        expiresAt: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });

    await writeAuditLog({
      businessId,
      action: "api_key.created",
      entity: "api_key",
      entityId: apiKey.id,
      metadata: { name: apiKey.name, mode: apiKey.mode, userId: user.id },
    });

    res.status(201).json({
      apiKey,
      secret: generated.key,
      warning: "Store this API key now. Recurr only stores its hash.",
    });
  })
);

apiKeysRouter.post(
  "/:id/revoke",
  validate({ params: apiKeyIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);
    const businessId = String(req.params.businessId);
    const id = String(req.params.id);
    await requireKeyManagementAccess(businessId, user.id);

    const existingApiKey = await prisma.apiKey.findFirst({
      where: { id, businessId },
    });

    if (!existingApiKey) {
      throw new ApiError(404, "API key not found");
    }

    const apiKey = await prisma.apiKey.update({
      where: { id },
      data: { revokedAt: existingApiKey.revokedAt ?? new Date() },
      select: {
        id: true,
        name: true,
        mode: true,
        prefix: true,
        expiresAt: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });

    await writeAuditLog({
      businessId,
      action: "api_key.revoked",
      entity: "api_key",
      entityId: apiKey.id,
      metadata: { name: apiKey.name, mode: apiKey.mode, userId: user.id },
    });

    res.status(200).json({ apiKey });
  })
);
