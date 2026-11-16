import type { ApiKeyMode } from "../../generated/prisma/client";
import {
  MockPaymentProvider,
  PaymentProviderUnavailableError,
} from "./mock-payment.provider";
import type {
  ChargeTokenizedCardInput,
  CreateCheckoutInput,
  PaymentProvider,
  PaymentProviderId,
  ProviderRoutingInfo,
  RoutedChargeResult,
  RoutedCheckoutResult,
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

export class MockPaymentProviderRouter implements PaymentProvider {
  private readonly providers: Map<PaymentProviderId, PaymentProvider>;

  constructor(
    providers: Map<PaymentProviderId, PaymentProvider> = new Map(
      providerIds.map((id) => [id, new MockPaymentProvider(id)])
    )
  ) {
    this.providers = providers;
  }

  async createCheckoutOrder(
    input: CreateCheckoutInput
  ): Promise<RoutedCheckoutResult> {
    const unavailable: PaymentProviderId[] = [];
    const candidates = providerOrder();
    const preferredProvider = candidates[0];
    for (const id of candidates) {
      try {
        const checkout = await this.provider(id).createCheckoutOrder(input);
        return {
          ...checkout,
          routing: routingInfo(preferredProvider, id, unavailable),
        };
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
  ): Promise<RoutedChargeResult> {
    const preferred = input.preferredProvider;
    const candidates = [
      ...(preferred ? [preferred] : []),
      ...providerOrder().filter((id) => id !== preferred),
    ];
    const preferredProvider = candidates[0];
    const unavailable: PaymentProviderId[] = [];

    for (const id of candidates) {
      try {
        const charge = await this.provider(id).chargeTokenizedCard(input);
        return {
          ...charge,
          routing: routingInfo(preferredProvider, id, unavailable),
        };
      } catch (error) {
        if (error instanceof PaymentProviderUnavailableError) {
          unavailable.push(id);
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

function routingInfo(
  preferredProvider: PaymentProviderId,
  selectedProvider: PaymentProviderId,
  unavailableProviders: PaymentProviderId[]
): ProviderRoutingInfo {
  const fallbackUsed = unavailableProviders.length > 0;
  return {
    fallbackUsed,
    preferredProvider,
    selectedProvider,
    unavailableProviders,
    reason: fallbackUsed ? "PROVIDER_UNAVAILABLE" : null,
  };
}

export const paymentProvider = new MockPaymentProviderRouter();
