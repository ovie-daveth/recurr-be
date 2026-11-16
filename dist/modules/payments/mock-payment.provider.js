"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockPaymentProvider = exports.PaymentProviderUnavailableError = void 0;
class PaymentProviderUnavailableError extends Error {
    constructor(provider) {
        super(`${provider} mock provider is unavailable`);
        this.name = "PaymentProviderUnavailableError";
    }
}
exports.PaymentProviderUnavailableError = PaymentProviderUnavailableError;
class MockPaymentProvider {
    provider;
    constructor(provider) {
        this.provider = provider;
    }
    async createCheckoutOrder(input) {
        return {
            provider: this.provider,
            reference: input.reference,
            checkoutUrl: `${process.env.FRONTEND_BASE_URL || "http://localhost:5173"}/mock-checkout?reference=${encodeURIComponent(input.reference)}`,
            raw: { mock: true },
        };
    }
    async chargeTokenizedCard(input) {
        const outcome = this.configuredOutcome();
        if (outcome === "UNAVAILABLE") {
            throw new PaymentProviderUnavailableError(this.provider);
        }
        const status = outcome === "DECLINED"
            ? "FAILED"
            : outcome === "REQUIRES_ACTION"
                ? "REQUIRES_ACTION"
                : outcome === "PROCESSING" || outcome === "UNKNOWN"
                    ? "PROCESSING"
                    : "SUCCEEDED";
        return {
            provider: this.provider,
            reference: input.reference,
            status,
            ...(status === "FAILED"
                ? { failureReason: `Mock ${this.provider} payment declined` }
                : outcome === "UNKNOWN"
                    ? { failureReason: "Mock payment outcome is unknown; reconciliation required" }
                    : {}),
            raw: { mock: true, outcome },
        };
    }
    async getTransaction(reference, _mode) {
        const outcome = this.configuredOutcome();
        const status = outcome === "SUCCEEDED"
            ? "PAYMENT SUCCESSFUL"
            : outcome === "DECLINED"
                ? "PAYMENT FAILED"
                : outcome === "REQUIRES_ACTION"
                    ? "REQUIRES ACTION"
                    : "PROCESSING";
        return {
            provider: this.provider,
            reference,
            status,
            raw: { mock: true, outcome },
        };
    }
    configuredOutcome() {
        const key = `PAYMENT_MOCK_${this.provider}_CHARGE_OUTCOME`;
        const configured = process.env[key]?.trim().toUpperCase();
        if (configured === "SUCCEEDED" ||
            configured === "DECLINED" ||
            configured === "UNAVAILABLE" ||
            configured === "UNKNOWN" ||
            configured === "PROCESSING" ||
            configured === "REQUIRES_ACTION") {
            return configured;
        }
        if (configured) {
            throw new Error(`${key} must be SUCCEEDED, DECLINED, UNAVAILABLE, UNKNOWN, PROCESSING, or REQUIRES_ACTION`);
        }
        return "SUCCEEDED";
    }
}
exports.MockPaymentProvider = MockPaymentProvider;
