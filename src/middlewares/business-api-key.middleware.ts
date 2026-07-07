import type { NextFunction, Request, Response } from "express";
import { extractBearerToken, hashApiKey } from "../lib/api-keys";
import { ApiError } from "../lib/errors";
import { prisma } from "../lib/prisma";

export async function businessApiKeyMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  try {
    const token = extractBearerToken(req.header("authorization"));
    if (!token) {
      throw new ApiError(401, "Missing bearer API key");
    }

    const apiKey = await prisma.apiKey.findUnique({
      where: { keyHash: hashApiKey(token) },
      include: { business: true },
    });

    if (!apiKey || apiKey.revokedAt) {
      throw new ApiError(401, "Invalid API key");
    }

    if (apiKey.expiresAt && apiKey.expiresAt <= new Date()) {
      throw new ApiError(401, "API key has expired");
    }

    if (apiKey.business.status !== "ACTIVE") {
      throw new ApiError(403, "Business is not active");
    }

    req.business = apiKey.business;
    req.apiKey = {
      id: apiKey.id,
      businessId: apiKey.businessId,
      name: apiKey.name,
      mode: apiKey.mode,
      prefix: apiKey.prefix,
      keyHash: apiKey.keyHash,
      lastUsedAt: apiKey.lastUsedAt,
      revokedAt: apiKey.revokedAt,
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
    };
    req.businessMode = apiKey.mode;

    await prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    });

    next();
  } catch (error) {
    next(error);
  }
}
