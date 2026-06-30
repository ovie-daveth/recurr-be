import type { NextFunction, Request, Response } from "express";
import { hashApiKey, extractBearerToken } from "../lib/api-keys";
import { ApiError } from "../lib/errors";
import { prisma } from "../lib/prisma";

export async function tenantMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  try {
    const token = extractBearerToken(req.header("authorization"));
    if (!token) {
      throw new ApiError(401, "Missing bearer API key");
    }

    const keyHash = hashApiKey(token);
    const apiKey = await prisma.apiKey.findUnique({
      where: { keyHash },
      include: { tenant: true },
    });

    if (!apiKey || apiKey.revokedAt) {
      throw new ApiError(401, "Invalid API key");
    }

    if (apiKey.tenant.status !== "ACTIVE") {
      throw new ApiError(403, "Tenant is not active");
    }

    req.tenant = apiKey.tenant;
    req.apiKey = {
      id: apiKey.id,
      tenantId: apiKey.tenantId,
      name: apiKey.name,
      prefix: apiKey.prefix,
      keyHash: apiKey.keyHash,
      lastUsedAt: apiKey.lastUsedAt,
      revokedAt: apiKey.revokedAt,
      createdAt: apiKey.createdAt,
    };

    await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    });

    next();
  } catch (error) {
    next(error);
  }
}
