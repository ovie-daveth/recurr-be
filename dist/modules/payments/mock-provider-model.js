"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.randomFailurePoint = randomFailurePoint;
exports.mockProviderRequestLoad = mockProviderRequestLoad;
exports.assessMockProviderLoad = assessMockProviderLoad;
const MIN_FAILURE_POINT = 20;
const MAX_FAILURE_POINT = 40;
const HIGH_AMOUNT_BASELINE_MAJOR = {
    NGN: 100_000,
    USD: 1_000,
    EUR: 1_000,
    GBP: 1_000,
};
const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND", "CLP"]);
function randomFailurePoint(random = Math.random) {
    return MIN_FAILURE_POINT + random() * (MAX_FAILURE_POINT - MIN_FAILURE_POINT);
}
function mockProviderRequestLoad(input) {
    const currency = input.currency.toUpperCase();
    const minorUnitsPerMajor = ZERO_DECIMAL_CURRENCIES.has(currency) ? 1 : 100;
    const baselineMajor = HIGH_AMOUNT_BASELINE_MAJOR[currency] ?? 1_000;
    const amountMajor = input.amountMinor / minorUnitsPerMajor;
    const amountLoad = Math.min(10, Math.max(0, amountMajor / baselineMajor));
    return 1 + amountLoad;
}
function assessMockProviderLoad(input) {
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
