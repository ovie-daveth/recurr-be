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
import {
  listPaymentAttemptsQuerySchema,
  paymentAttemptIdParamsSchema,
} from "./payment-attempts.schema";

export const paymentAttemptsRouter = Router();

paymentAttemptsRouter.use(businessApiKeyMiddleware);

const paymentAttemptInclude = {
  invoice: {
    include: {
      items: true,
    },
  },
  subscription: true,
  customer: true,
  paymentMethod: true,
} as const;

paymentAttemptsRouter.get(
  "/",
  validate({ query: listPaymentAttemptsQuerySchema }),
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const apiKey = requireApiKey(req);
    const query =
      req.validatedQuery as typeof listPaymentAttemptsQuerySchema._output;

    const attempts = await prisma.paymentAttempt.findMany({
      where: {
        businessId: business.id,
        mode: apiKey.mode,
        ...(query.status ? { status: query.status } : {}),
        ...(query.invoiceId ? { invoiceId: query.invoiceId } : {}),
        ...(query.subscriptionId ? { subscriptionId: query.subscriptionId } : {}),
        ...(query.customerId ? { customerId: query.customerId } : {}),
        ...(dateRangeFilter(query) ? { createdAt: dateRangeFilter(query) } : {}),
      },
      include: paymentAttemptInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...paginationArgs(query),
    });
    const page = paginateResults(attempts, query.limit);

    sendSuccess(res, 200, "Payment attempts returned", {
      paymentAttempts: page.data,
      pagination: page.pagination,
    });
  })
);

paymentAttemptsRouter.get(
  "/:id",
  validate({ params: paymentAttemptIdParamsSchema }),
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const apiKey = requireApiKey(req);

    const paymentAttempt = await prisma.paymentAttempt.findFirst({
      where: {
        id: String(req.params.id),
        businessId: business.id,
        mode: apiKey.mode,
      },
      include: paymentAttemptInclude,
    });

    if (!paymentAttempt) {
      throw new ApiError(404, "Payment attempt not found");
    }

    sendSuccess(res, 200, "Payment attempt returned", { paymentAttempt });
  })
);
