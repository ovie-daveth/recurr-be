"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockPaymentProvider = exports.PaymentProviderUnavailableError = void 0;
class PaymentProviderUnavailableError extends Error {
    loadResult;
    constructor(provider, loadResult) {
        super(`${provider} mock provider reached its simulated capacity point`);
        this.loadResult = loadResult;
        this.name = "PaymentProviderUnavailableError";
    }
}
exports.PaymentProviderUnavailableError = PaymentProviderUnavailableError;
class MockPaymentProvider {
    provider;
    evaluateLoad;
    constructor(provider, evaluateLoad = async (input) => {
        const { recordMockProviderRequest } = await Promise.resolve().then(() => __importStar(require("./mock-provider-load")));
        return recordMockProviderRequest(input);
    }) {
        this.provider = provider;
        this.evaluateLoad = evaluateLoad;
    }
    async createCheckoutOrder(input) {
        const load = await this.evaluateLoad({
            provider: this.provider,
            amountMinor: input.amountMinor,
            currency: input.currency,
        });
        if (load.unavailable) {
            throw new PaymentProviderUnavailableError(this.provider, load);
        }
        return {
            provider: this.provider,
            reference: input.reference,
            checkoutUrl: `${process.env.FRONTEND_BASE_URL || "http://localhost:5173"}/mock-checkout?reference=${encodeURIComponent(input.reference)}`,
            raw: { mock: true },
        };
    }
    async chargeTokenizedCard(input) {
        const load = await this.evaluateLoad({
            provider: this.provider,
            amountMinor: input.amountMinor,
            currency: input.currency,
        });
        if (load.unavailable) {
            throw new PaymentProviderUnavailableError(this.provider, load);
        }
        return {
            provider: this.provider,
            reference: input.reference,
            status: "SUCCEEDED",
            raw: { mock: true },
        };
    }
    async getTransaction(reference, _mode) {
        const load = await this.evaluateLoad({
            provider: this.provider,
            amountMinor: 0,
            currency: "NGN",
        });
        return {
            provider: this.provider,
            reference,
            status: load.unavailable ? "PROCESSING" : "PAYMENT SUCCESSFUL",
            raw: { mock: true },
        };
    }
}
exports.MockPaymentProvider = MockPaymentProvider;
