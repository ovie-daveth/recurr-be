import crypto from "crypto";

const DEFAULT_PREFIX = process.env.API_KEY_PREFIX || "sk_test";

export function generateApiKey() {
  const secret = crypto.randomBytes(32).toString("base64url");
  const key = `${DEFAULT_PREFIX}_${secret}`;

  return {
    key,
    prefix: DEFAULT_PREFIX,
    hash: hashApiKey(key),
  };
}

export function hashApiKey(key: string) {
  return crypto.createHash("sha256").update(key).digest("hex");
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
