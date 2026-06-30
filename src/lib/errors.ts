export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
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
