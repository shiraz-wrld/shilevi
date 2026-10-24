/**
 * Money is always stored and calculated in integer minor units.
 * Never use floating point for a stored amount.
 */

export const MINOR_UNITS_PER_MAJOR = 100;

export function isSafeMinor(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function assertMinor(value: number, label = "amount"): void {
  if (!isSafeMinor(value)) {
    throw new Error(`${label} must be a non-negative safe integer in minor units.`);
  }
}

export function roundHalfUp(value: number): number {
  if (!Number.isFinite(value)) throw new Error("Cannot round a non-finite amount.");
  return Math.floor(value + 0.5);
}

/**
 * Round a minor-unit amount to a step expressed in minor units.
 * stepMinor = 100 rounds to the nearest whole shilling.
 */
export function roundToStep(value: number, stepMinor: number): number {
  if (!Number.isFinite(value)) throw new Error("Cannot round a non-finite amount.");
  if (!Number.isSafeInteger(stepMinor) || stepMinor < 1) {
    throw new Error("Rounding step must be a positive integer in minor units.");
  }
  return roundHalfUp(value / stepMinor) * stepMinor;
}

export function sumMinor(values: readonly number[]): number {
  return values.reduce((total, value) => {
    assertMinor(value);
    return total + value;
  }, 0);
}

export function formatMoney(amountMinor: number, currency = "KES", locale = "en-KE"): string {
  assertMinor(amountMinor, "amountMinor");
  const safeCurrency = /^[A-Z]{3}$/.test(currency) ? currency : "KES";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: safeCurrency,
    maximumFractionDigits: 2,
  }).format(amountMinor / MINOR_UNITS_PER_MAJOR);
}

/**
 * Parse a user-entered major amount (for example "1,500.50") into minor units.
 * Returns null when the input is not a valid non-negative amount with at most
 * two decimal places.
 */
export function parseMajorToMinor(input: string | number): number | null {
  const raw = String(input).trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  const wholeMinor = Number(whole) * MINOR_UNITS_PER_MAJOR;
  const fractionMinor = Number((fraction + "00").slice(0, 2));
  const total = wholeMinor + fractionMinor;
  return Number.isSafeInteger(total) ? total : null;
}

export function minorToMajorString(amountMinor: number): string {
  assertMinor(amountMinor, "amountMinor");
  return (amountMinor / MINOR_UNITS_PER_MAJOR).toFixed(2);
}
