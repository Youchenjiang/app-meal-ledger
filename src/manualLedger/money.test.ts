import { describe, expect, test } from "vitest";
import { formatAmount, formatAmountString, isPositiveMoney, minorUnitsToMajorNumber, parseMinorUnits } from "./money";

describe("minor-unit money boundaries", () => {
  test("enforces currency precision", () => {
    expect(parseMinorUnits("100", "TWD")).toBe(100n);
    expect(parseMinorUnits("0.5", "TWD")).toBeNull();
    expect(parseMinorUnits("0.5", "JPY")).toBeNull();
    expect(parseMinorUnits("0.10", "USD")).toBe(10n);
    expect(parseMinorUnits("0.001", "USD")).toBeNull();
  });

  test("represents decimal arithmetic without floating point drift", () => {
    const total = (parseMinorUnits("0.1", "USD") ?? 0n) + (parseMinorUnits("0.2", "USD") ?? 0n);
    expect(minorUnitsToMajorNumber(total, "USD")).toBe(0.3);
    expect(isPositiveMoney("0.01", "USD")).toBe(true);
  });
});

describe("amount formatting", () => {
  test("groups thousands on every surface", () => {
    expect(formatAmount(1234567, "TWD")).toBe("TWD 1,234,567");
    expect(formatAmount(5000, "TWD")).toBe("TWD 5,000");
    expect(formatAmount(320, "TWD")).toBe("TWD 320");
    expect(formatAmount(-1234567, "TWD")).toBe("TWD -1,234,567");
  });

  test("formats a stored amount string exactly like a summed total", () => {
    // The row holds a string straight off the record and the subtotal holds a
    // sum, so this is where the two surfaces can drift apart.
    expect(formatAmountString("1234567", "TWD")).toBe(formatAmount(1234567, "TWD"));
    expect(formatAmountString("98765.43", "USD")).toBe("USD 98,765.43");
    expect(formatAmountString("5000", "JPY")).toBe("JPY 5,000");
  });

  test("keeps a value it cannot parse readable instead of printing NaN", () => {
    expect(formatAmountString("", "TWD")).toBe("TWD");
    expect(formatAmountString("not-a-number", "TWD")).toBe("TWD not-a-number");
    // A record may predate a currency's precision rule; do not silently rewrite it.
    expect(formatAmountString("1.234", "USD")).toBe("USD 1.234");
  });
});
