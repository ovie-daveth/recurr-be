import { prisma } from "./prisma";
import type { Prisma } from "../generated/prisma/client";

type AuditInput = {
  businessId: string;
  action: string;
  entity: string;
  entityId?: string;
  metadata?: unknown;
};

export async function writeAuditLog(input: AuditInput) {
  await prisma.auditLog.create({
    data: {
      businessId: input.businessId,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      metadata:
        input.metadata == null
          ? undefined
          : (input.metadata as Prisma.InputJsonValue),
    },
  });
}
