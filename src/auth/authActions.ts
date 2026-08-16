export type PasswordAuthClient = {
  auth: {
    signInWithPassword: (options: { email: string; password: string }) => Promise<{ data: { session?: PasswordSession } | null; error: unknown }>;
  };
};

export type PasswordRegistrationClient = {
  auth: {
    signUp: (options: { email: string; password: string }) => Promise<{ data: { session?: PasswordSession } | null; error: unknown }>;
  };
};

export type PasswordResetClient = {
  auth: {
    resetPasswordForEmail: (email: string, options?: { redirectTo?: string }) => Promise<{ error: unknown }>;
    updateUser: (attributes: { password: string }) => Promise<{ error: unknown }>;
  };
};

export type OAuthProvider = "google" | "facebook";

export type OAuthClient = {
  auth: {
    signInWithOAuth: (options: { provider: OAuthProvider; options: { redirectTo: string } }) => Promise<{ error: unknown }>;
  };
};

export type OAuthCallbackClient = {
  auth: {
    setSession: (session: { access_token: string; refresh_token: string }) => Promise<{ data: { session?: PasswordSession } | null; error: unknown }>;
    // PKCE projects send recovery links with ?token_hash=...&type=recovery
    // instead of the implicit-grant #access_token=... fragment; the token is
    // redeemed with verifyOtp rather than setSession.
    verifyOtp?: (options: { token_hash: string; type: "recovery" }) => Promise<{ data: { session?: PasswordSession } | null; error: unknown }>;
  };
};

export type LinkedIdentity = {
  id: string;
  user_id: string;
  identity_id: string;
  provider: string;
  provider_id?: string;
};

export type IdentityLinkClient = {
  auth: {
    linkIdentity: (options: { provider: OAuthProvider; options: { redirectTo: string } }) => Promise<{ error: unknown }>;
    unlinkIdentity: (identity: LinkedIdentity) => Promise<{ error: unknown }>;
  };
};

import { t } from "../i18n";

export type PasswordSession = { user?: { id?: string } } | null;
export type PasswordAuthResult = { ok: true; session: PasswordSession } | { ok: false; message: string };

function validatePasswordCredentials(email: string, password: string): PasswordAuthResult | null {
  const normalizedEmail = email.trim();
  if (!normalizedEmail) {
    return { ok: false, message: t("auth.emailRequired") };
  }
  if (!password.trim()) {
    return { ok: false, message: t("auth.passwordRequired") };
  }
  return null;
}

function authFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : t("auth.failed");
}

export function alreadyRegisteredMessage(): string {
  return t("auth.alreadyRegistered");
}

function isAlreadyRegisteredError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  if (message.includes("already registered") || message.includes("already exists")) return true;
  return (error as { code?: unknown }).code === "user_already_exists";
}

export async function signInWithPassword(client: PasswordAuthClient, email: string, password: string): Promise<PasswordAuthResult> {
  const invalid = validatePasswordCredentials(email, password);
  if (invalid) return invalid;

  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error) {
    return { ok: false, message: authFailureMessage(error) };
  }
  if (!data?.session) {
    return { ok: false, message: t("auth.noSession") };
  }

  return { ok: true, session: data.session };
}

export async function signUpWithPassword(client: PasswordRegistrationClient, email: string, password: string): Promise<PasswordAuthResult> {
  const invalid = validatePasswordCredentials(email, password);
  if (invalid) return invalid;

  const { data, error } = await client.auth.signUp({ email: email.trim(), password });
  if (error) {
    if (isAlreadyRegisteredError(error)) {
      return { ok: false, message: alreadyRegisteredMessage() };
    }
    return { ok: false, message: authFailureMessage(error) };
  }
  if (!data?.session) {
    return { ok: false, message: t("auth.signUpVerifyEmail") };
  }
  return { ok: true, session: data.session };
}

export async function requestPasswordReset(client: PasswordResetClient, email: string, redirectTo?: string): Promise<{ ok: boolean; message: string }> {
  if (!email.trim()) return { ok: false, message: t("auth.emailRequired") };
  // Without redirectTo, Supabase links the reset email to its Site URL — the
  // live deployment configured in the dashboard — instead of whatever local
  // instance sent the request.
  const { error } = await client.auth.resetPasswordForEmail(email.trim(), redirectTo ? { redirectTo } : {});
  if (error) {
    const message = authFailureMessage(error);
    if (message.toLowerCase().includes("rate limit")) {
      // Supabase's default email service caps sends at 2/hour; surface the
      // platform limit clearly instead of a bare error string.
      return {
        ok: false,
        message: t("auth.rateLimited"),
      };
    }
    return { ok: false, message };
  }
  return { ok: true, message: t("auth.resetSent") };
}

export async function updatePassword(client: PasswordResetClient, password: string): Promise<{ ok: boolean; message: string }> {
  if (!password.trim()) return { ok: false, message: t("auth.passwordRequired") };
  const { error } = await client.auth.updateUser({ password });
  return error
    ? { ok: false, message: authFailureMessage(error) }
    : { ok: true, message: t("auth.passwordUpdated") };
}

export async function signInWithOAuth(client: OAuthClient, provider: OAuthProvider, redirectTo: string): Promise<{ ok: boolean; message: string }> {
  const { error } = await client.auth.signInWithOAuth({ provider, options: { redirectTo } });
  return error
    ? { ok: false, message: authFailureMessage(error) }
    : { ok: true, message: t("auth.oauthOpening", { provider }) };
}

export async function linkIdentity(client: IdentityLinkClient, provider: OAuthProvider, redirectTo: string): Promise<{ ok: boolean; message: string }> {
  const { error } = await client.auth.linkIdentity({ provider, options: { redirectTo } });
  return error
    ? { ok: false, message: authFailureMessage(error) }
    : { ok: true, message: t("auth.oauthOpening", { provider }) };
}

export async function unlinkIdentity(client: IdentityLinkClient, identity: LinkedIdentity): Promise<{ ok: boolean; message: string }> {
  const { error } = await client.auth.unlinkIdentity(identity);
  return error
    ? { ok: false, message: authFailureMessage(error) }
    : { ok: true, message: t("auth.oauthRemoved", { provider: identity.provider }) };
}

export type OAuthCallbackResult =
  | { handled: false }
  | { handled: true; recovery: boolean; result: PasswordAuthResult };

export type RecoveryLinkResult =
  | { handled: false }
  | { handled: true; recovery: boolean; result: PasswordAuthResult };

// Manual fallback for embedded webviews where the reset email / OAuth callback
// opens in the OS browser instead of this document: the user pastes the full
// callback link and the recovery session is restored here, so the flow finishes
// in the app instead of being stranded in the browser.
export async function recoverPasswordFromLink(client: OAuthCallbackClient, href: string): Promise<RecoveryLinkResult> {
  try {
    return await restoreOAuthCallbackSession(client, href);
  } catch {
    // An unparsable pasted string (e.g. a plain email address) is not a link.
    return { handled: false };
  }
}

export async function restoreOAuthCallbackSession(client: OAuthCallbackClient, href: string): Promise<OAuthCallbackResult> {
  const url = new URL(href);
  // PKCE links carry token_hash in the query string; implicit-grant callbacks
  // carry access_token/refresh_token in the fragment. Read both.
  const params = new URLSearchParams([...url.searchParams, ...new URLSearchParams(url.hash.slice(1))]);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const tokenHash = params.get("token_hash");
  // Password-recovery links land with the same implicit-grant hash as OAuth
  // callbacks plus `type=recovery`. The caller maps these to the
  // password-recovery state instead of a sign-in so the new-password form shows.
  const recovery = params.get("type") === "recovery";
  if (tokenHash && recovery && client.auth.verifyOtp) {
    const { data, error } = await client.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
    if (error) return { handled: true, recovery: true, result: { ok: false, message: authFailureMessage(error) } };
    if (!data?.session) {
      return { handled: true, recovery: true, result: { ok: false, message: t("auth.noSession") } };
    }
    return { handled: true, recovery: true, result: { ok: true, session: data.session } };
  }
  if (!accessToken || !refreshToken) return { handled: false };

  const { data, error } = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (error) return { handled: true, recovery, result: { ok: false, message: authFailureMessage(error) } };
  if (!data?.session) {
    return { handled: true, recovery, result: { ok: false, message: t("auth.noSession") } };
  }
  return { handled: true, recovery, result: { ok: true, session: data.session } };
}
