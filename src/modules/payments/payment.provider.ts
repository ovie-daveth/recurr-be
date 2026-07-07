import type { ApiKeyMode } from "../../generated/prisma/client";

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
  provider: "NOMBA";
  reference: string;
  checkoutUrl: string;
  raw?: unknown;
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
  metadata?: Record<string, unknown>;
};

export type ChargeResult = {
  provider: "NOMBA";
  reference: string;
  status: "PROCESSING" | "SUCCEEDED" | "FAILED" | "REQUIRES_ACTION";
  failureReason?: string;
  raw?: unknown;
};

export type TransactionResult = {
  provider: "NOMBA";
  reference: string;
  status: string;
  raw?: unknown;
};

export interface PaymentProvider {
  createCheckoutOrder(input: CreateCheckoutInput): Promise<CheckoutResult>;
  chargeTokenizedCard(input: ChargeTokenizedCardInput): Promise<ChargeResult>;
  getTransaction(reference: string, mode: ApiKeyMode): Promise<TransactionResult>;
}
