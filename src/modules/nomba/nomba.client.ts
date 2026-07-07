import { ApiError } from "../../lib/errors";
import type { ApiKeyMode } from "../../generated/prisma/client";

type NombaToken = {
  accessToken: string;
  expiresAt: number;
};

type NombaRequestOptions = {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  authenticated?: boolean;
  mode?: ApiKeyMode;
  idempotencyKey?: string;
};

const cachedTokens = new Map<ApiKeyMode, NombaToken>();

function shouldDebugNomba() {
  return process.env.NOMBA_DEBUG === "true";
}

function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const sensitiveKeys = new Set([
    "authorization",
    "access_token",
    "accessToken",
    "refresh_token",
    "refreshToken",
    "token",
    "client_secret",
    "clientSecret",
    "secret",
    "signature",
  ]);

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => [
      key,
      sensitiveKeys.has(key) || sensitiveKeys.has(key.toLowerCase())
        ? "[REDACTED]"
        : redactSensitive(entryValue),
    ])
  );
}

function logNombaDebug(label: string, data: Record<string, unknown>) {
  if (!shouldDebugNomba()) {
    return;
  }

  console.log(`[NOMBA_DEBUG] ${label}`, JSON.stringify(redactSensitive(data), null, 2));
}

function envForMode(mode: ApiKeyMode, key: string) {
  if (mode === "TEST") {
    return process.env[`NOMBA_TEST_${key}`] || process.env[`NOMBA_${key}`];
  }

  return process.env[`NOMBA_LIVE_${key}`] || process.env[`NOMBA_${key}`];
}

function defaultMode(): ApiKeyMode {
  return process.env.NOMBA_ENVIRONMENT === "LIVE" || process.env.NOMBA_MODE === "LIVE"
    ? "LIVE"
    : "TEST";
}

function nombaBaseUrl(mode: ApiKeyMode) {
  return (envForMode(mode, "BASE_URL") || "https://sandbox.nomba.com/v1").replace(
    /\/+$/,
    ""
  );
}

function apiPath(path: string, mode: ApiKeyMode) {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const base = nombaBaseUrl(mode);

  if (
    base.endsWith("/v1") ||
    cleanPath.startsWith("/v1/") ||
    cleanPath.startsWith("/sandbox/")
  ) {
    return cleanPath;
  }

  return `/v1${cleanPath}`;
}

function buildUrl(path: string, mode: ApiKeyMode) {
  return `${nombaBaseUrl(mode)}${apiPath(path, mode)}`;
}

function requiredNombaEnv(mode: ApiKeyMode, key: string) {
  const value = envForMode(mode, key);
  if (!value) {
    const envName = mode === "TEST" ? `NOMBA_TEST_${key}` : `NOMBA_${key}`;
    throw new ApiError(
      500,
      `${envName} is required for ${mode} Nomba API calls`,
      [{ env: envName, mode }],
      "NOMBA_CONFIGURATION_REQUIRED"
    );
  }

  return value;
}

function extractAccessToken(payload: unknown) {
  const data =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>).data
      : undefined;
  const record =
    data && typeof data === "object"
      ? (data as Record<string, unknown>)
      : (payload as Record<string, unknown> | undefined);

  const token = record?.access_token ?? record?.accessToken ?? record?.token;
  if (typeof token !== "string" || !token.trim()) {
    return undefined;
  }

  return token.trim();
}

function extractExpiresInSeconds(payload: unknown) {
  const data =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>).data
      : undefined;
  const record =
    data && typeof data === "object"
      ? (data as Record<string, unknown>)
      : (payload as Record<string, unknown> | undefined);

  const expiresIn = record?.expires_in ?? record?.expiresIn;
  if (typeof expiresIn === "number" && Number.isFinite(expiresIn)) {
    return expiresIn;
  }

  const expiresAt = record?.expiresAt ?? record?.expires_at;
  if (typeof expiresAt === "string") {
    const expiresAtMs = Date.parse(expiresAt);
    if (Number.isFinite(expiresAtMs)) {
      return Math.max(1, Math.floor((expiresAtMs - Date.now()) / 1000));
    }
  }

  return 3600;
}

async function parseNombaResponse(response: Response) {
  const text = await response.text();

  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export class NombaClient {
  async issueToken(mode: ApiKeyMode = defaultMode()) {
    const accountId = requiredNombaEnv(mode, "ACCOUNT_ID");
    const payload = {
      grant_type: "client_credentials",
      client_id: requiredNombaEnv(mode, "CLIENT_ID"),
      client_secret: requiredNombaEnv(mode, "CLIENT_SECRET"),
    };
    const tokenIssuePath = process.env.NOMBA_TOKEN_ISSUE_PATH || "/auth/token/issue";

    const response = await fetch(
      buildUrl(tokenIssuePath, mode),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          accountId,
        },
        body: JSON.stringify(payload),
      }
    );
    const body = await parseNombaResponse(response);
    logNombaDebug("token.issue", {
      mode,
      method: "POST",
      url: buildUrl(tokenIssuePath, mode),
      requestBody: payload,
      responseStatus: response.status,
      responseBody: body,
    });

    if (!response.ok) {
      throw new ApiError(
        502,
        "Nomba token issue request failed",
        [{ status: response.status, body }],
        "NOMBA_TOKEN_REQUEST_FAILED"
      );
    }

    const accessToken = extractAccessToken(body);
    if (!accessToken) {
      throw new ApiError(
        502,
        "Nomba token response did not include an access token",
        [{ body }],
        "NOMBA_TOKEN_RESPONSE_INVALID"
      );
    }

    const expiresInSeconds = extractExpiresInSeconds(body);
    const cachedToken = {
      accessToken,
      expiresAt: Date.now() + expiresInSeconds * 1000,
    };
    cachedTokens.set(mode, cachedToken);

    return cachedToken;
  }

  async getAccessToken(mode: ApiKeyMode = defaultMode()) {
    const refreshWindowMs = Number(
      process.env.NOMBA_TOKEN_REFRESH_WINDOW_MS || 5 * 60 * 1000
    );
    const cachedToken = cachedTokens.get(mode);

    if (cachedToken && cachedToken.expiresAt - Date.now() > refreshWindowMs) {
      return cachedToken.accessToken;
    }

    const token = await this.issueToken(mode);
    return token.accessToken;
  }

  async request<T = unknown>(path: string, options: NombaRequestOptions = {}) {
    const mode = options.mode ?? defaultMode();
    const accountId = requiredNombaEnv(mode, "ACCOUNT_ID");
    const authenticated = options.authenticated ?? true;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      accountId,
    };

    if (authenticated) {
      headers.Authorization = `Bearer ${await this.getAccessToken(mode)}`;
    }

    if (options.idempotencyKey?.trim()) {
      headers["X-Idempotent-key"] = options.idempotencyKey.trim();
    }

    const url = buildUrl(path, mode);
    logNombaDebug("request", {
      mode,
      method: options.method ?? "GET",
      url,
      requestBody: options.body,
      authenticated,
      idempotencyKey: options.idempotencyKey,
    });

    const response = await fetch(url, {
      method: options.method ?? "GET",
      headers,
      ...(typeof options.body === "undefined"
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
    const body = await parseNombaResponse(response);
    logNombaDebug("response", {
      mode,
      method: options.method ?? "GET",
      url,
      responseStatus: response.status,
      responseBody: body,
    });

    if (!response.ok) {
      throw new ApiError(
        502,
        "Nomba API request failed",
        [{ path, status: response.status, body }],
        "NOMBA_API_REQUEST_FAILED"
      );
    }

    return body as T;
  }
}

export const nombaClient = new NombaClient();
