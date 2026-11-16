import type {
  ChargeResult,
  ChargeTokenizedCardInput,
  CheckoutResult,
  CreateCheckoutInput,
  PaymentProvider,
  PaymentProviderId,
  TransactionResult,
} from "./payment.provider";
import {
  type MockProviderLoadResult,
} from "./mock-provider-model";

export class PaymentProviderUnavailableError extends Error {
  constructor(
    provider: PaymentProviderId,
    readonly loadResult: MockProviderLoadResult
  ) {
    super(`${provider} mock provider reached its simulated capacity point`);
    this.name = "PaymentProviderUnavailableError";
  }
}

export type MockProviderLoadEvaluator = (input: {
  provider: PaymentProviderId;
  amountMinor: number;
  currency: string;
}) => Promise<MockProviderLoadResult>;

export class MockPaymentProvider implements PaymentProvider {
  constructor(
    private readonly provider: PaymentProviderId,
    private readonly evaluateLoad: MockProviderLoadEvaluator =
      async (input) => {
        const { recordMockProviderRequest } = await import("./mock-provider-load");
        return recordMockProviderRequest(input);
      }
  ) {}

  async createCheckoutOrder(input: CreateCheckoutInput): Promise<CheckoutResult> {
    const load = await this.evaluateLoad({
      provider: this.provider,
      amountMinor: input.amountMinor,
      currency: input.currency,
    });
    if (load.unavailable) {
      throw new PaymentProviderUnavailableError(this.provider, load);
    }

    return {
      provider: this.provider,
      reference: input.reference,
      checkoutUrl: `${process.env.FRONTEND_BASE_URL || "http://localhost:5173"}/mock-checkout?reference=${encodeURIComponent(input.reference)}`,
      raw: { mock: true },
    };
  }

  async chargeTokenizedCard(
    input: ChargeTokenizedCardInput
  ): Promise<ChargeResult> {
    const load = await this.evaluateLoad({
      provider: this.provider,
      amountMinor: input.amountMinor,
      currency: input.currency,
    });
    if (load.unavailable) {
      throw new PaymentProviderUnavailableError(this.provider, load);
    }

    return {
      provider: this.provider,
      reference: input.reference,
      status: "SUCCEEDED",
      raw: { mock: true },
    };
  }

  async getTransaction(
    reference: string,
    _mode: "TEST" | "LIVE"
  ): Promise<TransactionResult> {
    const load = await this.evaluateLoad({
      provider: this.provider,
      amountMinor: 0,
      currency: "NGN",
    });

    return {
      provider: this.provider,
      reference,
      status: load.unavailable ? "PROCESSING" : "PAYMENT SUCCESSFUL",
      raw: { mock: true },
    };
  }
}
