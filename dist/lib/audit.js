"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeAuditLog = writeAuditLog;
const prisma_1 = require("./prisma");
async function writeAuditLog(input) {
    await prisma_1.prisma.auditLog.create({
        data: {
            businessId: input.businessId,
            action: input.action,
            entity: input.entity,
            entityId: input.entityId,
            metadata: input.metadata == null
                ? undefined
                : input.metadata,
        },
    });
}
