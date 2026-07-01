import { Router } from "express";
import { generateApiKey } from "../../lib/api-keys";
import { asyncHandler } from "../../lib/async-handler";
import { writeAuditLog } from "../../lib/audit";
import { ApiError, requireMerchantUser } from "../../lib/errors";
import { dateRangeFilter, paginateResults, paginationArgs } from "../../lib/pagination";
import { prisma } from "../../lib/prisma";
import { sendSuccess } from "../../lib/responses";
import { validate } from "../../middlewares/validate.middleware";
import {
  apiKeyIdParamsSchema,
  createApiKeySchema,
  listApiKeysQuerySchema,
} from "./api-keys.schema";

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
  validate({ query: listApiKeysQuerySchema }),
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);
    const businessId = String(req.params.businessId);
    const query = req.validatedQuery as typeof listApiKeysQuerySchema._output;
    await requireKeyManagementAccess(businessId, user.id);
    const now = new Date();

    const apiKeys = await prisma.apiKey.findMany({
      where: {
        businessId,
        ...(query.mode ? { mode: query.mode } : {}),
        ...(dateRangeFilter(query) ? { createdAt: dateRangeFilter(query) } : {}),
        ...(query.status === "ACTIVE"
          ? { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }
          : {}),
        ...(query.status === "REVOKED" ? { revokedAt: { not: null } } : {}),
        ...(query.status === "EXPIRED" ? { revokedAt: null, expiresAt: { lte: now } } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...paginationArgs(query),
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
    const page = paginateResults(apiKeys, query.limit);

    sendSuccess(res, 200, "API keys returned", {
      apiKeys: page.data,
      pagination: page.pagination,
    });
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

    sendSuccess(res, 201, "API key created", {
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

    sendSuccess(res, 200, "API key revoked", { apiKey });
  })
);
