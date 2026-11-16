"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentProvider = void 0;
const mock_payment_provider_1 = require("./mock-payment.provider");
const providerIds = ["NOMBA", "MONNIFY", "PAYSTACK"];
function providerOrder() {
    const configured = process.env.PAYMENT_PROVIDER_ORDER;
    if (!configured?.trim()) {
        return providerIds;
    }
    const parsed = configured
        .split(",")
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean);
    if (parsed.length === 0 ||
        parsed.some((provider) => !providerIds.includes(provider)) ||
        new Set(parsed).size !== parsed.length) {
        throw new Error("PAYMENT_PROVIDER_ORDER must be a comma-separated list of unique values from NOMBA,MONNIFY,PAYSTACK");
    }
    return parsed;
}
class MockPaymentProviderRouter {
    providers = new Map(providerIds.map((id) => [id, new mock_payment_provider_1.MockPaymentProvider(id)]));
    async createCheckoutOrder(input) {
        const unavailable = [];
        for (const id of providerOrder()) {
            try {
                return await this.provider(id).createCheckoutOrder(input);
            }
            catch (error) {
                if (!(error instanceof mock_payment_provider_1.PaymentProviderUnavailableError)) {
                    throw error;
                }
                unavailable.push(id);
            }
        }
        throw new Error(`No payment provider is available for checkout: ${unavailable.join(", ")}`);
    }
    async chargeTokenizedCard(input) {
        const preferred = input.preferredProvider;
        const candidates = [
            ...(preferred ? [preferred] : []),
            ...providerOrder().filter((id) => id !== preferred),
        ];
        for (const id of candidates) {
            try {
                return await this.provider(id).chargeTokenizedCard(input);
            }
            catch (error) {
                if (error instanceof mock_payment_provider_1.PaymentProviderUnavailableError) {
                    continue;
                }
                throw error;
            }
        }
        throw new Error(`All configured payment providers are unavailable: ${candidates.join(", ")}`);
    }
    getTransaction(reference, mode, provider = providerOrder()[0]) {
        return this.provider(provider).getTransaction(reference, mode);
    }
    provider(id) {
        const provider = this.providers.get(id);
        if (!provider) {
            throw new Error(`Payment provider ${id} is not registered`);
        }
        return provider;
    }
}
exports.paymentProvider = new MockPaymentProviderRouter();
