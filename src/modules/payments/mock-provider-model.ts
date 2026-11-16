import type { PaymentProviderId } from "./payment.provider";

const MIN_FAILURE_POINT = 20;
const MAX_FAILURE_POINT = 40;
const HIGH_AMOUNT_BASELINE_MAJOR: Record<string, number> = {
  NGN: 100_000,
  USD: 1_000,
  EUR: 1_000,
  GBP: 1_000,
};
const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND", "CLP"]);

export type MockProviderLoadResult = {
  unavailable: boolean;
  requestCount: number;
  load: number;
  failurePoint: number;
  riskScore: number;
};

export type MockProviderLoadInput = {
  provider: PaymentProviderId;
  amountMinor: number;
  currency: string;
};

export function randomFailurePoint(random: () => number = Math.random) {
  return MIN_FAILURE_POINT + random() * (MAX_FAILURE_POINT - MIN_FAILURE_POINT);
}

export function mockProviderRequestLoad(input: {
  amountMinor: number;
  currency: string;
}) {
  const currency = input.currency.toUpperCase();
  const minorUnitsPerMajor = ZERO_DECIMAL_CURRENCIES.has(currency) ? 1 : 100;
  const baselineMajor = HIGH_AMOUNT_BASELINE_MAJOR[currency] ?? 1_000;
  const amountMajor = input.amountMinor / minorUnitsPerMajor;
  const amountLoad = Math.min(10, Math.max(0, amountMajor / baselineMajor));
  return 1 + amountLoad;
}

export function assessMockProviderLoad(input: {
  currentLoad: number;
  requestLoad: number;
  failurePoint: number;
  requestCount: number;
}): MockProviderLoadResult {
  const load = input.currentLoad + input.requestLoad;
  const riskScore = Math.min(1, load / input.failurePoint);

  return {
    unavailable: load >= input.failurePoint,
    requestCount: input.requestCount + 1,
    load,
    failurePoint: input.failurePoint,
    riskScore,
  };
}
