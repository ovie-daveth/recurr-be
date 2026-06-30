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
    const user = await prisma.merchantUser.findUnique({
      where: { id: payload.sub },
    });

    if (!user || user.status !== "ACTIVE") {
      throw new ApiError(401, "Invalid merchant session");
    }

    req.merchantUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      passwordHash: user.passwordHash,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt,
      verificationTokenHash: user.verificationTokenHash,
      verificationSentAt: user.verificationSentAt,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };

    next();
  } catch (error) {
    next(error instanceof ApiError ? error : new ApiError(401, "Invalid merchant session"));
  }
}
