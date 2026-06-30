"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supportedCurrencySchema = exports.MONEY_LIMITS_MINOR = exports.SUPPORTED_CURRENCIES = void 0;
exports.getMoneyLimits = getMoneyLimits;
exports.validateAmountMinorForCurrency = validateAmountMinorForCurrency;
exports.moneyLimitMessage = moneyLimitMessage;
const zod_1 = require("zod");
exports.SUPPORTED_CURRENCIES = ["NGN"];
exports.MONEY_LIMITS_MINOR = {
    NGN: {
        min: 100,
        max: 500_000_000,
    },
};
exports.supportedCurrencySchema = zod_1.z
    .string()
    .trim()
    .toUpperCase()
    .pipe(zod_1.z.enum(exports.SUPPORTED_CURRENCIES));
function getMoneyLimits(currency) {
    return exports.MONEY_LIMITS_MINOR[currency];
}
function validateAmountMinorForCurrency(input) {
    if (typeof input.amountMinor === "undefined") {
        return true;
    }
    const currency = (input.currency ?? "NGN");
    const limits = getMoneyLimits(currency);
    return input.amountMinor >= limits.min && input.amountMinor <= limits.max;
}
function moneyLimitMessage(currency = "NGN") {
    const limits = getMoneyLimits(currency);
    return `amountMinor must be between ${limits.min} and ${limits.max} for ${currency}`;
}
