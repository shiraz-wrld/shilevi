const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function formatMoney(minor: number | null | undefined, currency = "KES") {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return "Ask for price";
  const code = CURRENCY_PATTERN.test(currency) ? currency : "KES";
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: code,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

export function minorToInput(minor: number | null | undefined) {
  if (minor === null || minor === undefined || !Number.isFinite(minor)) return "";
  return (minor / 100).toFixed(2);
}
