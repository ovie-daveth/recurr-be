import { Router, type Request } from "express";
import { generateVerificationToken, hashApiKey } from "../../lib/api-keys";
import { asyncHandler } from "../../lib/async-handler";
import { writeAuditLog } from "../../lib/audit";
import { ApiError, requireMerchantUser } from "../../lib/errors";
import { hashPassword, verifyPassword } from "../../lib/passwords";
import { prisma } from "../../lib/prisma";
import { sendSuccess } from "../../lib/responses";
import {
  createMerchantSessionToken,
  generateMerchantRefreshToken,
  getMerchantAccessTokenTtlSeconds,
  getMerchantRefreshTokenExpiryDate,
  getMerchantRefreshTokenTtlDays,
  hashMerchantRefreshToken,
} from "../../lib/sessions";
import {
  buildMerchantPasswordResetUrl,
  buildMerchantVerificationUrl,
  sendMerchantPasswordResetEmail,
  sendMerchantVerificationEmail,
} from "../../lib/mailer";
import { merchantSessionMiddleware } from "../../middlewares/merchant-session.middleware";
import { merchantSignupRateLimit } from "../../middlewares/rate-limit.middleware";
import { validate } from "../../middlewares/validate.middleware";
import {
  merchantForgotPasswordSchema,
  merchantLoginSchema,
  merchantLogoutSchema,
  merchantRefreshSessionSchema,
  merchantResetPasswordSchema,
  merchantSignupSchema,
  merchantVerifyEmailSchema,
  updateMerchantProfileSchema,
} from "./merchant-auth.schema";

export const merchantAuthRouter = Router();

function getRequestIp(req: Request) {
  return req.ip || req.socket.remoteAddress;
}

function getPasswordResetTokenTtlMinutes() {
  const parsed = Number(process.env.MERCHANT_PASSWORD_RESET_TOKEN_TTL_MINUTES);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 30;
}

function getPasswordResetExpiryDate() {
  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + getPasswordResetTokenTtlMinutes());
  return expiresAt;
}

async function createTrackedMerchantSession(input: {
  userId: string;
  userAgent?: string;
  ipAddress?: string;
  rotatedFromSessionId?: string;
}) {
  const refreshToken = generateMerchantRefreshToken();
  const refreshTokenHash = hashMerchantRefreshToken(refreshToken);
  const refreshTokenExpiresAt = getMerchantRefreshTokenExpiryDate();

  const session = await prisma.merchantSession.create({
    data: {
      userId: input.userId,
      refreshTokenHash,
      userAgent: input.userAgent,
      ipAddress: input.ipAddress,
      expiresAt: refreshTokenExpiresAt,
      rotatedFromSessionId: input.rotatedFromSessionId,
    },
  });

  const accessToken = createMerchantSessionToken({
    userId: input.userId,
    sessionId: session.id,
  });

  return {
    accessToken,
    token: accessToken,
    tokenType: "Bearer",
    expiresIn: getMerchantAccessTokenTtlSeconds(),
    refreshToken,
    refreshTokenExpiresAt,
    refreshTokenTtlDays: getMerchantRefreshTokenTtlDays(),
    session: {
      id: session.id,
      userAgent: session.userAgent,
      ipAddress: session.ipAddress,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
    },
  };
}

async function verifyMerchantEmail(email: string, token: string, req: Request) {
  const user = await prisma.merchantUser.findUnique({
    where: { email },
  });

  if (!user) {
    throw new ApiError(404, "Merchant user not found");
  }

  if (user.status === "ACTIVE" || user.emailVerifiedAt) {
    throw new ApiError(400, "Merchant email is already verified");
  }

  if (!user.verificationTokenHash) {
    throw new ApiError(400, "No verification token is active for this merchant");
  }

  if (hashApiKey(token) !== user.verificationTokenHash) {
    throw new ApiError(400, "Invalid verification token");
  }

  const result = await prisma.$transaction(async (tx) => {
    const activeUser = await tx.merchantUser.update({
      where: { id: user.id },
      data: {
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        verificationTokenHash: null,
      },
    });

    await tx.business.updateMany({
      where: {
        ownerUserId: user.id,
        status: "PENDING_VERIFICATION",
      },
      data: { status: "ACTIVE" },
    });

    const businesses = await tx.business.findMany({
      where: { ownerUserId: user.id },
      orderBy: { createdAt: "asc" },
    });

    return { activeUser, businesses };
  });

  for (const business of result.businesses) {
    await writeAuditLog({
      businessId: business.id,
      action: "merchant_user.email_verified",
      entity: "merchant_user",
      entityId: result.activeUser.id,
    });
  }

  const auth = await createTrackedMerchantSession({
    userId: result.activeUser.id,
    userAgent: req.header("user-agent"),
    ipAddress: getRequestIp(req),
  });

  return {
    ...auth,
    user: {
      id: result.activeUser.id,
      email: result.activeUser.email,
      name: result.activeUser.name,
      status: result.activeUser.status,
    },
    businesses: result.businesses,
  };
}

merchantAuthRouter.post(
  "/signup",
  merchantSignupRateLimit,
  validate({ body: merchantSignupSchema }),
  asyncHandler(async (req, res) => {
    const existingUser = await prisma.merchantUser.findUnique({
      where: { email: req.body.email },
    });

    if (existingUser) {
      throw new ApiError(409, "Merchant user with this email already exists");
    }

    const verification = generateVerificationToken();
    const passwordHash = await hashPassword(req.body.password);
    const businessName =
      req.body.type === "BUSINESS" ? req.body.businessName : req.body.legalName;

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.merchantUser.create({
        data: {
          email: req.body.email,
          name: req.body.name,
          passwordHash,
          status: "PENDING_VERIFICATION",
          verificationTokenHash: verification.hash,
          verificationSentAt: new Date(),
        },
      });

      const business = await tx.business.create({
        data: {
          ownerUserId: user.id,
          type: req.body.type,
          name: businessName,
          status: "PENDING_VERIFICATION",
          businessName:
            req.body.type === "BUSINESS" ? req.body.businessName : undefined,
          businessRegistrationNumber:
            req.body.type === "BUSINESS"
              ? req.body.businessRegistrationNumber
              : undefined,
          taxId: req.body.type === "BUSINESS" ? req.body.taxId : undefined,
          website: req.body.type === "BUSINESS" ? req.body.website : undefined,
          legalName:
            req.body.type === "INDIVIDUAL" ? req.body.legalName : undefined,
          contactName: req.body.contactName,
          contactEmail: req.body.email,
          contactPhone: req.body.contactPhone,
          country: req.body.country,
          members: {
            create: {
              userId: user.id,
              role: "OWNER",
            },
          },
        },
      });

      return { user, business };
    });

    await writeAuditLog({
      businessId: result.business.id,
      action: "merchant_user.signup",
      entity: "merchant_user",
      entityId: result.user.id,
      metadata: { email: result.user.email },
    });

    const verificationUrl = buildMerchantVerificationUrl(
      result.user.email,
      verification.token
    );
    const emailDelivery = await sendMerchantVerificationEmail({
      to: result.user.email,
      merchantName: result.user.name,
      verificationUrl,
    });
    const includeDevToken = process.env.NODE_ENV !== "production";

    sendSuccess(res, 201, "Merchant signup created. Verify email to continue.", {
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        status: result.user.status,
      },
      business: result.business,
      emailVerificationSent: emailDelivery.sent,
      verificationUrl: includeDevToken ? verificationUrl : undefined,
      verificationToken: includeDevToken ? verification.token : undefined,
      warning:
        includeDevToken
          ? "Development only: verification token is returned and the verification link is logged when SMTP is not configured."
          : undefined,
    });
  })
);

merchantAuthRouter.get(
  "/verify-email",
  validate({ query: merchantVerifyEmailSchema }),
  asyncHandler(async (req, res) => {
    const result = await verifyMerchantEmail(
      req.query.email as string,
      req.query.token as string,
      req
    );

    sendSuccess(res, 200, "Merchant email verified", result);
  })
);

merchantAuthRouter.post(
  "/verify-email",
  validate({ body: merchantVerifyEmailSchema }),
  asyncHandler(async (req, res) => {
    const result = await verifyMerchantEmail(req.body.email, req.body.token, req);

    sendSuccess(res, 200, "Merchant email verified", result);
  })
);

merchantAuthRouter.post(
  "/login",
  validate({ body: merchantLoginSchema }),
  asyncHandler(async (req, res) => {
    const user = await prisma.merchantUser.findUnique({
      where: { email: req.body.email },
    });

    if (!user) {
      throw new ApiError(401, "Invalid email or password", [], "INVALID_CREDENTIALS");
    }

    if (user.status !== "ACTIVE") {
      throw new ApiError(403, "Merchant account is not active", [], "MERCHANT_ACCOUNT_INACTIVE");
    }

    const passwordIsValid = await verifyPassword(req.body.password, user.passwordHash);
    if (!passwordIsValid) {
      throw new ApiError(401, "Invalid email or password", [], "INVALID_CREDENTIALS");
    }

    const updatedUser = await prisma.merchantUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const businesses = await prisma.business.findMany({
      where: {
        members: {
          some: { userId: user.id },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    for (const business of businesses) {
      await writeAuditLog({
        businessId: business.id,
        action: "merchant_user.login",
        entity: "merchant_user",
        entityId: user.id,
        metadata: { email: user.email },
      });
    }

    const auth = await createTrackedMerchantSession({
      userId: user.id,
      userAgent: req.header("user-agent"),
      ipAddress: getRequestIp(req),
    });

    sendSuccess(res, 200, "Merchant logged in", {
      ...auth,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        status: updatedUser.status,
        lastLoginAt: updatedUser.lastLoginAt,
      },
      businesses,
    });
  })
);

merchantAuthRouter.post(
  "/forgot-password",
  validate({ body: merchantForgotPasswordSchema }),
  asyncHandler(async (req, res) => {
    const user = await prisma.merchantUser.findUnique({
      where: { email: req.body.email },
    });

    if (user && user.status !== "DISABLED") {
      const reset = generateVerificationToken();
      const expiresAt = getPasswordResetExpiryDate();

      await prisma.$transaction(async (tx) => {
        await tx.merchantPasswordResetToken.updateMany({
          where: {
            userId: user.id,
            usedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: { usedAt: new Date() },
        });

        await tx.merchantPasswordResetToken.create({
          data: {
            userId: user.id,
            tokenHash: reset.hash,
            expiresAt,
          },
        });
      });

      const resetUrl = buildMerchantPasswordResetUrl(user.email, reset.token);
      const delivery = await sendMerchantPasswordResetEmail({
        to: user.email,
        merchantName: user.name,
        resetUrl,
      });

      if (process.env.NODE_ENV !== "production") {
        sendSuccess(res, 200, "Password reset link sent if account exists", {
          message:
            "If a merchant account exists for this email, a password reset link has been sent.",
          resetEmailSent: delivery.sent,
          resetUrl,
          resetToken: reset.token,
          expiresAt,
          warning:
            "Development only: reset token is returned and the reset link is logged when SMTP is not configured.",
        });
        return;
      }
    }

    sendSuccess(res, 200, "Password reset link sent if account exists", {
      message:
        "If a merchant account exists for this email, a password reset link has been sent.",
    });
  })
);

merchantAuthRouter.post(
  "/reset-password",
  validate({ body: merchantResetPasswordSchema }),
  asyncHandler(async (req, res) => {
    const user = await prisma.merchantUser.findUnique({
      where: { email: req.body.email },
    });

    if (!user) {
      throw new ApiError(400, "Invalid or expired password reset token");
    }

    const resetTokenHash = hashApiKey(req.body.token);
    const resetToken = await prisma.merchantPasswordResetToken.findUnique({
      where: { tokenHash: resetTokenHash },
    });

    if (
      !resetToken ||
      resetToken.userId !== user.id ||
      resetToken.usedAt ||
      resetToken.expiresAt <= new Date()
    ) {
      throw new ApiError(400, "Invalid or expired password reset token");
    }

    const passwordHash = await hashPassword(req.body.password);

    await prisma.$transaction(async (tx) => {
      await tx.merchantPasswordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      });

      await tx.merchantUser.update({
        where: { id: user.id },
        data: { passwordHash },
      });

      await tx.merchantSession.updateMany({
        where: {
          userId: user.id,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
    });

    const businesses = await prisma.business.findMany({
      where: {
        members: {
          some: { userId: user.id },
        },
      },
      select: { id: true },
    });

    for (const business of businesses) {
      await writeAuditLog({
        businessId: business.id,
        action: "merchant_user.password_reset",
        entity: "merchant_user",
        entityId: user.id,
        metadata: { email: user.email },
      });
    }

    sendSuccess(res, 200, "Password reset successfully", {
      message: "Password reset successfully. Please log in again.",
    });
  })
);

merchantAuthRouter.post(
  "/refresh",
  validate({ body: merchantRefreshSessionSchema }),
  asyncHandler(async (req, res) => {
    const refreshTokenHash = hashMerchantRefreshToken(req.body.refreshToken);
    const existingSession = await prisma.merchantSession.findUnique({
      where: { refreshTokenHash },
      include: { user: true },
    });

    if (
      !existingSession ||
      existingSession.revokedAt ||
      existingSession.expiresAt <= new Date() ||
      existingSession.user.status !== "ACTIVE"
    ) {
      throw new ApiError(401, "Invalid refresh token", [], "INVALID_REFRESH_TOKEN");
    }

    await prisma.merchantSession.update({
      where: { id: existingSession.id },
      data: {
        revokedAt: new Date(),
        lastUsedAt: new Date(),
      },
    });

    const auth = await createTrackedMerchantSession({
      userId: existingSession.userId,
      userAgent: req.header("user-agent") || existingSession.userAgent || undefined,
      ipAddress: getRequestIp(req) || existingSession.ipAddress || undefined,
      rotatedFromSessionId: existingSession.id,
    });

    sendSuccess(res, 200, "Merchant session refreshed", {
      ...auth,
      user: {
        id: existingSession.user.id,
        email: existingSession.user.email,
        name: existingSession.user.name,
        status: existingSession.user.status,
      },
    });
  })
);

merchantAuthRouter.post(
  "/logout",
  merchantSessionMiddleware,
  validate({ body: merchantLogoutSchema }),
  asyncHandler(async (req, res) => {
    const sessionIds = new Set<string>();

    if (req.merchantSession) {
      sessionIds.add(req.merchantSession.id);
    }

    if (req.body.refreshToken) {
      const refreshTokenHash = hashMerchantRefreshToken(req.body.refreshToken);
      const refreshSession = await prisma.merchantSession.findUnique({
        where: { refreshTokenHash },
      });

      if (refreshSession && refreshSession.userId === req.merchantUser?.id) {
        sessionIds.add(refreshSession.id);
      }
    }

    await prisma.merchantSession.updateMany({
      where: {
        id: { in: Array.from(sessionIds) },
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    sendSuccess(res, 200, "Merchant logged out", { loggedOut: true });
  })
);

merchantAuthRouter.get(
  "/me",
  merchantSessionMiddleware,
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);
    const businesses = await prisma.business.findMany({
      where: {
        members: {
          some: { userId: user.id },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    sendSuccess(res, 200, "Merchant user returned", {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        status: user.status,
        lastLoginAt: user.lastLoginAt,
      },
      businesses,
    });
  })
);

merchantAuthRouter.patch(
  "/me",
  merchantSessionMiddleware,
  validate({ body: updateMerchantProfileSchema }),
  asyncHandler(async (req, res) => {
    const user = requireMerchantUser(req);

    if (Object.keys(req.body).length === 0) {
      throw new ApiError(400, "At least one field is required", [], "EMPTY_UPDATE");
    }

    const updatedUser = await prisma.merchantUser.update({
      where: { id: user.id },
      data: {
        name: req.body.name,
      },
    });

    const businesses = await prisma.business.findMany({
      where: {
        members: {
          some: { userId: user.id },
        },
      },
      select: { id: true },
    });

    for (const business of businesses) {
      await writeAuditLog({
        businessId: business.id,
        action: "merchant_user.updated",
        entity: "merchant_user",
        entityId: user.id,
        metadata: { fields: Object.keys(req.body) },
      });
    }

    sendSuccess(res, 200, "Merchant profile updated", {
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        name: updatedUser.name,
        status: updatedUser.status,
        lastLoginAt: updatedUser.lastLoginAt,
      },
    });
  })
);
