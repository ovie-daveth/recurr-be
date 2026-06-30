export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown,
    public readonly code: string = statusCodeToErrorCode(statusCode)
  ) {
    super(message);
  }
}

function statusCodeToErrorCode(statusCode: number) {
  switch (statusCode) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 422:
      return "UNPROCESSABLE_ENTITY";
    case 429:
      return "RATE_LIMITED";
    default:
      return statusCode >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_FAILED";
  }
}

export function requireBusiness(req: Express.Request) {
  if (!req.business) {
    throw new ApiError(401, "Business context is required");
  }

  return req.business;
}

export function requireMerchantUser(req: Express.Request) {
  if (!req.merchantUser) {
    throw new ApiError(401, "Merchant user context is required");
  }

  return req.merchantUser;
}

export function requireApiKey(req: Express.Request) {
  if (!req.apiKey) {
    throw new ApiError(401, "API key context is required");
  }

  return req.apiKey;
}
