import crypto from "crypto";
import { Router } from "express";
import { Prisma } from "../../generated/prisma/client";
import { asyncHandler } from "../../lib/async-handler";
import { writeAuditLog } from "../../lib/audit";
import { ApiError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { sendSuccess } from "../../lib/responses";
import { validate } from "../../middlewares/validate.middleware";
import { paymentProvider } from "../nomba/nomba.service";
import { emitMerchantWebhook } from "../webhook-endpoints/merchant-webhooks.service";
import {
  publicSubscribeParamsSchema,
  publicSubscribeQuerySchema,
  startPublicSubscriptionSchema,
} from "./public-subscriptions.schema";

export const publicSubscriptionsRouter = Router();

publicSubscriptionsRouter.get(
  "/subscribe/:businessSlug/:planCode",
  validate({ params: publicSubscribeParamsSchema, query: publicSubscribeQuerySchema }),
  asyncHandler(async (req, res) => {
    const { businessSlug, planCode } =
      req.params as typeof publicSubscribeParamsSchema._output;
    const { mode } = req.validatedQuery as typeof publicSubscribeQuerySchema._output;

    const plan = await prisma.plan.findFirst({
      where: {
        code: planCode,
        mode,
        status: "ACTIVE",
        business: {
          slug: businessSlug,
          status: "ACTIVE",
        },
      },
      include: {
        business: {
          select: {
            id: true,
            slug: true,
            name: true,
            website: true,
            country: true,
          },
        },
      },
    });

    if (!plan) {
      throw new ApiError(404, "Subscription page not found");
    }

    sendSuccess(res, 200, "Subscription page returned", {
      business: plan.business,
      plan,
    });
  })
);

publicSubscriptionsRouter.post(
  "/subscribe/:businessSlug/:planCode/start",
  validate({
    params: publicSubscribeParamsSchema,
    body: startPublicSubscriptionSchema,
  }),
  asyncHandler(async (req, res) => {
    const { businessSlug, planCode } =
      req.params as typeof publicSubscribeParamsSchema._output;
    const mode = req.body.mode;

    const plan = await prisma.plan.findFirst({
      where: {
        code: planCode,
        mode,
        status: "ACTIVE",
        business: {
          slug: businessSlug,
          status: "ACTIVE",
        },
      },
      include: { business: true },
    });

    if (!plan) {
      throw new ApiError(404, "Subscription page not found");
    }

    const customer = await prisma.customer.upsert({
      where: {
        businessId_mode_email: {
          businessId: plan.businessId,
          mode,
          email: req.body.email,
        },
      },
      create: {
        businessId: plan.businessId,
        mode,
        email: req.body.email,
        name: req.body.name,
        phone: req.body.phone,
        externalReference: req.body.externalReference,
        metadata: {
          ...(req.body.metadata ?? {}),
          source: "hosted_subscription_page",
        } as Prisma.InputJsonValue,
      },
      update: {
        status: "ACTIVE",
        ...(req.body.name ? { name: req.body.name } : {}),
        ...(req.body.phone ? { phone: req.body.phone } : {}),
        ...(req.body.externalReference
          ? { externalReference: req.body.externalReference }
          : {}),
      },
    });

    const duplicate = await prisma.subscription.findFirst({
      where: {
        businessId: plan.businessId,
        mode,
        customerId: customer.id,
        planId: plan.id,
        status: {
          in: ["INCOMPLETE", "TRIALING", "ACTIVE", "PAST_DUE", "PAUSED"],
        },
      },
    });

    if (duplicate) {
      throw new ApiError(
        409,
        "Customer already has an open subscription for this plan",
        [{ subscriptionId: duplicate.id }],
        "DUPLICATE_SUBSCRIPTION"
      );
    }

    const requestedSetupReference = `hosted_sub_${crypto
      .randomUUID()
      .replace(/-/g, "")}`;
    const checkout = await paymentProvider.createCheckoutOrder({
      businessId: plan.businessId,
      mode,
      customerId: customer.id,
      customerEmail: customer.email,
      customerName: customer.name,
      reference: requestedSetupReference,
      amountMinor: plan.amountMinor,
      currency: plan.currency,
      callbackUrl: req.body.callbackUrl,
      metadata: {
        ...(req.body.metadata ?? {}),
        source: "hosted_subscription_page",
        hostedSubscriptionPlanId: plan.id,
        hostedSubscriptionPlanCode: plan.code,
        hostedSubscriptionCustomerId: customer.id,
        hostedSubscriptionBusinessSlug: businessSlug,
      },
    });

    const paymentMethod = await prisma.paymentMethod.create({
      data: {
        businessId: plan.businessId,
        mode,
        customerId: customer.id,
        provider: "NOMBA",
        type: "UNKNOWN",
        status: "PENDING_SETUP",
        providerSetupReference: checkout.reference,
        metadata: {
          ...(req.body.metadata ?? {}),
          source: "hosted_subscription_page",
          requestedSetupReference,
          hostedSubscriptionPlanId: plan.id,
          hostedSubscriptionPlanCode: plan.code,
          hostedSubscriptionInitialAmountMinor: plan.amountMinor,
          checkoutRaw: checkout.raw,
        } as Prisma.InputJsonValue,
      },
    });

    await writeAuditLog({
      businessId: plan.businessId,
      action: "hosted_subscription.started",
      entity: "payment_method",
      entityId: paymentMethod.id,
      metadata: { customerId: customer.id, planId: plan.id, mode },
    });

    void emitMerchantWebhook({
      businessId: plan.businessId,
      type: "payment_method.updated",
      data: { paymentMethod, customer, plan },
    }).catch((error) => {
      console.error("Failed to emit payment_method.updated webhook", error);
    });

    sendSuccess(res, 201, "Subscription checkout created", {
      business: {
        id: plan.business.id,
        slug: plan.business.slug,
        name: plan.business.name,
      },
      customer,
      plan,
      paymentMethod,
      checkout: {
        provider: checkout.provider,
        reference: checkout.reference,
        checkoutUrl: checkout.checkoutUrl,
      },
    });
  })
);
