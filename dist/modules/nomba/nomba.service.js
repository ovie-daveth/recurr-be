"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentProvider = exports.NombaPaymentProvider = void 0;
const errors_1 = require("../../lib/errors");
const nomba_client_1 = require("./nomba.client");
function shouldUseMockProvider() {
    return (process.env.NOMBA_MOCK === "true" ||
        (process.env.NODE_ENV !== "production" && !process.env.NOMBA_CHECKOUT_PATH));
}
function isLiveEnvironment() {
    return process.env.NOMBA_ENVIRONMENT === "LIVE" || process.env.NOMBA_MODE === "LIVE";
}
function checkoutPathForMode(mode) {
    const configuredPath = process.env.NOMBA_CHECKOUT_PATH;
    if (configuredPath) {
        if (mode === "LIVE" && configuredPath.startsWith("/sandbox/")) {
            throw new errors_1.ApiError(500, "NOMBA_CHECKOUT_PATH cannot use /sandbox for LIVE requests", [{ configuredPath }], "NOMBA_CHECKOUT_PATH_MODE_MISMATCH");
        }
        return configuredPath;
    }
    return mode === "LIVE" || isLiveEnvironment()
        ? "/checkout/order"
        : "/sandbox/checkout/order";
}
class NombaPaymentProvider {
    async createCheckoutOrder(input) {
        if (shouldUseMockProvider()) {
            const baseUrl = process.env.FRONTEND_BASE_URL ||
                process.env.APP_BASE_URL ||
                "http://localhost:5000";
            return {
                provider: "NOMBA",
                reference: input.reference,
                checkoutUrl: `${baseUrl}/mock-checkout/nomba?reference=${encodeURIComponent(input.reference)}`,
                raw: { mock: true },
            };
        }
        const body = await nomba_client_1.nombaClient.request(checkoutPathForMode(input.mode), {
            method: "POST",
            body: {
                order: {
                    orderReference: input.reference,
                    amount: input.amountMinor,
                    currency: input.currency,
                    callbackUrl: input.callbackUrl,
                    customerId: input.customerId,
                    customerEmail: input.customerEmail,
                    ...(input.customerName ? { customerName: input.customerName } : {}),
                },
                metadata: {
                    ...(input.metadata ?? {}),
                    recurrBusinessId: input.businessId,
                    recurrCustomerId: input.customerId,
                    recurrMode: input.mode,
                },
            },
        });
        const record = getRecord(getRecord(body)?.data) ?? getRecord(body);
        const checkoutUrl = getString(record, [
            "checkoutLink",
            "checkoutUrl",
            "checkout_url",
            "link",
            "url",
        ]);
        const reference = getString(record, [
            "orderReference",
            "order_reference",
            "reference",
            "merchantTxRef",
        ]) ?? input.reference;
        if (!checkoutUrl) {
            throw new errors_1.ApiError(502, "Nomba checkout response did not include a checkout link", [{ body }], "NOMBA_CHECKOUT_RESPONSE_INVALID");
        }
        return {
            provider: "NOMBA",
            reference,
            checkoutUrl,
            raw: body,
        };
    }
    async chargeTokenizedCard(input) {
        if (shouldUseMockProvider()) {
            const status = process.env.NOMBA_MOCK_CHARGE_STATUS === "FAILED"
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
        const body = await nomba_client_1.nombaClient.request(process.env.NOMBA_TOKEN_CHARGE_PATH || "/tokenized-card/charge", {
            method: "POST",
            body: {
                amount: input.amountMinor,
                currency: input.currency,
                cardId: input.paymentMethodReference,
                customerId: input.providerCustomerReference,
                merchantTxRef: input.reference,
                metadata: {
                    ...(input.metadata ?? {}),
                    recurrBusinessId: input.businessId,
                    recurrCustomerId: input.customerId,
                    recurrMode: input.mode,
                },
            },
        });
        const record = getRecord(getRecord(body)?.data) ?? getRecord(body);
        const providerStatus = getString(record, ["status", "paymentStatus", "state"]);
        const status = mapChargeStatus(providerStatus);
        return {
            provider: "NOMBA",
            reference: getString(record, ["merchantTxRef", "reference", "transactionReference"]) ??
                input.reference,
            status,
            failureReason: getString(record, ["failureReason", "message", "reason"]),
            raw: body,
        };
    }
    async getTransaction(reference) {
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
        const idType = process.env.NOMBA_TRANSACTION_ID_TYPE ||
            (path.includes("/checkout/transaction") ? "orderReference" : "reference");
        const body = await nomba_client_1.nombaClient.request(`${path}${separator}idType=${encodeURIComponent(idType)}&id=${encodeURIComponent(reference)}`);
        const record = getRecord(getRecord(body)?.data) ?? getRecord(body);
        return {
            provider: "NOMBA",
            reference,
            status: getString(record, ["status", "paymentStatus", "state", "message"]) ??
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
exports.NombaPaymentProvider = NombaPaymentProvider;
exports.paymentProvider = new NombaPaymentProvider();
function getRecord(value) {
    return value && typeof value === "object"
        ? value
        : undefined;
}
function getString(record, keys) {
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
function mapChargeStatus(status) {
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
