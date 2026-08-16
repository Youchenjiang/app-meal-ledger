import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";
import { setLocale } from "../i18n";

// The localization spec defaults zh-TW for browsers whose language starts
// with "zh". The happy-dom test environment reports en-US, which would make
// the i18n store default to English and break zh-TW assertions; pin the test
// browser language so the detection path behaves like a Chinese user.
Object.defineProperty(navigator, "language", {
  configurable: true,
  get: () => "zh-TW",
});

// The i18n store is module-level, so a test that switches locale (e.g. the
// language switcher test) would leak en-US into later tests even though each
// test file clears localStorage. Reset the store before every test so tests
// always start from the zh-TW baseline.
beforeEach(() => {
  setLocale("zh-TW");
});
