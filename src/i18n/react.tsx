import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getLocale, setLocale as applyLocale, subscribeLocale, translate, type LocaleCode } from "./index";

type I18nContextValue = {
  locale: LocaleCode;
  setLocale: (locale: LocaleCode) => void;
  t: (key: string, params?: Readonly<Record<string, string | number>>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function LanguageProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [locale, setLocaleState] = useState<LocaleCode>(getLocale);

  useEffect(() => subscribeLocale(() => setLocaleState(getLocale())), []);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale: (next) => applyLocale(next),
    t: (key, params) => translate(locale, key, params),
  }), [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside LanguageProvider");
  return context;
}
