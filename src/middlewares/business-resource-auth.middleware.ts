import type { NextFunction, Request, Response } from "express";
import { extractBearerToken, hashApiKey } from "../lib/api-keys";
import { ApiError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { verifyMerchantSessionToken } from "../lib/sessions";

function isMode(value: unknown): value is "TEST" | "LIVE" {
  return value === "TEST" || value === "LIVE";
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readDashboardContext(req: Request) {
  const businessId =
    readString(req.query.businessId) ??
    readString(req.body?.businessId);
  const mode = readString(req.query.mode) ?? readString(req.body?.mode);

  if (!businessId) {
    throw new ApiError(400, "businessId is required for dashboard access", [], "BUSINESS_ID_REQUIRED");
  }

  if (!isMode(mode)) {
    throw new ApiError(400, "mode must be TEST or LIVE for dashboard access", [], "MODE_REQUIRED");
  }

  return { businessId, mode };
}

async function authenticateWithApiKey(token: string, req: Request) {
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
}

async function authenticateWithMerchantSession(token: string, req: Request) {
  const payload = verifyMerchantSessionToken(token);
  const session = await prisma.merchantSession.findUnique({
    where: { id: payload.sid },
    include: { user: true },
  });

  if (
    !session ||
    session.userId !== payload.sub ||
    session.revokedAt ||
    session.expiresAt <= new Date() ||
    session.user.status !== "ACTIVE"
  ) {
    throw new ApiError(401, "Invalid merchant session");
  }

  const { businessId, mode } = readDashboardContext(req);
  const business = await prisma.business.findFirst({
    where: {
      id: businessId,
      status: "ACTIVE",
      members: {
        some: {
          userId: session.userId,
          role: { in: ["OWNER", "ADMIN", "DEVELOPER"] },
        },
      },
    },
  });

  if (!business) {
    throw new ApiError(404, "Business not found", [], "BUSINESS_NOT_FOUND");
  }

  await prisma.merchantSession.update({
    where: { id: session.id },
    data: { lastUsedAt: new Date() },
  });

  req.business = business;
  req.businessMode = mode;
  req.merchantSession = session;
  req.merchantUser = session.user;
}

export async function businessResourceAuthMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  try {
    const token = extractBearerToken(req.header("authorization"));
    if (!token) {
      throw new ApiError(401, "Missing bearer token");
    }

    if (token.startsWith("sk_test_") || token.startsWith("sk_live_")) {
      await authenticateWithApiKey(token, req);
    } else {
      await authenticateWithMerchantSession(token, req);
    }

    next();
  } catch (error) {
    next(error instanceof ApiError ? error : new ApiError(401, "Invalid business resource auth"));
  }
}
