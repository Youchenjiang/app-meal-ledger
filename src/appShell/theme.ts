// Theme preference for the app shell: 深色 default, 淺色, or 跟隨系統.
// See docs/specs/settings/design.md (Theme), the settings restructure plan,
// and ADR 0006 for the shell navigation. The resolved theme is applied to the
// <html data-theme> attribute and drives the CSS variables in styles.css.
export type ThemeMode = "dark" | "light" | "system";

export const DEFAULT_THEME_MODE: ThemeMode = "dark";

const THEME_KEY = "mealledger.settings.theme";

const MODES: readonly ThemeMode[] = ["dark", "light", "system"];

export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

export function readStoredTheme(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return isThemeMode(stored) ? stored : DEFAULT_THEME_MODE;
  } catch {
    return DEFAULT_THEME_MODE;
  }
}

export function writeStoredTheme(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_KEY, mode);
  } catch {
    // Persistence is best-effort; the resolved theme still applies this session.
  }
}

export function systemPrefersDark(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveTheme(mode: ThemeMode): "dark" | "light" {
  if (mode === "system") {
    return systemPrefersDark() ? "dark" : "light";
  }
  return mode;
}

export function applyResolvedTheme(resolved: "dark" | "light"): void {
  document.documentElement.dataset.theme = resolved;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", resolved === "dark" ? "#171a1c" : "#f5f2ec");
  }
}
