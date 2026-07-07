import { ApiError } from "../../lib/errors";
import type {
  ChargeResult,
  ChargeTokenizedCardInput,
  CheckoutResult,
  CreateCheckoutInput,
  PaymentProvider,
  TransactionResult,
} from "../payments/payment.provider";
import { nombaClient } from "./nomba.client";

function shouldUseMockProvider() {
  return (
    process.env.NOMBA_MOCK === "true" ||
    (process.env.NODE_ENV !== "production" && !process.env.NOMBA_CHECKOUT_PATH)
  );
}

function isLiveEnvironment() {
  return process.env.NOMBA_ENVIRONMENT === "LIVE" || process.env.NOMBA_MODE === "LIVE";
}

function checkoutPathForMode(mode: "TEST" | "LIVE") {
  const configuredPath = process.env.NOMBA_CHECKOUT_PATH;
  if (configuredPath) {
    if (mode === "LIVE" && configuredPath.startsWith("/sandbox/")) {
      throw new ApiError(
        500,
        "NOMBA_CHECKOUT_PATH cannot use /sandbox for LIVE requests",
        [{ configuredPath }],
        "NOMBA_CHECKOUT_PATH_MODE_MISMATCH"
      );
    }

    return configuredPath;
  }

  return mode === "LIVE" || isLiveEnvironment()
    ? "/checkout/order"
    : "/sandbox/checkout/order";
}

function checkoutAmountForNomba(input: { amountMinor: number; currency: string }) {
  if (input.currency !== "NGN") {
    return input.amountMinor;
  }

  return input.amountMinor / 100;
}

function tokenizedCardChargePath() {
  return (
    process.env.NOMBA_TOKEN_CHARGE_PATH || "/checkout/tokenized-card-payment"
  );
}

function envForMode(mode: "TEST" | "LIVE", key: string) {
  if (mode === "TEST") {
    return process.env[`NOMBA_TEST_${key}`] || process.env[`NOMBA_${key}`];
  }

  return process.env[`NOMBA_LIVE_${key}`] || process.env[`NOMBA_${key}`];
}

function scopedOrderAccount(mode: "TEST" | "LIVE") {
  const accountId =
    envForMode(mode, "SUB_ACCOUNT_ID") || envForMode(mode, "CHECKOUT_ACCOUNT_ID");

  return accountId?.trim() ? { accountId: accountId.trim() } : {};
}

export class NombaPaymentProvider implements PaymentProvider {
  async createCheckoutOrder(input: CreateCheckoutInput): Promise<CheckoutResult> {
    if (shouldUseMockProvider()) {
      const baseUrl =
        process.env.FRONTEND_BASE_URL ||
        process.env.APP_BASE_URL ||
        "http://localhost:5000";

      return {
        provider: "NOMBA",
        reference: input.reference,
        checkoutUrl: `${baseUrl}/mock-checkout/nomba?reference=${encodeURIComponent(
          input.reference
        )}`,
        raw: { mock: true },
      };
    }

    const body = await nombaClient.request(
      checkoutPathForMode(input.mode),
      {
        mode: input.mode,
        method: "POST",
        idempotencyKey: input.reference,
        body: {
          order: {
            orderReference: input.reference,
            ...scopedOrderAccount(input.mode),
            amount: checkoutAmountForNomba(input),
            currency: input.currency,
            callbackUrl: input.callbackUrl,
            customerId: input.customerId,
            customerEmail: input.customerEmail,
            ...(input.customerName ? { customerName: input.customerName } : {}),
          },
          tokenizeCard: true,
          metadata: {
            ...(input.metadata ?? {}),
            recurrBusinessId: input.businessId,
            recurrCustomerId: input.customerId,
            recurrMode: input.mode,
          },
        },
      }
    );

    const record = getRecord(getRecord(body)?.data) ?? getRecord(body);
    const checkoutUrl = getString(record, [
      "checkoutLink",
      "checkoutUrl",
      "checkout_url",
      "link",
      "url",
    ]);
    const reference =
      getString(record, [
        "orderReference",
        "order_reference",
        "reference",
        "merchantTxRef",
      ]) ?? input.reference;

    if (!checkoutUrl) {
      throw new ApiError(
        502,
        "Nomba checkout response did not include a checkout link",
        [{ body }],
        "NOMBA_CHECKOUT_RESPONSE_INVALID"
      );
    }

    return {
      provider: "NOMBA",
      reference,
      checkoutUrl,
      raw: body,
    };
  }

  async chargeTokenizedCard(
    input: ChargeTokenizedCardInput
  ): Promise<ChargeResult> {
    if (shouldUseMockProvider()) {
      const status =
        process.env.NOMBA_MOCK_CHARGE_STATUS === "FAILED"
          ? "FAILED"
          : process.env.NOMBA_MOCK_CHARGE_STATUS === "SUCCEEDED"
            ? "SUCCEEDED"
            : "PROCESSING";

      return {
        provider: "NOMBA",
        reference: input.reference,
        status,
        failureReason: status === "FAILED" ? "Mock Nomba charge failed" : undefined,
        raw: { mock: true },
      };
    }

    const body = await nombaClient.request(
      tokenizedCardChargePath(),
      {
        mode: input.mode,
        method: "POST",
        idempotencyKey: input.reference,
        body: {
          tokenKey: input.paymentMethodReference,
          order: {
            orderReference: input.reference,
            ...scopedOrderAccount(input.mode),
            amount: checkoutAmountForNomba(input),
            currency: input.currency,
            customerId: input.providerCustomerReference,
          },
          metadata: {
            ...(input.metadata ?? {}),
            recurrBusinessId: input.businessId,
            recurrCustomerId: input.customerId,
            recurrMode: input.mode,
          },
        },
      }
    );

    const record = getRecord(getRecord(body)?.data) ?? getRecord(body);
    const providerStatus = getString(record, ["status", "paymentStatus", "state"]);
    const status = mapChargeStatus(providerStatus);

    return {
      provider: "NOMBA",
      reference:
        getString(record, ["merchantTxRef", "reference", "transactionReference"]) ??
        input.reference,
      status,
      failureReason: getString(record, ["failureReason", "message", "reason"]),
      raw: body,
    };
  }

  async getTransaction(reference: string, mode: "TEST" | "LIVE" = "TEST"): Promise<TransactionResult> {
    if (shouldUseMockProvider()) {
      return {
        provider: "NOMBA",
        reference,
        status: process.env.NOMBA_MOCK_TRANSACTION_STATUS || "SUCCESSFUL",
        raw: { mock: true },
      };
    }

    const path = process.env.NOMBA_TRANSACTION_LOOKUP_PATH || "/transactions/accounts/single";
    const separator = path.includes("?") ? "&" : "?";
    const idType =
      process.env.NOMBA_TRANSACTION_ID_TYPE ||
      (path.includes("/checkout/transaction") ? "orderReference" : "reference");
    const body = await nombaClient.request(
      `${path}${separator}idType=${encodeURIComponent(
        idType
      )}&id=${encodeURIComponent(reference)}`,
      { mode }
    );
    const record = getRecord(getRecord(body)?.data) ?? getRecord(body);

    return {
      provider: "NOMBA",
      reference,
      status:
        getString(record, ["status", "paymentStatus", "state", "message"]) ??
        getString(getRecord(record?.transactionDetails), [
          "statusCode",
          "status",
          "paymentStatus",
        ]) ??
        "UNKNOWN",
      raw: body,
    };
  }
}

export const paymentProvider = new NombaPaymentProvider();

function getRecord(value: unknown) {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}

function getString(record: Record<string, unknown> | undefined, keys: string[]) {
  if (!record) {
    return undefined;
  }

  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function mapChargeStatus(status: string | undefined): ChargeResult["status"] {
  if (!status) {
    return "PROCESSING";
  }

  if (/success|successful|succeeded|paid|approved/i.test(status)) {
    return "SUCCEEDED";
  }

  if (/fail|failed|declined|reversed/i.test(status)) {
    return "FAILED";
  }

  if (/action|otp|auth|pin|3ds/i.test(status)) {
    return "REQUIRES_ACTION";
  }

  return "PROCESSING";
}
