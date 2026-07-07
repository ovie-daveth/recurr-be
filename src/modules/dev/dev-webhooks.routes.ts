import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { Prisma } from "../../generated/prisma/client";
import { asyncHandler } from "../../lib/async-handler";
import { prisma } from "../../lib/prisma";
import { sendSuccess } from "../../lib/responses";
import { merchantSessionMiddleware } from "../../middlewares/merchant-session.middleware";
import { validate } from "../../middlewares/validate.middleware";
import { processNombaWebhookEvent } from "../webhooks/nomba-webhook.processor";
import { simulateNombaWebhookSchema } from "./dev-webhooks.schema";

export const devWebhooksRouter = Router();

function webhookSecret() {
  return (
    process.env.NOMBA_WEBHOOK_SECRET ||
    process.env.NOMBA_WEBHOOK_SIGNING_KEY ||
    "NombaHackathon2026"
  );
}

async function requireMerchantSession(
  req: Request,
  res: Response,
  next: NextFunction
) {
  await merchantSessionMiddleware(req, res, next);
}

function getNombaWebhookMode() {
  return process.env.NOMBA_WEBHOOK_MODE === "LIVE" ? "LIVE" : "TEST";
}

function signNombaCanonicalPayload(payload: {
  event_type: string;
  requestId: string;
  data: {
    merchant: { userId: string; walletId: string };
    transaction: {
      transactionId: string;
      type: string;
      time: string;
      responseCode?: string;
    };
  };
}, timestamp: string) {
  const canonical = [
    payload.event_type,
    payload.requestId,
    payload.data.merchant.userId,
    payload.data.merchant.walletId,
    payload.data.transaction.transactionId,
    payload.data.transaction.type,
    payload.data.transaction.time,
    payload.data.transaction.responseCode ?? "",
    timestamp,
  ].join(":");

  return crypto
    .createHmac("sha256", webhookSecret())
    .update(canonical)
    .digest("base64");
}

devWebhooksRouter.post(
  "/nomba/simulate",
  requireMerchantSession,
  validate({ body: simulateNombaWebhookSchema }),
  asyncHandler(async (req, res) => {
    const input = req.body as typeof simulateNombaWebhookSchema._output;
    const requestId = input.requestId ?? crypto.randomUUID();
    const orderReference =
      input.orderReference ??
      input.merchantTxRef?.replace(/^recur_attempt_/, "ord_") ??
      crypto.randomUUID();
    const transactionId =
      input.transactionId ?? `WEB-ONLINE_C-dev-${crypto.randomUUID()}`;
    const majorAmount = input.amountMinor / 100;
    const eventType = input.eventType;
    const mode = input.mode ?? getNombaWebhookMode();
    const now = new Date();
    const transactionTime = now.toISOString();
    const timestamp = Math.floor(now.getTime() / 1000).toString();
    const nombaCustomerId =
      input.nombaCustomerId ?? `cus_${crypto.randomUUID().replace(/-/g, "")}`;
    const tokenKey =
      input.tokenKey ?? input.cardId ?? `tok_${crypto.randomUUID().replace(/-/g, "")}`;

    const payload = {
      event_type: eventType,
      requestId,
      data: {
        amount: input.amountMinor,
        currency: input.currency,
        merchant: {
          userId: process.env.NOMBA_ACCOUNT_ID || "dev-account",
          walletId: process.env.NOMBA_WALLET_ID || process.env.NOMBA_ACCOUNT_ID || "dev-wallet",
        },
        transaction: {
          fee: 0,
          type: "online_checkout",
          transactionId,
          merchantTxRef: input.merchantTxRef,
          transactionAmount: majorAmount,
          responseCode: eventType === "payment_success" ? "00" : "99",
          time: transactionTime,
        },
        order: {
          amount: majorAmount,
          orderId: crypto.randomUUID(),
          accountId: process.env.NOMBA_ACCOUNT_ID || "dev-account",
          customerId: nombaCustomerId,
          customerEmail: input.customerEmail ?? "dev@example.com",
          orderReference,
          paymentMethod: "card_payment",
          currency: input.currency,
        },
        paymentMethod: {
          tokenKey,
          cardId: tokenKey,
          customerId: nombaCustomerId,
          brand: input.cardBrand ?? "visa",
          last4: input.cardLast4 ?? "6666",
        },
      },
    };

    const rawBody = JSON.stringify(payload);
    const signature = signNombaCanonicalPayload(payload, timestamp);
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
          "nomba-timestamp": timestamp,
          "x-dev-simulated": "true",
        },
        signature,
        providerSentAt: now,
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
          "nomba-timestamp": timestamp,
        },
        body: payload,
      },
    });
  })
);
