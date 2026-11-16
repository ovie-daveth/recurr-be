import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";

const profiles = {
  low: { rate: 10, duration: "30s", preAllocatedVUs: 20, maxVUs: 50 },
  moderate: { rate: 100, duration: "15s", preAllocatedVUs: 150, maxVUs: 500 },
  high: { rate: 1000, duration: "5s", preAllocatedVUs: 1200, maxVUs: 2000 },
};

const profileName = __ENV.PROFILE || "low";
const profile = profiles[profileName];
const baseUrl = (__ENV.BASE_URL || "http://localhost:5000").replace(/\/$/, "");
const businessId = __ENV.BUSINESS_ID;
const paymentMethodId = __ENV.PAYMENT_METHOD_ID;
const merchantSession = __ENV.MERCHANT_SESSION;
const amountMinor = Number(__ENV.AMOUNT_MINOR || 500000);

if (!profile) {
  throw new Error("PROFILE must be one of: low, moderate, high");
}
if (!businessId || !paymentMethodId || !merchantSession) {
  throw new Error(
    "Set BUSINESS_ID, PAYMENT_METHOD_ID, and MERCHANT_SESSION before running k6"
  );
}
if (!Number.isInteger(amountMinor) || amountMinor < 100 || amountMinor > 500000000) {
  throw new Error("AMOUNT_MINOR must be an integer between 100 and 500000000");
}

const fallbackCount = new Counter("mock_provider_fallbacks");
const unavailableCount = new Counter("mock_provider_all_unavailable");

export const options = {
  scenarios: {
    mock_provider_load: {
      executor: "constant-arrival-rate",
      rate: profile.rate,
      timeUnit: "1s",
      duration: profile.duration,
      preAllocatedVUs: profile.preAllocatedVUs,
      maxVUs: profile.maxVUs,
    },
  },
  thresholds: {
    checks: ["rate>0.99"],
  },
};

http.setResponseCallback(http.expectedStatuses(200, 503));

export default function () {
  const response = http.post(
    `${baseUrl}/api/v1/dev/payments/simulate`,
    JSON.stringify({ businessId, paymentMethodId, amountMinor }),
    {
      headers: {
        Authorization: `Bearer ${merchantSession}`,
        "Content-Type": "application/json",
      },
      timeout: "30s",
    }
  );

  const body = parseJson(response.body);
  const routing = body?.data?.paymentProviderResult?.routing;

  if (response.status === 200 && routing?.fallbackUsed) {
    fallbackCount.add(1);
  }
  if (response.status === 503) {
    unavailableCount.add(1);
  }

  check(response, {
    "request returned a provider result or simulated outage": (res) =>
      res.status === 200 || res.status === 503,
    "successful response includes routing details": (res) =>
      res.status !== 200 || Boolean(routing && routing.selectedProvider),
  });
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
