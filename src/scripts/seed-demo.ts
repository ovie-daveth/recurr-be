import dotenv from "dotenv";
dotenv.config();

import { generateApiKey } from "../lib/api-keys";
import { hashPassword } from "../lib/passwords";
import { prisma } from "../lib/prisma";
import { generateUniqueBusinessSlug } from "../lib/slug";
import { generateWebhookSigningSecret } from "../modules/webhook-endpoints/merchant-webhooks.service";

const DEMO_EMAIL = process.env.DEMO_MERCHANT_EMAIL || "demo@recurr.test";
const DEMO_PASSWORD = process.env.DEMO_MERCHANT_PASSWORD || "DemoPass123!";
const DEMO_BUSINESS_NAME = process.env.DEMO_BUSINESS_NAME || "Recurr Demo Studio";
const DEMO_PLAN_CODE = process.env.DEMO_PLAN_CODE || "pro_monthly_demo";
const DEMO_CUSTOMER_EMAIL =
  process.env.DEMO_CUSTOMER_EMAIL || "demo-customer@example.com";
const DEMO_CUSTOMER_EXTERNAL_REF =
  process.env.DEMO_CUSTOMER_EXTERNAL_REF || "demo-customer-001";
const DEMO_WEBHOOK_URL = process.env.DEMO_WEBHOOK_URL;

async function seedDemo() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const user = await prisma.merchantUser.upsert({
    where: { email: DEMO_EMAIL },
    update: {
      name: "Recurr Demo Merchant",
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
      verificationTokenHash: null,
    },
    create: {
      email: DEMO_EMAIL,
      name: "Recurr Demo Merchant",
      passwordHash,
      status: "ACTIVE",
      emailVerifiedAt: new Date(),
    },
  });

  const existingBusiness = await prisma.business.findFirst({
    where: {
      ownerUserId: user.id,
      name: DEMO_BUSINESS_NAME,
    },
  });

  const business =
    existingBusiness ??
    (await (async () => {
      const slug = await generateUniqueBusinessSlug(DEMO_BUSINESS_NAME);
      return prisma.business.create({
        data: {
          ownerUserId: user.id,
          type: "BUSINESS",
          slug,
          name: DEMO_BUSINESS_NAME,
          status: "ACTIVE",
          businessName: DEMO_BUSINESS_NAME,
          contactName: user.name,
          contactEmail: user.email,
          contactPhone: "+2348000000000",
          country: "NG",
          members: {
            create: {
              userId: user.id,
              role: "OWNER",
            },
          },
        },
      });
    })());

  await prisma.businessMember.upsert({
    where: {
      businessId_userId: {
        businessId: business.id,
        userId: user.id,
      },
    },
    update: { role: "OWNER" },
    create: {
      businessId: business.id,
      userId: user.id,
      role: "OWNER",
    },
  });

  const existingActiveTestKey = await prisma.apiKey.findFirst({
    where: {
      businessId: business.id,
      mode: "TEST",
      revokedAt: null,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      createdAt: true,
    },
  });

  let apiKeySecret: string | null = null;
  let apiKey = existingActiveTestKey;

  if (!apiKey) {
    const generated = generateApiKey("TEST");
    apiKey = await prisma.apiKey.create({
      data: {
        businessId: business.id,
        name: "Demo TEST key",
        mode: "TEST",
        prefix: generated.prefix,
        keyHash: generated.hash,
      },
      select: {
        id: true,
        name: true,
        prefix: true,
        createdAt: true,
      },
    });
    apiKeySecret = generated.key;
  }

  const plan = await prisma.plan.upsert({
    where: {
      businessId_mode_code: {
        businessId: business.id,
        mode: "TEST",
        code: DEMO_PLAN_CODE,
      },
    },
    update: {
      name: "Pro Monthly Demo",
      amountMinor: 500000,
      currency: "NGN",
      interval: "MONTH",
      intervalCount: 1,
      trialDays: 0,
      status: "ACTIVE",
      metadata: { source: "demo_seed" },
    },
    create: {
      businessId: business.id,
      mode: "TEST",
      name: "Pro Monthly Demo",
      code: DEMO_PLAN_CODE,
      amountMinor: 500000,
      currency: "NGN",
      interval: "MONTH",
      intervalCount: 1,
      trialDays: 0,
      status: "ACTIVE",
      metadata: { source: "demo_seed" },
    },
  });

  const customer = await prisma.customer.upsert({
    where: {
      businessId_mode_email: {
        businessId: business.id,
        mode: "TEST",
        email: DEMO_CUSTOMER_EMAIL,
      },
    },
    update: {
      name: "Demo Customer",
      phone: "08000000000",
      externalReference: DEMO_CUSTOMER_EXTERNAL_REF,
      status: "ACTIVE",
      metadata: { source: "demo_seed" },
    },
    create: {
      businessId: business.id,
      mode: "TEST",
      email: DEMO_CUSTOMER_EMAIL,
      name: "Demo Customer",
      phone: "08000000000",
      externalReference: DEMO_CUSTOMER_EXTERNAL_REF,
      status: "ACTIVE",
      metadata: { source: "demo_seed" },
    },
  });

  let webhookEndpoint = null;
  let webhookSigningSecret: string | null = null;

  if (DEMO_WEBHOOK_URL) {
    webhookEndpoint = await prisma.webhookEndpoint.findFirst({
      where: {
        businessId: business.id,
        url: DEMO_WEBHOOK_URL,
      },
      select: {
        id: true,
        url: true,
        events: true,
        status: true,
      },
    });

    if (!webhookEndpoint) {
      webhookSigningSecret = generateWebhookSigningSecret();
      webhookEndpoint = await prisma.webhookEndpoint.create({
        data: {
          businessId: business.id,
          url: DEMO_WEBHOOK_URL,
          description: "Demo webhook endpoint",
          secret: webhookSigningSecret,
          events: [
            "invoice.payment_succeeded",
            "invoice.payment_failed",
            "subscription.active",
            "subscription.past_due",
            "dunning.retry_scheduled",
          ],
        },
        select: {
          id: true,
          url: true,
          events: true,
          status: true,
        },
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        message: "Demo seed completed",
        merchant: {
          email: DEMO_EMAIL,
          password: DEMO_PASSWORD,
        },
        business: {
          id: business.id,
          name: business.name,
        },
        apiKey: {
          id: apiKey.id,
          prefix: apiKey.prefix,
          secret: apiKeySecret ?? null,
          note: apiKeySecret
            ? "Store this key now. Only its hash is stored."
            : "Existing active TEST API key reused. Secret cannot be shown again.",
        },
        plan: {
          id: plan.id,
          code: plan.code,
          amountMinor: plan.amountMinor,
          currency: plan.currency,
        },
        customer: {
          id: customer.id,
          email: customer.email,
        },
        webhookEndpoint: webhookEndpoint
          ? {
              ...webhookEndpoint,
              signingSecret: webhookSigningSecret,
              note: webhookSigningSecret
                ? "Store this signing secret now."
                : "Existing webhook endpoint reused. Secret cannot be shown again.",
            }
          : null,
      },
      null,
      2
    )
  );
}

seedDemo()
  .catch((error) => {
    console.error("Demo seed failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
