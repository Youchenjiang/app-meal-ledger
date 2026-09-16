const zeroDecimalCurrencies = new Set(["TWD", "JPY"]);

export function currencyPrecision(currency: string): number {
  return zeroDecimalCurrencies.has(currency.trim().toUpperCase()) ? 0 : 2;
}

export function parseMinorUnits(value: string, currency: string): bigint | null {
  const normalized = value.trim().replace(/,/g, "");
  const precision = currencyPrecision(currency);
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return null;

  const fraction = match[3] ?? "";
  if (fraction.length > precision) return null;

  const scale = 10n ** BigInt(precision);
  const fractionUnits = BigInt((fraction + "0".repeat(precision)).slice(0, precision) || "0");
  const units = BigInt(match[2]) * scale + fractionUnits;
  return match[1] === "-" ? -units : units;
}

export function isPositiveMoney(value: string, currency: string): boolean {
  const minorUnits = parseMinorUnits(value, currency);
  return minorUnits !== null && minorUnits > 0n;
}

export function isNonZeroMoney(value: string, currency: string): boolean {
  const minorUnits = parseMinorUnits(value, currency);
  return minorUnits !== null && minorUnits !== 0n;
}

export function minorUnitsToMajorNumber(minorUnits: bigint, currency: string): number {
  return Number(minorUnits) / 10 ** currencyPrecision(currency);
}

/**
 * The one place a money value becomes text. Every surface that shows an amount
 * calls this, so a ledger row and the section total above it cannot disagree on
 * grouping or decimals — which is the drift that left rows printing
 * `TWD 1234567` directly underneath a `小計 TWD 1,234,887`.
 */
export function formatAmount(value: number, currency: string): string {
  return `${currency} ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)}`;
}

/**
 * Formats an amount the way a record stores it (a decimal string). A value the
 * currency cannot represent falls back to the raw text rather than printing NaN.
 */
export function formatAmountString(amount: string, currency: string): string {
  const minorUnits = parseMinorUnits(amount, currency);
  if (minorUnits === null) {
    return `${currency} ${amount}`.trim();
  }
  return formatAmount(minorUnitsToMajorNumber(minorUnits, currency), currency);
}
