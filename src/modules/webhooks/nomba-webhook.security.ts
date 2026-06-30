import crypto from "crypto";
import type { Request } from "express";
import { ApiError } from "../../lib/errors";

type VerifiedWebhook = {
  signature: string;
  timestamp?: Date;
};

function getHeader(req: Request, name: string) {
  const value = req.header(name);
  return Array.isArray(value) ? value[0] : value;
}

function getWebhookSecret() {
  const value =
    process.env.NOMBA_WEBHOOK_SECRET || process.env.NOMBA_WEBHOOK_SIGNING_KEY;
  if (!value) {
    throw new ApiError(
      500,
      "NOMBA_WEBHOOK_SECRET is required",
      [],
      "WEBHOOK_CONFIG_ERROR"
    );
  }

  return value;
}

function getToleranceSeconds() {
  const value = Number(process.env.NOMBA_WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS);
  return Number.isInteger(value) && value > 0 ? value : 300;
}

function parseWebhookTimestamp(value: string) {
  if (/^\d+$/.test(value)) {
    const numeric = Number(value);
    const milliseconds = value.length >= 13 ? numeric : numeric * 1000;
    return new Date(milliseconds);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ApiError(401, "Invalid webhook timestamp", [], "INVALID_WEBHOOK_TIMESTAMP");
  }

  return parsed;
}

function normalizeSignature(value: string) {
  const trimmed = value.trim();
  const parts = trimmed.split(",");
  const preferredPart = parts.find((part) => part.startsWith("v1=")) ?? parts[0];
  const signature = preferredPart.includes("=")
    ? preferredPart.slice(preferredPart.indexOf("=") + 1)
    : preferredPart;

  return signature.trim();
}

function timingSafeStringEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function createSignatures(secret: string, timestamp: string, rawBody: Buffer) {
  const payloads = [
    rawBody,
    Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]),
    Buffer.concat([Buffer.from(timestamp), rawBody]),
  ];

  return payloads.flatMap((payload) => {
    const digest = crypto.createHmac("sha256", secret).update(payload).digest();
    return [digest.toString("hex"), digest.toString("base64")];
  });
}

export function verifyNombaWebhookSignature(req: Request): VerifiedWebhook {
  const rawBody = req.body;
  if (!Buffer.isBuffer(rawBody)) {
    throw new ApiError(400, "Webhook raw body is required", [], "WEBHOOK_RAW_BODY_REQUIRED");
  }

  const signatureHeader =
    process.env.NOMBA_WEBHOOK_SIGNATURE_HEADER || "nomba-signature";
  const timestampHeader =
    process.env.NOMBA_WEBHOOK_TIMESTAMP_HEADER || "x-nomba-timestamp";
  const signature = getHeader(req, signatureHeader);
  const timestamp = getHeader(req, timestampHeader);

  if (!signature) {
    throw new ApiError(401, "Missing webhook signature", [], "MISSING_WEBHOOK_SIGNATURE");
  }

  if (process.env.NOMBA_WEBHOOK_REQUIRE_TIMESTAMP === "true" && !timestamp) {
    throw new ApiError(401, "Missing webhook timestamp", [], "MISSING_WEBHOOK_TIMESTAMP");
  }

  let timestampDate: Date | undefined;
  if (timestamp) {
    timestampDate = parseWebhookTimestamp(timestamp);
    const ageSeconds = Math.abs(Date.now() - timestampDate.getTime()) / 1000;
    if (ageSeconds > getToleranceSeconds()) {
      throw new ApiError(401, "Webhook timestamp is outside tolerance", [], "WEBHOOK_TIMESTAMP_EXPIRED");
    }
  }

  const secret = getWebhookSecret();
  const receivedSignature = normalizeSignature(signature);
  const expectedSignatures = timestamp
    ? createSignatures(secret, timestamp, rawBody)
    : [
        crypto.createHmac("sha256", secret).update(rawBody).digest("hex"),
        crypto.createHmac("sha256", secret).update(rawBody).digest("base64"),
      ];
  const signatureIsValid = expectedSignatures.some((expected) =>
    timingSafeStringEqual(expected, receivedSignature)
  );

  if (!signatureIsValid) {
    throw new ApiError(401, "Invalid webhook signature", [], "INVALID_WEBHOOK_SIGNATURE");
  }

  return {
    signature: receivedSignature,
    timestamp: timestampDate,
  };
}
