import crypto from "crypto";

export function generateApiKey(mode: "TEST" | "LIVE" = "TEST") {
  const prefix =
    mode === "LIVE"
      ? process.env.LIVE_API_KEY_PREFIX || "sk_live"
      : process.env.API_KEY_PREFIX || "sk_test";
  const secret = crypto.randomBytes(32).toString("base64url");
  const key = `${prefix}_${secret}`;

  return {
    key,
    prefix,
    hash: hashApiKey(key),
  };
}

export function hashApiKey(key: string) {
  return crypto.createHash("sha256").update(key).digest("hex");
}

export function generateVerificationToken() {
  const token = crypto.randomBytes(24).toString("base64url");

  return {
    token,
    hash: hashApiKey(token),
  };
}

export function extractBearerToken(header: string | undefined) {
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }

  return token;
}
