"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentAttemptsRouter = void 0;
const express_1 = require("express");
const async_handler_1 = require("../../lib/async-handler");
const errors_1 = require("../../lib/errors");
const pagination_1 = require("../../lib/pagination");
const prisma_1 = require("../../lib/prisma");
const responses_1 = require("../../lib/responses");
const business_resource_auth_middleware_1 = require("../../middlewares/business-resource-auth.middleware");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const payment_attempts_schema_1 = require("./payment-attempts.schema");
exports.paymentAttemptsRouter = (0, express_1.Router)();
exports.paymentAttemptsRouter.use(business_resource_auth_middleware_1.businessResourceAuthMiddleware);
const paymentAttemptInclude = {
    invoice: {
        include: {
            items: true,
        },
    },
    subscription: true,
    customer: true,
    paymentMethod: true,
};
exports.paymentAttemptsRouter.get("/", (0, validate_middleware_1.validate)({ query: payment_attempts_schema_1.listPaymentAttemptsQuerySchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const mode = (0, errors_1.requireBusinessMode)(req);
    const query = req.validatedQuery;
    const attempts = await prisma_1.prisma.paymentAttempt.findMany({
        where: {
            businessId: business.id,
            mode: mode,
            ...(query.status ? { status: query.status } : {}),
            ...(query.invoiceId ? { invoiceId: query.invoiceId } : {}),
            ...(query.subscriptionId ? { subscriptionId: query.subscriptionId } : {}),
            ...(query.customerId ? { customerId: query.customerId } : {}),
            ...((0, pagination_1.dateRangeFilter)(query) ? { createdAt: (0, pagination_1.dateRangeFilter)(query) } : {}),
        },
        include: paymentAttemptInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...(0, pagination_1.paginationArgs)(query),
    });
    const page = (0, pagination_1.paginateResults)(attempts, query.limit);
    (0, responses_1.sendSuccess)(res, 200, "Payment attempts returned", {
        paymentAttempts: page.data,
        pagination: page.pagination,
    });
}));
exports.paymentAttemptsRouter.get("/:id", (0, validate_middleware_1.validate)({ params: payment_attempts_schema_1.paymentAttemptIdParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const mode = (0, errors_1.requireBusinessMode)(req);
    const paymentAttempt = await prisma_1.prisma.paymentAttempt.findFirst({
        where: {
            id: String(req.params.id),
            businessId: business.id,
            mode: mode,
        },
        include: paymentAttemptInclude,
    });
    if (!paymentAttempt) {
        throw new errors_1.ApiError(404, "Payment attempt not found");
    }
    (0, responses_1.sendSuccess)(res, 200, "Payment attempt returned", { paymentAttempt });
}));
