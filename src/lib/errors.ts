export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export function requireTenant(req: Express.Request) {
  if (!req.tenant) {
    throw new ApiError(401, "Tenant context is required");
  }

  return req.tenant;
}
