import type { ApiKeyMode } from "../../generated/prisma/client";
import {
  MockPaymentProvider,
  PaymentProviderUnavailableError,
} from "./mock-payment.provider";
import type {
  ChargeResult,
  ChargeTokenizedCardInput,
  CheckoutResult,
  CreateCheckoutInput,
  PaymentProvider,
  PaymentProviderId,
  TransactionResult,
} from "./payment.provider";

const providerIds: PaymentProviderId[] = ["NOMBA", "MONNIFY", "PAYSTACK"];

function providerOrder(): PaymentProviderId[] {
  const configured = process.env.PAYMENT_PROVIDER_ORDER;
  if (!configured?.trim()) {
    return providerIds;
  }

  const parsed = configured
    .split(",")
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  if (
    parsed.length === 0 ||
    parsed.some((provider) => !providerIds.includes(provider as PaymentProviderId)) ||
    new Set(parsed).size !== parsed.length
  ) {
    throw new Error(
      "PAYMENT_PROVIDER_ORDER must be a comma-separated list of unique values from NOMBA,MONNIFY,PAYSTACK"
    );
  }

  return parsed as PaymentProviderId[];
}

class MockPaymentProviderRouter implements PaymentProvider {
  private readonly providers = new Map<PaymentProviderId, PaymentProvider>(
    providerIds.map((id) => [id, new MockPaymentProvider(id)])
  );

  async createCheckoutOrder(input: CreateCheckoutInput): Promise<CheckoutResult> {
    const unavailable: PaymentProviderId[] = [];
    for (const id of providerOrder()) {
      try {
        return await this.provider(id).createCheckoutOrder(input);
      } catch (error) {
        if (!(error instanceof PaymentProviderUnavailableError)) {
          throw error;
        }
        unavailable.push(id);
      }
    }
    throw new Error(
      `No payment provider is available for checkout: ${unavailable.join(", ")}`
    );
  }

  async chargeTokenizedCard(
    input: ChargeTokenizedCardInput
  ): Promise<ChargeResult> {
    const preferred = input.preferredProvider;
    const candidates = [
      ...(preferred ? [preferred] : []),
      ...providerOrder().filter((id) => id !== preferred),
    ];

    for (const id of candidates) {
      try {
        return await this.provider(id).chargeTokenizedCard(input);
      } catch (error) {
        if (error instanceof PaymentProviderUnavailableError) {
          continue;
        }
        throw error;
      }
    }

    throw new Error(
      `All configured payment providers are unavailable: ${candidates.join(", ")}`
    );
  }

  getTransaction(
    reference: string,
    mode: ApiKeyMode,
    provider: PaymentProviderId = providerOrder()[0]
  ): Promise<TransactionResult> {
    return this.provider(provider).getTransaction(reference, mode);
  }

  private provider(id: PaymentProviderId): PaymentProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`Payment provider ${id} is not registered`);
    }
    return provider;
  }
}

export const paymentProvider = new MockPaymentProviderRouter();
