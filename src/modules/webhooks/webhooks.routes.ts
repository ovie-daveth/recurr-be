import crypto from "crypto";
import { Router } from "express";
import { Prisma } from "../../generated/prisma/client";
import { asyncHandler } from "../../lib/async-handler";
import { ApiError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { sendSuccess } from "../../lib/responses";
import { processNombaWebhookEvent } from "./nomba-webhook.processor";
import { verifyNombaWebhookSignature } from "./nomba-webhook.security";

export const webhooksRouter = Router();

function rawBodyToString(rawBody: Buffer) {
  return rawBody.toString("utf8");
}

function hashRawBody(rawBody: Buffer) {
  return crypto.createHash("sha256").update(rawBody).digest("hex");
}

function sanitizeHeaders(headers: Record<string, unknown>) {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === "authorization") {
      continue;
    }

    if (typeof value === "undefined") {
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}

function getStringProperty(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const property = record[key];
    if (typeof property === "string" && property.trim()) {
      return property.trim();
    }
  }

  return undefined;
}

function getProviderEventIdHeader(headers: Record<string, unknown>) {
  const headerName =
    process.env.NOMBA_WEBHOOK_EVENT_ID_HEADER || "x-nomba-event-id";
  const value = headers[headerName.toLowerCase()];

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (Array.isArray(value) && typeof value[0] === "string" && value[0].trim()) {
    return value[0].trim();
  }

  return undefined;
}

function extractNombaEventBasics(payload: unknown) {
  const requestId = getStringProperty(payload, ["requestId"]);
  const eventType = getStringProperty(payload, ["event", "event_type"]);

  if (!requestId) {
    throw new ApiError(
      400,
      "Nomba webhook payload must include requestId",
      [],
      "NOMBA_WEBHOOK_REQUEST_ID_REQUIRED"
    );
  }

  if (!eventType) {
    throw new ApiError(
      400,
      "Nomba webhook payload must include event or event_type",
      [],
      "NOMBA_WEBHOOK_EVENT_REQUIRED"
    );
  }

  return { requestId, eventType };
}

function getNombaWebhookMode() {
  return process.env.NOMBA_WEBHOOK_MODE === "LIVE" ? "LIVE" : "TEST";
}

function shouldDebugNomba() {
  return process.env.NOMBA_DEBUG === "true";
}

function logNombaWebhookDebug(data: Record<string, unknown>) {
  if (!shouldDebugNomba()) {
    return;
  }

  console.log("[NOMBA_DEBUG] webhook.received", JSON.stringify(data, null, 2));
}

webhooksRouter.post(
  "/nomba",
  asyncHandler(async (req, res) => {
    if (!Buffer.isBuffer(req.body)) {
      throw new ApiError(400, "Webhook raw body is required", [], "WEBHOOK_RAW_BODY_REQUIRED");
    }

    const verification = verifyNombaWebhookSignature(req);
    const rawBody = req.body;
    const rawBodyHash = hashRawBody(rawBody);
    const rawBodyText = rawBodyToString(rawBody);

    let payload: unknown;
    try {
      payload = JSON.parse(rawBodyText);
    } catch {
      throw new ApiError(400, "Webhook payload must be valid JSON", [], "INVALID_WEBHOOK_JSON");
    }

    const nombaEvent = extractNombaEventBasics(payload);
    const providerEventId =
      getProviderEventIdHeader(req.headers) ?? nombaEvent.requestId;
    const eventType = nombaEvent.eventType;

    const mode = getNombaWebhookMode();
    logNombaWebhookDebug({
      mode,
      providerEventId,
      eventType,
      rawBodyHash,
      payload,
    });

    try {
      const event = await prisma.webhookEvent.create({
        data: {
          provider: "nomba",
          mode,
          providerEventId,
          eventType,
          rawBody: rawBodyText,
          rawBodyHash,
          payload: payload as Prisma.InputJsonValue,
          headers: sanitizeHeaders(req.headers) as Prisma.InputJsonValue,
          signature: verification.signature,
          providerSentAt: verification.timestamp,
          status: "RECEIVED",
        },
      });

      await processNombaWebhookEvent({
        eventId: event.id,
        mode,
        eventType,
        payload,
      });

      sendSuccess(res, 200, "Webhook accepted", {
        received: true,
        duplicate: false,
        eventId: event.id,
        providerEventId: event.providerEventId,
        eventType: event.eventType,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existingEvent = await prisma.webhookEvent.findUnique({
          where: {
            provider_mode_providerEventId: {
              provider: "nomba",
              mode,
              providerEventId,
            },
          },
        });

        sendSuccess(res, 200, "Duplicate webhook ignored", {
          received: true,
          duplicate: true,
          eventId: existingEvent?.id,
          providerEventId,
          eventType: existingEvent?.eventType ?? eventType,
        });
        return;
      }

      throw error;
    }
  })
);
