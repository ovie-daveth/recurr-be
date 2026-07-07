import type {
  ApiKey,
  ApiKeyMode,
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
      businessMode?: ApiKeyMode;
      requestId?: string;
      validatedQuery?: unknown;
    }
  }
}

export {};
