import crypto from "crypto";

type MerchantSessionPayload = {
  sub: string;
  sid: string;
  exp: number;
  typ: "merchant_access";
};

const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 60 * 15;
const DEFAULT_REFRESH_TOKEN_TTL_DAYS = 30;

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getMerchantAccessTokenTtlSeconds() {
  return parsePositiveInt(
    process.env.MERCHANT_ACCESS_TOKEN_TTL_SECONDS,
    DEFAULT_ACCESS_TOKEN_TTL_SECONDS
  );
}

export function getMerchantRefreshTokenTtlDays() {
  return parsePositiveInt(
    process.env.MERCHANT_REFRESH_TOKEN_TTL_DAYS,
    DEFAULT_REFRESH_TOKEN_TTL_DAYS
  );
}

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
  sessionId: string;
}) {
  const header = { alg: "HS256", typ: "JWT" };
  const payload: MerchantSessionPayload = {
    sub: input.userId,
    sid: input.sessionId,
    exp: Math.floor(Date.now() / 1000) + getMerchantAccessTokenTtlSeconds(),
    typ: "merchant_access",
  };
  const unsignedToken = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = crypto
    .createHmac("sha256", getSessionSecret())
    .update(unsignedToken)
    .digest("base64url");

  return `${unsignedToken}.${signature}`;
}

export function generateMerchantRefreshToken() {
  return `mrt_${crypto.randomBytes(48).toString("base64url")}`;
}

export function hashMerchantRefreshToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function getMerchantRefreshTokenExpiryDate() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + getMerchantRefreshTokenTtlDays());
  return expiresAt;
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

  if (!payload.sub || !payload.sid || payload.typ !== "merchant_access") {
    throw new Error("Invalid session token");
  }

  return payload;
}
