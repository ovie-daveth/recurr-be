import type {
  ApiKey,
  Business,
  MerchantSession,
  MerchantUser,
} from "../generated/prisma/client";

declare global {
  namespace Express {
    interface Request {
      business?: Business;
      apiKey?: ApiKey;
      merchantUser?: MerchantUser;
      merchantSession?: MerchantSession;
      requestId?: string;
      validatedQuery?: unknown;
    }
  }
}

export {};
