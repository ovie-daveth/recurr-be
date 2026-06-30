import type { NextFunction, Request, Response } from "express";
import { extractBearerToken } from "../lib/api-keys";
import { ApiError } from "../lib/errors";
import { prisma } from "../lib/prisma";
import { verifyMerchantSessionToken } from "../lib/sessions";

export async function merchantSessionMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  try {
    const token = extractBearerToken(req.header("authorization"));

    if (!token) {
      throw new ApiError(401, "Missing bearer session token");
    }

    const payload = verifyMerchantSessionToken(token);
    const session = await prisma.merchantSession.findUnique({
      where: { id: payload.sid },
      include: { user: true },
    });

    if (
      !session ||
      session.userId !== payload.sub ||
      session.revokedAt ||
      session.expiresAt <= new Date()
    ) {
      throw new ApiError(401, "Invalid merchant session");
    }

    await prisma.merchantSession.update({
      where: { id: session.id },
      data: { lastUsedAt: new Date() },
    });

    const activeUser = await prisma.merchantUser.findUnique({
      where: { id: payload.sub },
    });

    if (!activeUser || activeUser.status !== "ACTIVE") {
      throw new ApiError(401, "Invalid merchant session");
    }

    req.merchantUser = {
      id: activeUser.id,
      email: activeUser.email,
      name: activeUser.name,
      passwordHash: activeUser.passwordHash,
      status: activeUser.status,
      emailVerifiedAt: activeUser.emailVerifiedAt,
      verificationTokenHash: activeUser.verificationTokenHash,
      verificationSentAt: activeUser.verificationSentAt,
      lastLoginAt: activeUser.lastLoginAt,
      createdAt: activeUser.createdAt,
      updatedAt: activeUser.updatedAt,
    };
    req.merchantSession = session;

    next();
  } catch (error) {
    next(error instanceof ApiError ? error : new ApiError(401, "Invalid merchant session"));
  }
}
