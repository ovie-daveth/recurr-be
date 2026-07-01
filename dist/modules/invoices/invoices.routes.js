"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.invoicesRouter = void 0;
const express_1 = require("express");
const async_handler_1 = require("../../lib/async-handler");
const errors_1 = require("../../lib/errors");
const pagination_1 = require("../../lib/pagination");
const prisma_1 = require("../../lib/prisma");
const responses_1 = require("../../lib/responses");
const business_api_key_middleware_1 = require("../../middlewares/business-api-key.middleware");
const validate_middleware_1 = require("../../middlewares/validate.middleware");
const invoices_schema_1 = require("./invoices.schema");
exports.invoicesRouter = (0, express_1.Router)();
exports.invoicesRouter.use(business_api_key_middleware_1.businessApiKeyMiddleware);
exports.invoicesRouter.get("/", (0, validate_middleware_1.validate)({ query: invoices_schema_1.listInvoicesQuerySchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const apiKey = (0, errors_1.requireApiKey)(req);
    const query = req.validatedQuery;
    const invoices = await prisma_1.prisma.invoice.findMany({
        where: {
            businessId: business.id,
            mode: apiKey.mode,
            ...(query.status ? { status: query.status } : {}),
            ...(query.subscriptionId ? { subscriptionId: query.subscriptionId } : {}),
            ...(query.customerId ? { customerId: query.customerId } : {}),
            ...((0, pagination_1.dateRangeFilter)(query) ? { createdAt: (0, pagination_1.dateRangeFilter)(query) } : {}),
        },
        include: {
            customer: true,
            subscription: true,
            items: true,
            attempts: true,
            dunningAttempts: true,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        ...(0, pagination_1.paginationArgs)(query),
    });
    const page = (0, pagination_1.paginateResults)(invoices, query.limit);
    (0, responses_1.sendSuccess)(res, 200, "Invoices returned", {
        invoices: page.data,
        pagination: page.pagination,
    });
}));
exports.invoicesRouter.get("/:id", (0, validate_middleware_1.validate)({ params: invoices_schema_1.invoiceIdParamsSchema }), (0, async_handler_1.asyncHandler)(async (req, res) => {
    const business = (0, errors_1.requireBusiness)(req);
    const apiKey = (0, errors_1.requireApiKey)(req);
    const invoice = await prisma_1.prisma.invoice.findFirst({
        where: {
            id: String(req.params.id),
            businessId: business.id,
            mode: apiKey.mode,
        },
        include: {
            customer: true,
            subscription: true,
            items: true,
            attempts: true,
            dunningAttempts: true,
        },
    });
    if (!invoice) {
        throw new errors_1.ApiError(404, "Invoice not found");
    }
    (0, responses_1.sendSuccess)(res, 200, "Invoice returned", { invoice });
}));
