"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.devCleanupRouter = void 0;
const express_1 = require("express");
const async_handler_1 = require("../../lib/async-handler");
const errors_1 = require("../../lib/errors");
const prisma_1 = require("../../lib/prisma");
const responses_1 = require("../../lib/responses");
const merchant_session_middleware_1 = require("../../middlewares/merchant-session.middleware");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const cleanup_service_1 = require("../cleanup/cleanup.service");
const dev_cleanup_schema_1 = require("./dev-cleanup.schema");
exports.devCleanupRouter = (0, express_1.Router)();
exports.devCleanupRouter.use(merchant_session_middleware_1.merchantSessionMiddleware);
async function requireCleanupAccess(businessId, userId) {
    if (!businessId) {
        return;
    }
    const membership = await prisma_1.prisma.businessMember.findFirst({
        where: {
            businessId,
            userId,
            role: { in: ["OWNER", "ADMIN", "DEVELOPER"] },
        },
    });
    if (!membership) {
        throw new errors_1.ApiError(404, "Business not found", [], "BUSINESS_NOT_FOUND");
    }
}
exports.devCleanupRouter.post("/run", (0, validate_middleware_1.validate)({ body: dev_cleanup_schema_1.runCleanupSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const input = req.body;
    await requireCleanupAccess(input.businessId, user.id);
    const result = await (0, cleanup_service_1.runCleanup)(input);
    (0, responses_1.sendSuccess)(res, 200, "Cleanup completed", result);
}));
