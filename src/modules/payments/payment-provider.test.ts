import assert from "node:assert/strict";
import test from "node:test";
import { paymentProvider } from "./payment-provider";

test("mock payment routing fails over only when a provider is unavailable", async () => {
  const keys = [
    "PAYMENT_PROVIDER_ORDER",
    "PAYMENT_MOCK_NOMBA_CHARGE_OUTCOME",
    "PAYMENT_MOCK_MONNIFY_CHARGE_OUTCOME",
    "PAYMENT_MOCK_PAYSTACK_CHARGE_OUTCOME",
  ] as const;
  const previous = new Map(
    keys.map((key) => [key, process.env[key]])
  );

  try {
    process.env.PAYMENT_PROVIDER_ORDER = "NOMBA,MONNIFY,PAYSTACK";
    process.env.PAYMENT_MOCK_NOMBA_CHARGE_OUTCOME = "UNAVAILABLE";
    process.env.PAYMENT_MOCK_MONNIFY_CHARGE_OUTCOME = "SUCCEEDED";
    process.env.PAYMENT_MOCK_PAYSTACK_CHARGE_OUTCOME = "SUCCEEDED";

    const chargeInput = {
      businessId: "business-1",
      mode: "TEST" as const,
      customerId: "customer-1",
      providerCustomerReference: "mock-customer-1",
      paymentMethodReference: "mock-payment-method-1",
      reference: "payment-attempt-1",
      amountMinor: 1000,
      currency: "NGN",
    };

    const fallbackCharge = await paymentProvider.chargeTokenizedCard(chargeInput);
    assert.equal(fallbackCharge.provider, "MONNIFY");
    assert.equal(fallbackCharge.status, "SUCCEEDED");

    process.env.PAYMENT_MOCK_NOMBA_CHARGE_OUTCOME = "DECLINED";
    const declinedCharge = await paymentProvider.chargeTokenizedCard(chargeInput);
    assert.equal(declinedCharge.provider, "NOMBA");
    assert.equal(declinedCharge.status, "FAILED");

    process.env.PAYMENT_MOCK_NOMBA_CHARGE_OUTCOME = "UNKNOWN";
    const unknownCharge = await paymentProvider.chargeTokenizedCard(chargeInput);
    assert.equal(unknownCharge.provider, "NOMBA");
    assert.equal(unknownCharge.status, "PROCESSING");

    process.env.PAYMENT_MOCK_NOMBA_CHARGE_OUTCOME = "UNAVAILABLE";
    process.env.PAYMENT_MOCK_MONNIFY_CHARGE_OUTCOME = "UNAVAILABLE";
    const secondFallback = await paymentProvider.chargeTokenizedCard(chargeInput);
    assert.equal(secondFallback.provider, "PAYSTACK");
    assert.equal(secondFallback.status, "SUCCEEDED");
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});

test("mock checkout uses a provider-neutral Recurr URL", async () => {
  const checkout = await paymentProvider.createCheckoutOrder({
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
