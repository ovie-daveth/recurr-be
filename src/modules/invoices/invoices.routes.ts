import { Router } from "express";
import { asyncHandler } from "../../lib/async-handler";
import { ApiError, requireApiKey, requireBusiness } from "../../lib/errors";
import {
  dateRangeFilter,
  paginateResults,
  paginationArgs,
} from "../../lib/pagination";
import { prisma } from "../../lib/prisma";
import { sendSuccess } from "../../lib/responses";
import { businessApiKeyMiddleware } from "../../middlewares/business-api-key.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { invoiceIdParamsSchema, listInvoicesQuerySchema } from "./invoices.schema";

export const invoicesRouter = Router();

invoicesRouter.use(businessApiKeyMiddleware);

invoicesRouter.get(
  "/",
  validate({ query: listInvoicesQuerySchema }),
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const apiKey = requireApiKey(req);
    const query = req.validatedQuery as typeof listInvoicesQuerySchema._output;

    const invoices = await prisma.invoice.findMany({
      where: {
        businessId: business.id,
        mode: apiKey.mode,
        ...(query.status ? { status: query.status } : {}),
        ...(query.subscriptionId ? { subscriptionId: query.subscriptionId } : {}),
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(dateRangeFilter(query) ? { createdAt: dateRangeFilter(query) } : {}),
      },
      include: {
        customer: true,
        subscription: true,
        items: true,
        attempts: true,
        dunningAttempts: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...paginationArgs(query),
    });
    const page = paginateResults(invoices, query.limit);

    sendSuccess(res, 200, "Invoices returned", {
      invoices: page.data,
      pagination: page.pagination,
    });
  })
);

invoicesRouter.get(
  "/:id",
  validate({ params: invoiceIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const apiKey = requireApiKey(req);

    const invoice = await prisma.invoice.findFirst({
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
      throw new ApiError(404, "Invoice not found");
    }

    sendSuccess(res, 200, "Invoice returned", { invoice });
  })
);
