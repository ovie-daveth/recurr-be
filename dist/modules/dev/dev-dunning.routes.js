"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.devDunningRouter = void 0;
const express_1 = require("express");
const async_handler_1 = require("../../lib/async-handler");
const errors_1 = require("../../lib/errors");
const prisma_1 = require("../../lib/prisma");
const responses_1 = require("../../lib/responses");
const merchant_session_middleware_1 = require("../../middlewares/merchant-session.middleware");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const dunning_service_1 = require("../dunning/dunning.service");
const dev_dunning_schema_1 = require("./dev-dunning.schema");
exports.devDunningRouter = (0, express_1.Router)();
exports.devDunningRouter.use(merchant_session_middleware_1.merchantSessionMiddleware);
async function requireDunningRunAccess(businessId, userId) {
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
exports.devDunningRouter.post("/run-due", (0, validate_middleware_1.validate)({ body: dev_dunning_schema_1.runDueDunningSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const user = (0, errors_1.requireMerchantUser)(req);
    const input = req.body;
    await requireDunningRunAccess(input.businessId, user.id);
    const result = await (0, dunning_service_1.runDueDunning)(input);
    (0, responses_1.sendSuccess)(res, 200, "Due dunning run completed", result);
}));
