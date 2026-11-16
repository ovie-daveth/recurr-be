import assert from "node:assert/strict";
import test from "node:test";
import { MockPaymentProvider } from "./mock-payment.provider";
import {
  assessMockProviderLoad,
  mockProviderRequestLoad,
  randomFailurePoint,
} from "./mock-provider-model";
import { MockPaymentProviderRouter } from "./payment-provider";
import type {
  PaymentProvider,
  PaymentProviderId,
} from "./payment.provider";

function providerLoad(unavailable: boolean) {
  return async () => ({
    unavailable,
    requestCount: 1,
    load: unavailable ? 20 : 2,
    failurePoint: 20,
    riskScore: unavailable ? 1 : 0.1,
  });
}

function providerRegistry(
  unavailableProviders: PaymentProviderId[]
): Map<PaymentProviderId, PaymentProvider> {
  return new Map(
    (["NOMBA", "MONNIFY", "PAYSTACK"] as PaymentProviderId[]).map((provider) => [
      provider,
      new MockPaymentProvider(
        provider,
        providerLoad(unavailableProviders.includes(provider))
      ),
    ])
  );
}

test("mock router fails over to the next provider after its capacity point", async () => {
  const router = new MockPaymentProviderRouter(
    providerRegistry(["NOMBA"])
  );
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

  assert.equal(charge.provider, "MONNIFY");
  assert.equal(charge.status, "SUCCEEDED");
  assert.deepEqual(charge.routing, {
    fallbackUsed: true,
    preferredProvider: "NOMBA",
    selectedProvider: "MONNIFY",
    unavailableProviders: ["NOMBA"],
    reason: "PROVIDER_UNAVAILABLE",
  });
});

test("mock router reports no fallback when the preferred provider succeeds", async () => {
  const router = new MockPaymentProviderRouter(providerRegistry([]));
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

  assert.deepEqual(charge.routing, {
    fallbackUsed: false,
    preferredProvider: "NOMBA",
    selectedProvider: "NOMBA",
    unavailableProviders: [],
    reason: null,
  });
});

test("mock load predicts earlier failure for higher frequency and larger amounts", () => {
  const standardAmountLoad = mockProviderRequestLoad({
    amountMinor: 100_000,
    currency: "NGN",
  });
  const highAmountLoad = mockProviderRequestLoad({
    amountMinor: 10_000_000,
    currency: "NGN",
  });

  assert.ok(highAmountLoad > standardAmountLoad);
  assert.equal(randomFailurePoint(() => 0), 20);

  const projectedLoad = assessMockProviderLoad({
    currentLoad: 19.5,
    requestLoad: standardAmountLoad,
    failurePoint: 20,
    requestCount: 19,
  });
  assert.equal(projectedLoad.unavailable, true);
  assert.equal(projectedLoad.requestCount, 20);
});

test("mock checkout uses a provider-neutral Recurr URL", async () => {
  const provider = new MockPaymentProvider(
    "PAYSTACK",
    providerLoad(false)
  );
  const checkout = await provider.createCheckoutOrder({
    businessId: "business-1",
    mode: "TEST",
    customerId: "customer-1",
    customerEmail: "customer@example.test",
    reference: "setup-1",
    amountMinor: 100,
    currency: "NGN",
  });

  assert.match(checkout.checkoutUrl, /\/mock-checkout\?reference=/);
  assert.doesNotMatch(checkout.checkoutUrl, /nomba|monnify|paystack/i);
});

test("mock checkout reports when routing fell back", async () => {
  const router = new MockPaymentProviderRouter(providerRegistry(["NOMBA"]));
  const checkout = await router.createCheckoutOrder({
    businessId: "business-1",
    mode: "TEST",
    customerId: "customer-1",
    customerEmail: "customer@example.test",
    reference: "setup-1",
    amountMinor: 100,
    currency: "NGN",
  });

  assert.equal(checkout.provider, "MONNIFY");
  assert.deepEqual(checkout.routing, {
    fallbackUsed: true,
    preferredProvider: "NOMBA",
    selectedProvider: "MONNIFY",
    unavailableProviders: ["NOMBA"],
    reason: "PROVIDER_UNAVAILABLE",
  });
});
