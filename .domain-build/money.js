"use strict";
/**
 * Money is always stored and calculated in integer minor units.
 * Never use floating point for a stored amount.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MINOR_UNITS_PER_MAJOR = void 0;
exports.isSafeMinor = isSafeMinor;
exports.assertMinor = assertMinor;
exports.roundHalfUp = roundHalfUp;
exports.roundToStep = roundToStep;
exports.sumMinor = sumMinor;
exports.formatMoney = formatMoney;
exports.parseMajorToMinor = parseMajorToMinor;
exports.minorToMajorString = minorToMajorString;
exports.MINOR_UNITS_PER_MAJOR = 100;
function isSafeMinor(value) {
    return Number.isSafeInteger(value) && value >= 0;
}
function assertMinor(value, label = "amount") {
    if (!isSafeMinor(value)) {
        throw new Error(`${label} must be a non-negative safe integer in minor units.`);
    }
}
function roundHalfUp(value) {
    if (!Number.isFinite(value))
        throw new Error("Cannot round a non-finite amount.");
    return Math.floor(value + 0.5);
}
/**
 * Round a minor-unit amount to a step expressed in minor units.
 * stepMinor = 100 rounds to the nearest whole shilling.
 */
function roundToStep(value, stepMinor) {
    if (!Number.isFinite(value))
        throw new Error("Cannot round a non-finite amount.");
    if (!Number.isSafeInteger(stepMinor) || stepMinor < 1) {
        throw new Error("Rounding step must be a positive integer in minor units.");
    }
    return roundHalfUp(value / stepMinor) * stepMinor;
}
function sumMinor(values) {
    return values.reduce((total, value) => {
        assertMinor(value);
        return total + value;
    }, 0);
}
function formatMoney(amountMinor, currency = "KES", locale = "en-KE") {
    assertMinor(amountMinor, "amountMinor");
    const safeCurrency = /^[A-Z]{3}$/.test(currency) ? currency : "KES";
    return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: safeCurrency,
        maximumFractionDigits: 2,
    }).format(amountMinor / exports.MINOR_UNITS_PER_MAJOR);
}
/**
 * Parse a user-entered major amount (for example "1,500.50") into minor units.
 * Returns null when the input is not a valid non-negative amount with at most
 * two decimal places.
 */
function parseMajorToMinor(input) {
    const raw = String(input).trim().replace(/,/g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(raw))
        return null;
    const [whole, fraction = ""] = raw.split(".");
    const wholeMinor = Number(whole) * exports.MINOR_UNITS_PER_MAJOR;
    const fractionMinor = Number((fraction + "00").slice(0, 2));
    const total = wholeMinor + fractionMinor;
    return Number.isSafeInteger(total) ? total : null;
}
function minorToMajorString(amountMinor) {
    assertMinor(amountMinor, "amountMinor");
    return (amountMinor / exports.MINOR_UNITS_PER_MAJOR).toFixed(2);
}
