import type { ApiKey, Tenant } from "../generated/prisma/client";

declare global {
  namespace Express {
    interface Request {
      tenant?: Tenant;
      apiKey?: ApiKey;
    }
  }
}

export {};
