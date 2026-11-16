import assert from "node:assert/strict";
import test from "node:test";
import {
  createMockLoadRunSchema,
  simulateMockLoadSchema,
} from "./dev-payment-load.schema";

test("mock load request defaults to the demo charge amount", () => {
  const parsed = simulateMockLoadSchema.safeParse({
    businessId: "b321cc40-7c7b-4df8-a3b6-7ebdf0547638",
    paymentMethodId: "88feb767-5598-4f67-a934-4d6d7bf27b3e",
  });

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.amountMinor, 500_000);
  }
});

test("mock load request rejects invalid amounts", () => {
  const parsed = simulateMockLoadSchema.safeParse({
    businessId: "b321cc40-7c7b-4df8-a3b6-7ebdf0547638",
    paymentMethodId: "88feb767-5598-4f67-a934-4d6d7bf27b3e",
    amountMinor: -1,
  });

  assert.equal(parsed.success, false);
});

test("mock load run accepts a supported profile and bounded metadata", () => {
  const parsed = createMockLoadRunSchema.safeParse({
    businessId: "b321cc40-7c7b-4df8-a3b6-7ebdf0547638",
    profile: "low",
    targetRate: 10,
    durationSeconds: 30,
  });

  assert.equal(parsed.success, true);
});

test("mock load run rejects an unsupported profile", () => {
  const parsed = createMockLoadRunSchema.safeParse({
    businessId: "b321cc40-7c7b-4df8-a3b6-7ebdf0547638",
    profile: "burst",
    targetRate: 10,
    durationSeconds: 30,
  });

  assert.equal(parsed.success, false);
});
