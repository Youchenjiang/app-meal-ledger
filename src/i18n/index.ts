// Localization core per docs/specs/localization/design.md.
//
// Language is a UI preference, not ledger data: labels, helper text, app-owned
// validation messages, and navigation text resolve through the copy dictionary.
// User-entered account / category / merchant / note / tag names are never
// translated here.
//
// The dictionary is keyed by stable copy keys grouped by surface (nav.*,
// auth.*, overview.*, ledger.*, capture.*, settings.*, status.*, validation.*,
// ...). zh-TW is the primary product language; en-US is the fallback used for
// development review and for users whose browser is not Chinese.

import { enUS } from "./dictionaries/enUS";
import { zhTW } from "./dictionaries/zhTW";

export type LocaleCode = "zh-TW" | "en-US";

export const SUPPORTED_LOCALES: readonly LocaleCode[] = ["zh-TW", "en-US"];

export const LOCALE_STORAGE_KEY = "mealledger.locale";

export function isLocaleCode(value: unknown): value is LocaleCode {
  return value === "zh-TW" || value === "en-US";
}

// <html lang> attribute value for each locale.
export function documentLang(locale: LocaleCode): string {
  return locale === "zh-TW" ? "zh-Hant" : "en";
}

function isStorageAvailable(): boolean {
  try {
    return typeof window !== "undefined" && Boolean(window.localStorage);
  } catch {
    return false;
  }
}

export function readStoredLocale(): LocaleCode | null {
  if (!isStorageAvailable()) return null;
  try {
    const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocaleCode(value) ? value : null;
  } catch {
    return null;
  }
}

function writeStoredLocale(locale: LocaleCode): void {
  if (!isStorageAvailable()) return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Persisting the preference is best effort; the session still switches.
  }
}

// Spec: "WHEN no language preference exists THE SYSTEM SHALL default to
// zh-TW for users whose browser language starts with zh, and en-US otherwise."
export function detectBrowserLocale(): LocaleCode {
  if (typeof navigator === "undefined") return "zh-TW";
  return navigator.language.toLowerCase().startsWith("zh") ? "zh-TW" : "en-US";
}

export function resolveInitialLocale(): LocaleCode {
  return readStoredLocale() ?? detectBrowserLocale();
}

type Dictionary = Record<string, string>;

function interpolate(value: string, params?: Readonly<Record<string, string | number>>): string {
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (match, name: string) => {
    return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match;
  });
}

// Fallback chain: selected locale -> en-US -> development marker (or the raw
// key outside development so a missing key never renders as empty text).
export function translate(locale: LocaleCode, key: string, params?: Readonly<Record<string, string | number>>): string {
  const dictionary = locale === "zh-TW" ? zhTW : enUS;
  let value: string | undefined = dictionary[key];
  if (value === undefined && locale !== "en-US") {
    value = enUS[key];
  }
  if (value === undefined) {
    value = import.meta.env.DEV ? `[missing:${key}]` : key;
  }
  return interpolate(value, params);
}

// --- Module store -----------------------------------------------------------
// Non-React modules (validation, sync, import) call the bare t() helper and
// always read the current locale. The React provider keeps this store in sync
// so components re-render on switch while plain modules stay locale-aware.

let currentLocale: LocaleCode = resolveInitialLocale();
const listeners = new Set<() => void>();

export function getLocale(): LocaleCode {
  return currentLocale;
}

export function t(key: string, params?: Readonly<Record<string, string | number>>): string {
  return translate(currentLocale, key, params);
}

export function setLocale(locale: LocaleCode): void {
  if (!isLocaleCode(locale) || locale === currentLocale) return;
  currentLocale = locale;
  writeStoredLocale(locale);
  if (typeof document !== "undefined") {
    document.documentElement.lang = documentLang(locale);
  }
  for (const listener of listeners) listener();
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
