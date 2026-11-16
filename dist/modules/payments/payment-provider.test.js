"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const mock_payment_provider_1 = require("./mock-payment.provider");
const mock_provider_model_1 = require("./mock-provider-model");
const payment_provider_1 = require("./payment-provider");
function providerLoad(unavailable) {
    return async () => ({
        unavailable,
        requestCount: 1,
        load: unavailable ? 20 : 2,
        failurePoint: 20,
        riskScore: unavailable ? 1 : 0.1,
    });
}
function providerRegistry(unavailableProviders) {
    return new Map(["NOMBA", "MONNIFY", "PAYSTACK"].map((provider) => [
        provider,
        new mock_payment_provider_1.MockPaymentProvider(provider, providerLoad(unavailableProviders.includes(provider))),
    ]));
}
(0, node_test_1.default)("mock router fails over to the next provider after its capacity point", async () => {
    const router = new payment_provider_1.MockPaymentProviderRouter(providerRegistry(["NOMBA"]));
    const charge = await router.chargeTokenizedCard({
        businessId: "business-1",
        mode: "TEST",
        customerId: "customer-1",
        providerCustomerReference: "mock-customer-1",
        paymentMethodReference: "mock-payment-method-1",
        reference: "payment-attempt-1",
        amountMinor: 1000,
        currency: "NGN",
        preferredProvider: "NOMBA",
    });
    strict_1.default.equal(charge.provider, "MONNIFY");
    strict_1.default.equal(charge.status, "SUCCEEDED");
    strict_1.default.deepEqual(charge.routing, {
        fallbackUsed: true,
        preferredProvider: "NOMBA",
        selectedProvider: "MONNIFY",
        unavailableProviders: ["NOMBA"],
        reason: "PROVIDER_UNAVAILABLE",
    });
});
(0, node_test_1.default)("mock router reports no fallback when the preferred provider succeeds", async () => {
    const router = new payment_provider_1.MockPaymentProviderRouter(providerRegistry([]));
    const charge = await router.chargeTokenizedCard({
        businessId: "business-1",
        mode: "TEST",
        customerId: "customer-1",
        providerCustomerReference: "mock-customer-1",
        paymentMethodReference: "mock-payment-method-1",
        reference: "payment-attempt-1",
        amountMinor: 1000,
        currency: "NGN",
        preferredProvider: "NOMBA",
    });
    strict_1.default.deepEqual(charge.routing, {
        fallbackUsed: false,
        preferredProvider: "NOMBA",
        selectedProvider: "NOMBA",
        unavailableProviders: [],
        reason: null,
    });
});
(0, node_test_1.default)("mock router reports all unavailable providers when failover is exhausted", async () => {
    const router = new payment_provider_1.MockPaymentProviderRouter(providerRegistry(["NOMBA", "MONNIFY", "PAYSTACK"]));
    await strict_1.default.rejects(router.chargeTokenizedCard({
        businessId: "business-1",
        mode: "TEST",
        customerId: "customer-1",
        providerCustomerReference: "mock-customer-1",
        paymentMethodReference: "mock-payment-method-1",
        reference: "payment-attempt-1",
        amountMinor: 1000,
        currency: "NGN",
        preferredProvider: "NOMBA",
    }), (error) => {
        strict_1.default.ok(error instanceof payment_provider_1.PaymentProvidersUnavailableError);
        strict_1.default.deepEqual(error.unavailableProviders, [
            "NOMBA",
            "MONNIFY",
            "PAYSTACK",
        ]);
        return true;
    });
});
(0, node_test_1.default)("mock load predicts earlier failure for higher frequency and larger amounts", () => {
    const standardAmountLoad = (0, mock_provider_model_1.mockProviderRequestLoad)({
        amountMinor: 100_000,
        currency: "NGN",
    });
    const highAmountLoad = (0, mock_provider_model_1.mockProviderRequestLoad)({
        amountMinor: 10_000_000,
        currency: "NGN",
    });
    strict_1.default.ok(highAmountLoad > standardAmountLoad);
    strict_1.default.equal((0, mock_provider_model_1.randomFailurePoint)(() => 0), 20);
    const projectedLoad = (0, mock_provider_model_1.assessMockProviderLoad)({
        currentLoad: 19.5,
        requestLoad: standardAmountLoad,
        failurePoint: 20,
        requestCount: 19,
    });
    strict_1.default.equal(projectedLoad.unavailable, true);
    strict_1.default.equal(projectedLoad.requestCount, 20);
});
(0, node_test_1.default)("mock checkout uses a provider-neutral Recurr URL", async () => {
    const provider = new mock_payment_provider_1.MockPaymentProvider("PAYSTACK", providerLoad(false));
    const checkout = await provider.createCheckoutOrder({
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
(0, node_test_1.default)("mock checkout reports when routing fell back", async () => {
    const router = new payment_provider_1.MockPaymentProviderRouter(providerRegistry(["NOMBA"]));
    const checkout = await router.createCheckoutOrder({
        businessId: "business-1",
        mode: "TEST",
        customerId: "customer-1",
        customerEmail: "customer@example.test",
        reference: "setup-1",
        amountMinor: 100,
        currency: "NGN",
    });
    strict_1.default.equal(checkout.provider, "MONNIFY");
    strict_1.default.deepEqual(checkout.routing, {
        fallbackUsed: true,
        preferredProvider: "NOMBA",
        selectedProvider: "MONNIFY",
        unavailableProviders: ["NOMBA"],
        reason: "PROVIDER_UNAVAILABLE",
    });
});
