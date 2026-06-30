import { Router } from "express";
import { generateApiKey } from "../../lib/api-keys.js";
import { asyncHandler } from "../../lib/async-handler.js";
import { writeAuditLog } from "../../lib/audit.js";
import { ApiError } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { validate } from "../../middlewares/validate.middleware.js";
import { createTenantSchema } from "./tenants.schema.js";

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
    const tenant = await prisma.tenant.create({
      data: {
        name: req.body.name,
        email: req.body.email,
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
    });

    res.status(201).json({
      tenant,
      apiKey: apiKey.key,
      warning: "Store this API key now. Recurr only stores its hash.",
    });
  })
);
