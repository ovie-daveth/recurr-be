import { z } from "zod";

export const SUPPORTED_CURRENCIES = ["NGN"] as const;

export const MONEY_LIMITS_MINOR: Record<
  (typeof SUPPORTED_CURRENCIES)[number],
  { min: number; max: number }
> = {
  NGN: {
    min: 100,
    max: 500_000_000,
  },
};

export const supportedCurrencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .pipe(z.enum(SUPPORTED_CURRENCIES));

export function getMoneyLimits(currency: (typeof SUPPORTED_CURRENCIES)[number]) {
  return MONEY_LIMITS_MINOR[currency];
}

export function validateAmountMinorForCurrency(input: {
  amountMinor?: number;
  currency?: string;
}) {
  if (typeof input.amountMinor === "undefined") {
    return true;
  }

  const currency = (input.currency ?? "NGN") as (typeof SUPPORTED_CURRENCIES)[number];
  const limits = getMoneyLimits(currency);

  return input.amountMinor >= limits.min && input.amountMinor <= limits.max;
}

export function moneyLimitMessage(currency = "NGN") {
  const limits = getMoneyLimits(currency as (typeof SUPPORTED_CURRENCIES)[number]);
  return `amountMinor must be between ${limits.min} and ${limits.max} for ${currency}`;
}
