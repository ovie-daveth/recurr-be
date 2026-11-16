"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const payment_provider_1 = require("./payment-provider");
(0, node_test_1.default)("mock payment routing fails over only when a provider is unavailable", async () => {
    const keys = [
        "PAYMENT_PROVIDER_ORDER",
        "PAYMENT_MOCK_NOMBA_CHARGE_OUTCOME",
        "PAYMENT_MOCK_MONNIFY_CHARGE_OUTCOME",
        "PAYMENT_MOCK_PAYSTACK_CHARGE_OUTCOME",
    ];
    const previous = new Map(keys.map((key) => [key, process.env[key]]));
    try {
        process.env.PAYMENT_PROVIDER_ORDER = "NOMBA,MONNIFY,PAYSTACK";
        process.env.PAYMENT_MOCK_NOMBA_CHARGE_OUTCOME = "UNAVAILABLE";
        process.env.PAYMENT_MOCK_MONNIFY_CHARGE_OUTCOME = "SUCCEEDED";
        process.env.PAYMENT_MOCK_PAYSTACK_CHARGE_OUTCOME = "SUCCEEDED";
        const chargeInput = {
            businessId: "business-1",
            mode: "TEST",
            customerId: "customer-1",
            providerCustomerReference: "mock-customer-1",
            paymentMethodReference: "mock-payment-method-1",
            reference: "payment-attempt-1",
            amountMinor: 1000,
            currency: "NGN",
        };
        const fallbackCharge = await payment_provider_1.paymentProvider.chargeTokenizedCard(chargeInput);
        strict_1.default.equal(fallbackCharge.provider, "MONNIFY");
        strict_1.default.equal(fallbackCharge.status, "SUCCEEDED");
        process.env.PAYMENT_MOCK_NOMBA_CHARGE_OUTCOME = "DECLINED";
        const declinedCharge = await payment_provider_1.paymentProvider.chargeTokenizedCard(chargeInput);
        strict_1.default.equal(declinedCharge.provider, "NOMBA");
        strict_1.default.equal(declinedCharge.status, "FAILED");
        process.env.PAYMENT_MOCK_NOMBA_CHARGE_OUTCOME = "UNKNOWN";
        const unknownCharge = await payment_provider_1.paymentProvider.chargeTokenizedCard(chargeInput);
        strict_1.default.equal(unknownCharge.provider, "NOMBA");
        strict_1.default.equal(unknownCharge.status, "PROCESSING");
        process.env.PAYMENT_MOCK_NOMBA_CHARGE_OUTCOME = "UNAVAILABLE";
        process.env.PAYMENT_MOCK_MONNIFY_CHARGE_OUTCOME = "UNAVAILABLE";
        const secondFallback = await payment_provider_1.paymentProvider.chargeTokenizedCard(chargeInput);
        strict_1.default.equal(secondFallback.provider, "PAYSTACK");
        strict_1.default.equal(secondFallback.status, "SUCCEEDED");
    }
    finally {
        for (const [key, value] of previous) {
            if (value === undefined) {
                delete process.env[key];
            }
            else {
                process.env[key] = value;
            }
        }
    }
});
(0, node_test_1.default)("mock checkout uses a provider-neutral Recurr URL", async () => {
    const checkout = await payment_provider_1.paymentProvider.createCheckoutOrder({
        businessId: "business-1",
        mode: "TEST",
        customerId: "customer-1",
        customerEmail: "customer@example.test",
        reference: "setup-1",
        amountMinor: 100,
        currency: "NGN",
    });
    strict_1.default.match(checkout.checkoutUrl, /\/mock-checkout\?reference=/);
    strict_1.default.doesNotMatch(checkout.checkoutUrl, /nomba|monnify|paystack/i);
});
