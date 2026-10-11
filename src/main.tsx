import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { documentLang, getLocale } from "./i18n";
import { LanguageProvider } from "./i18n/react";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("MealLedger root element is missing.");
}

// Apply the persisted/browser-detected locale to <html lang> before the first
// render so the document language never flashes the default.
document.documentElement.lang = documentLang(getLocale());

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </React.StrictMode>,
);
