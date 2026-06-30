import { Router } from "express";
import { generateApiKey, generateVerificationToken, hashApiKey } from "../../lib/api-keys";
import { asyncHandler } from "../../lib/async-handler";
import { writeAuditLog } from "../../lib/audit";
import { ApiError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { validate } from "../../middlewares/validate.middleware";
import { createTenantSchema, verifyTenantEmailSchema } from "./tenants.schema";

export const tenantsRouter = Router();

tenantsRouter.post(
  "/",
  validate({ body: createTenantSchema }),
  asyncHandler(async (req, res) => {
    const existingTenant = await prisma.tenant.findUnique({
      where: { email: req.body.email },
    });

    if (existingTenant) {
      throw new ApiError(409, "Tenant with this email already exists");
    }

    const apiKey = generateApiKey();
    const verification = generateVerificationToken();
    const name =
      req.body.type === "BUSINESS" ? req.body.businessName : req.body.legalName;

    const tenant = await prisma.tenant.create({
      data: {
        type: req.body.type,
        name,
        email: req.body.email,
        status: "PENDING_VERIFICATION",
        verificationTokenHash: verification.hash,
        verificationSentAt: new Date(),
        businessName:
          req.body.type === "BUSINESS" ? req.body.businessName : undefined,
        businessRegistrationNumber:
          req.body.type === "BUSINESS"
            ? req.body.businessRegistrationNumber
            : undefined,
        taxId: req.body.type === "BUSINESS" ? req.body.taxId : undefined,
        website: req.body.type === "BUSINESS" ? req.body.website : undefined,
        legalName: req.body.type === "INDIVIDUAL" ? req.body.legalName : undefined,
        contactName: req.body.contactName,
        contactPhone: req.body.contactPhone,
        country: req.body.country,
        apiKeys: {
          create: {
            name: req.body.apiKeyName,
            prefix: apiKey.prefix,
            keyHash: apiKey.hash,
          },
        },
      },
    });

    await writeAuditLog({
      tenantId: tenant.id,
      action: "tenant.created",
      entity: "tenant",
      entityId: tenant.id,
      metadata: { type: tenant.type, status: tenant.status },
    });

    res.status(201).json({
      tenant,
      apiKey: apiKey.key,
      verificationToken: verification.token,
      verificationUrl: `/api/v1/tenants/verify-email`,
      warning:
        "Store this API key now. Recurr only stores its hash. In production, the verification token is emailed instead of returned.",
    });
  })
);

tenantsRouter.post(
  "/verify-email",
  validate({ body: verifyTenantEmailSchema }),
  asyncHandler(async (req, res) => {
    const tenant = await prisma.tenant.findUnique({
      where: { email: req.body.email },
    });

    if (!tenant) {
      throw new ApiError(404, "Tenant not found");
    }

    if (tenant.emailVerifiedAt && tenant.status === "ACTIVE") {
      res.status(200).json({
        tenant,
        verified: true,
      });
      return;
    }

    if (!tenant.verificationTokenHash) {
      throw new ApiError(400, "No verification token is active for this tenant");
    }

    if (hashApiKey(req.body.token) !== tenant.verificationTokenHash) {
      throw new ApiError(400, "Invalid verification token");
    }

    const verifiedTenant = await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
        verificationTokenHash: null,
      },
    });

    await writeAuditLog({
      tenantId: verifiedTenant.id,
      action: "tenant.email_verified",
      entity: "tenant",
      entityId: verifiedTenant.id,
    });

    res.status(200).json({
      tenant: verifiedTenant,
      verified: true,
    });
  })
);
