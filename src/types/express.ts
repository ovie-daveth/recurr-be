import type { ApiKey, Business, MerchantUser } from "../generated/prisma/client";

declare global {
  namespace Express {
    interface Request {
      business?: Business;
      apiKey?: ApiKey;
      merchantUser?: MerchantUser;
    }
  }
}

export {};
