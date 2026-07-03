import crypto from "crypto";
import { Router } from "express";
import { Prisma } from "../../generated/prisma/client";
import { asyncHandler } from "../../lib/async-handler";
import { writeAuditLog } from "../../lib/audit";
import { ApiError, requireApiKey, requireBusiness } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { sendSuccess } from "../../lib/responses";
import { businessApiKeyMiddleware } from "../../middlewares/business-api-key.middleware";
import { idempotencyMiddleware } from "../../middlewares/idempotency.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { paymentProvider } from "../nomba/nomba.service";
import {
  listPaymentMethodsQuerySchema,
  paymentMethodParamsSchema,
  setupPaymentMethodCheckoutSchema,
  setupPaymentMethodParamsSchema,
} from "./payment-methods.schema";

export const paymentMethodsRouter = Router({ mergeParams: true });

paymentMethodsRouter.use(businessApiKeyMiddleware);

paymentMethodsRouter.get(
  "/:id/payment-methods",
  validate({ params: setupPaymentMethodParamsSchema, query: listPaymentMethodsQuerySchema }),
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const apiKey = requireApiKey(req);
    const customerId = String(req.params.id);
    const query = req.validatedQuery as typeof listPaymentMethodsQuerySchema._output;

    const customer = await prisma.customer.findFirst({
      where: {
        id: customerId,
        businessId: business.id,
        mode: apiKey.mode,
      },
    });

    if (!customer) {
      throw new ApiError(404, "Customer not found");
    }

    const paymentMethods = await prisma.paymentMethod.findMany({
      where: {
        customerId: customer.id,
        businessId: business.id,
        mode: apiKey.mode,
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });

    sendSuccess(res, 200, "Payment methods returned", { paymentMethods });
  })
);

paymentMethodsRouter.post(
  "/:id/payment-methods/setup-checkout",
  validate({
    params: setupPaymentMethodParamsSchema,
    body: setupPaymentMethodCheckoutSchema,
  }),
  idempotencyMiddleware,
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const apiKey = requireApiKey(req);
    const customerId = String(req.params.id);

    const customer = await prisma.customer.findFirst({
      where: {
        id: customerId,
        businessId: business.id,
        mode: apiKey.mode,
      },
    });

    if (!customer) {
      throw new ApiError(404, "Customer not found");
    }

    if (customer.status !== "ACTIVE") {
      throw new ApiError(
        409,
        "Disabled customers cannot set up payment methods",
        [],
        "CUSTOMER_NOT_ACTIVE"
      );
    }

    const reference = `pm_setup_${crypto.randomUUID().replace(/-/g, "")}`;
    const checkout = await paymentProvider.createCheckoutOrder({
      businessId: business.id,
      mode: apiKey.mode,
      customerId: customer.id,
      customerEmail: customer.email,
      customerName: customer.name,
      reference,
      amountMinor: 100,
      currency: "NGN",
      callbackUrl: req.body.callbackUrl,
      metadata: req.body.metadata,
    });

    const paymentMethod = await prisma.paymentMethod.create({
      data: {
        businessId: business.id,
        mode: apiKey.mode,
        customerId: customer.id,
        provider: "NOMBA",
        type: "UNKNOWN",
        status: "PENDING_SETUP",
        providerSetupReference: checkout.reference,
        metadata: {
          ...(req.body.metadata ?? {}),
          requestedSetupReference: reference,
          checkoutRaw: checkout.raw,
        } as Prisma.InputJsonValue,
      },
    });

    await writeAuditLog({
      businessId: business.id,
      action: "payment_method.setup_requested",
      entity: "payment_method",
      entityId: paymentMethod.id,
      metadata: { customerId: customer.id, mode: apiKey.mode },
    });

    sendSuccess(res, 201, "Payment method setup checkout created", {
      paymentMethod,
      checkout: {
        provider: checkout.provider,
        reference: checkout.reference,
        checkoutUrl: checkout.checkoutUrl,
      },
    });
  })
);

paymentMethodsRouter.delete(
  "/:id/payment-methods/:paymentMethodId",
  validate({ params: paymentMethodParamsSchema }),
  asyncHandler(async (req, res) => {
    const business = requireBusiness(req);
    const apiKey = requireApiKey(req);
    const customerId = String(req.params.id);
    const paymentMethodId = String(req.params.paymentMethodId);

    const paymentMethod = await prisma.paymentMethod.findFirst({
      where: {
        id: paymentMethodId,
        customerId,
        businessId: business.id,
        mode: apiKey.mode,
      },
    });

    if (!paymentMethod) {
      throw new ApiError(404, "Payment method not found");
    }

    const openSubscription = await prisma.subscription.findFirst({
      where: {
        businessId: business.id,
        mode: apiKey.mode,
        paymentMethodId: paymentMethod.id,
        status: {
          in: ["INCOMPLETE", "TRIALING", "ACTIVE", "PAST_DUE", "PAUSED"],
        },
      },
    });

    if (openSubscription) {
      throw new ApiError(
        409,
        "Payment method is attached to an open subscription",
        [{ subscriptionId: openSubscription.id }],
        "PAYMENT_METHOD_IN_USE"
      );
    }

    const updatedPaymentMethod = await prisma.paymentMethod.update({
      where: { id: paymentMethod.id },
      data: {
        status: "DISABLED",
        reusable: false,
      },
    });

    await writeAuditLog({
      businessId: business.id,
      action: "payment_method.revoked",
      entity: "payment_method",
      entityId: updatedPaymentMethod.id,
      metadata: { customerId, mode: apiKey.mode },
    });

    sendSuccess(res, 200, "Payment method revoked", {
      paymentMethod: updatedPaymentMethod,
    });
  })
);
