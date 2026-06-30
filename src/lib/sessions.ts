import crypto from "crypto";

type MerchantSessionPayload = {
  sub: string;
  exp: number;
};

const SESSION_TTL_SECONDS = 60 * 60 * 12;

function getSessionSecret() {
  const secret = process.env.MERCHANT_SESSION_SECRET || process.env.JWT_SECRET;

  if (!secret) {
    throw new Error("MERCHANT_SESSION_SECRET or JWT_SECRET is required");
  }

  return secret;
}

function base64UrlEncode(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlJson(value: unknown) {
  return base64UrlEncode(JSON.stringify(value));
}

export function createMerchantSessionToken(input: {
  userId: string;
}) {
  const header = { alg: "HS256", typ: "JWT" };
  const payload: MerchantSessionPayload = {
    sub: input.userId,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const unsignedToken = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = crypto
    .createHmac("sha256", getSessionSecret())
    .update(unsignedToken)
    .digest("base64url");

  return `${unsignedToken}.${signature}`;
}

export function verifyMerchantSessionToken(token: string): MerchantSessionPayload {
  const [encodedHeader, encodedPayload, signature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !signature) {
    throw new Error("Invalid session token");
  }

  const unsignedToken = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = crypto
    .createHmac("sha256", getSessionSecret())
    .update(unsignedToken)
    .digest("base64url");

  const expectedBuffer = Buffer.from(expectedSignature);
  const actualBuffer = Buffer.from(signature);

  if (
    expectedBuffer.length !== actualBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    throw new Error("Invalid session token");
  }

  const payload = JSON.parse(
    Buffer.from(encodedPayload, "base64url").toString("utf8")
  ) as MerchantSessionPayload;

  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("Session token expired");
  }

  return payload;
}
