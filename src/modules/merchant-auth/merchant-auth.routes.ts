import { Router } from "express";
import { generateVerificationToken, hashApiKey } from "../../lib/api-keys";
import { asyncHandler } from "../../lib/async-handler";
import { writeAuditLog } from "../../lib/audit";
import { ApiError, requireMerchantUser } from "../../lib/errors";
import { hashPassword, verifyPassword } from "../../lib/passwords";
import { prisma } from "../../lib/prisma";
import { createMerchantSessionToken } from "../../lib/sessions";
import { merchantSessionMiddleware } from "../../middlewares/merchant-session.middleware";
import { merchantSignupRateLimit } from "../../middlewares/rate-limit.middleware";
import { validate } from "../../middlewares/validate.middleware";
import {
  merchantLoginSchema,
  merchantSignupSchema,
  merchantVerifyEmailSchema,
} from "./merchant-auth.schema";

export const merchantAuthRouter = Router();

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

    res.status(201).json({
      user: {
        id: result.user.id,
        email: result.user.email,
        name: result.user.name,
        status: result.user.status,
      },
      business: result.business,
      verificationToken: verification.token,
      verificationUrl: "/api/v1/merchants/verify-email",
      warning:
        "Merchant is pending email verification. In production, the verification token is emailed instead of returned.",
    });
  })
);

merchantAuthRouter.post(
  "/verify-email",
  validate({ body: merchantVerifyEmailSchema }),
  asyncHandler(async (req, res) => {
    const user = await prisma.merchantUser.findUnique({
      where: { email: req.body.email },
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

    if (hashApiKey(req.body.token) !== user.verificationTokenHash) {
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

    const token = createMerchantSessionToken({
      userId: result.activeUser.id,
    });

    res.status(200).json({
      token,
      tokenType: "Bearer",
      user: {
        id: result.activeUser.id,
        email: result.activeUser.email,
        name: result.activeUser.name,
        status: result.activeUser.status,
      },
      businesses: result.businesses,
    });
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
      throw new ApiError(401, "Invalid email or password");
    }

    if (user.status !== "ACTIVE") {
      throw new ApiError(403, "Merchant account is not active");
    }

    const passwordIsValid = await verifyPassword(req.body.password, user.passwordHash);
    if (!passwordIsValid) {
      throw new ApiError(401, "Invalid email or password");
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

    const token = createMerchantSessionToken({
      userId: user.id,
    });

    res.status(200).json({
      token,
      tokenType: "Bearer",
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

    res.status(200).json({
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
