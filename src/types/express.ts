import type { Tenant } from "../generated/prisma/client.js";

declare global {
  namespace Express {
    interface Request {
      tenant?: Tenant;
    }
  }
}

export {};
