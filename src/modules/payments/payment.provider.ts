import type { ApiKeyMode } from "../../generated/prisma/client";

export type PaymentProviderId = "NOMBA" | "MONNIFY" | "PAYSTACK";

export type CreateCheckoutInput = {
  businessId: string;
  mode: ApiKeyMode;
  customerId: string;
  customerEmail: string;
  customerName?: string | null;
  reference: string;
  amountMinor: number;
  currency: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
};

export type CheckoutResult = {
  provider: PaymentProviderId;
  reference: string;
  checkoutUrl: string;
  raw?: unknown;
};

export type ProviderRoutingInfo = {
  fallbackUsed: boolean;
  preferredProvider: PaymentProviderId;
  selectedProvider: PaymentProviderId;
  unavailableProviders: PaymentProviderId[];
  reason: "PROVIDER_UNAVAILABLE" | null;
};

export type RoutedCheckoutResult = CheckoutResult & {
  routing: ProviderRoutingInfo;
};

export type ChargeTokenizedCardInput = {
  businessId: string;
  mode: ApiKeyMode;
  customerId: string;
  providerCustomerReference: string;
  paymentMethodReference: string;
  reference: string;
  amountMinor: number;
  currency: string;
  preferredProvider?: PaymentProviderId;
  metadata?: Record<string, unknown>;
};

export type ChargeResult = {
  provider: PaymentProviderId;
  reference: string;
  status: "PROCESSING" | "SUCCEEDED" | "FAILED" | "REQUIRES_ACTION";
  failureReason?: string;
  raw?: unknown;
};

export type RoutedChargeResult = ChargeResult & {
  routing: ProviderRoutingInfo;
};

export type TransactionResult = {
  provider: PaymentProviderId;
  reference: string;
  status: string;
  raw?: unknown;
};

export interface PaymentProvider {
  createCheckoutOrder(input: CreateCheckoutInput): Promise<CheckoutResult>;
  chargeTokenizedCard(input: ChargeTokenizedCardInput): Promise<ChargeResult>;
  getTransaction(
    reference: string,
    mode: ApiKeyMode,
    provider?: PaymentProviderId
  ): Promise<TransactionResult>;
}
