import { Router } from "express";
import { generateApiKey } from "../../lib/api-keys";
import { asyncHandler } from "../../lib/async-handler";
import { writeAuditLog } from "../../lib/audit";
import { ApiError, requireTenant } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { tenantMiddleware } from "../../middlewares/tenant.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { apiKeyIdParamsSchema, createApiKeySchema } from "./api-keys.schema";

export const apiKeysRouter = Router();

apiKeysRouter.use(tenantMiddleware);

apiKeysRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const tenant = requireTenant(req);
    const apiKeys = await prisma.apiKey.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        prefix: true,
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
    const tenant = requireTenant(req);
    const generated = generateApiKey();

    const apiKey = await prisma.apiKey.create({
      data: {
        tenantId: tenant.id,
        name: req.body.name,
        prefix: generated.prefix,
        keyHash: generated.hash,
      },
      select: {
        id: true,
        name: true,
        prefix: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });

    await writeAuditLog({
      tenantId: tenant.id,
      action: "api_key.created",
      entity: "api_key",
      entityId: apiKey.id,
      metadata: { name: apiKey.name },
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
    const tenant = requireTenant(req);
    const id = String(req.params.id);

    if (req.apiKey?.id === id) {
      throw new ApiError(
        400,
        "Create and switch to a replacement API key before revoking the key used by this request"
      );
    }

    const existingApiKey = await prisma.apiKey.findFirst({
      where: {
        id,
        tenantId: tenant.id,
      },
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
        prefix: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    });

    await writeAuditLog({
      tenantId: tenant.id,
      action: "api_key.revoked",
      entity: "api_key",
      entityId: apiKey.id,
      metadata: { name: apiKey.name },
    });

    res.status(200).json({ apiKey });
  })
);
