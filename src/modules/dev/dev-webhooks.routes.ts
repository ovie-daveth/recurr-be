import crypto from "crypto";
import { Router } from "express";
import { Prisma } from "../../generated/prisma/client";
import { asyncHandler } from "../../lib/async-handler";
import { ApiError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { sendSuccess } from "../../lib/responses";
import { validate } from "../../middlewares/validate.middleware";
import { processNombaWebhookEvent } from "../webhooks/nomba-webhook.processor";
import { simulateNombaWebhookSchema } from "./dev-webhooks.schema";

export const devWebhooksRouter = Router();

devWebhooksRouter.use((req, _res, next) => {
  if (process.env.NODE_ENV === "production") {
    next(new ApiError(404, "Not found"));
    return;
  }

  next();
});

function webhookSecret() {
  return (
    process.env.NOMBA_WEBHOOK_SECRET ||
    process.env.NOMBA_WEBHOOK_SIGNING_KEY ||
    "NombaHackathon2026"
  );
}

function signRawBody(rawBody: string) {
  return crypto.createHmac("sha256", webhookSecret()).update(rawBody).digest("hex");
}

function getNombaWebhookMode() {
  return process.env.NOMBA_WEBHOOK_MODE === "LIVE" ? "LIVE" : "TEST";
}

devWebhooksRouter.post(
  "/nomba/simulate",
  validate({ body: simulateNombaWebhookSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as typeof simulateNombaWebhookSchema._output;
    const requestId = input.requestId ?? crypto.randomUUID();
    const orderReference =
      input.orderReference ?? input.merchantTxRef.replace(/^recur_attempt_/, "ord_");
    const transactionId =
      input.transactionId ?? `WEB-ONLINE_C-dev-${crypto.randomUUID()}`;
    const majorAmount = input.amountMinor / 100;
    const eventType = input.eventType;
    const mode = input.mode ?? getNombaWebhookMode();

    const payload = {
      event_type: eventType,
      requestId,
      data: {
        merchant: {
          userId: process.env.NOMBA_ACCOUNT_ID || "dev-account",
        },
        transaction: {
          fee: 0,
          type: "online_checkout",
          transactionId,
          merchantTxRef: input.merchantTxRef,
          transactionAmount: majorAmount,
          time: new Date().toISOString(),
        },
        order: {
          amount: majorAmount,
          orderId: crypto.randomUUID(),
          accountId: process.env.NOMBA_ACCOUNT_ID || "dev-account",
          customerEmail: input.customerEmail ?? "dev@example.com",
          orderReference,
          paymentMethod: "card_payment",
          currency: input.currency,
        },
      },
    };

    const rawBody = JSON.stringify(payload);
    const signature = signRawBody(rawBody);
    const rawBodyHash = crypto.createHash("sha256").update(rawBody).digest("hex");

    const event = await prisma.webhookEvent.create({
      data: {
        provider: "nomba",
        mode,
        providerEventId: requestId,
        eventType,
        rawBody,
        rawBodyHash,
        payload: payload as Prisma.InputJsonValue,
        headers: {
          "nomba-signature": signature,
          "nomba-signature-algorithm": "HmacSHA256",
          "nomba-timestamp": new Date().toISOString(),
          "x-dev-simulated": "true",
        },
        signature,
        providerSentAt: new Date(),
        status: "RECEIVED",
      },
    });

    await processNombaWebhookEvent({
      eventId: event.id,
      mode,
      eventType,
      payload,
      skipTransactionVerification: input.skipTransactionVerification,
    });

    const processedEvent = await prisma.webhookEvent.findUnique({
      where: { id: event.id },
    });

    sendSuccess(res, 201, "Nomba webhook simulated", {
      event: processedEvent,
      signedRequest: {
        url: "/api/v1/webhooks/nomba",
        headers: {
          "Content-Type": "application/json",
          "nomba-signature": signature,
          "nomba-signature-algorithm": "HmacSHA256",
        },
        body: payload,
      },
    });
  })
);
