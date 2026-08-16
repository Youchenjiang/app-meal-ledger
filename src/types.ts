import type { LucideIcon } from "lucide-react";

export type AppRoute =
  | "overview"
  | "ledger"
  | "capture"
  | "zone"
  | "settings"
  | "not-found";

export type AppLocation = {
  route: AppRoute;
  params: Readonly<Record<string, string>>;
};

export type AuthState = "loading" | "signed-out" | "signed-in" | "password-recovery" | "auth-error";

export type NavItem = {
  route: Exclude<AppRoute, "not-found">;
  // Copy dictionary key resolved at render time so the navigation labels
  // follow the selected locale (see src/i18n).
  labelKey: string;
  path: string;
  icon: LucideIcon;
};
