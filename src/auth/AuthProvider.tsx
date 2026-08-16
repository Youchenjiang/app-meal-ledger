import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { DependencyList, Dispatch, EffectCallback, ReactNode, SetStateAction } from "react";
import type { AuthState } from "../types";
import { t } from "../i18n";
import { authRedirectBaseUrl, isLocalDevelopmentMode, supabase } from "../lib/supabase";
import { linkIdentity, recoverPasswordFromLink, requestPasswordReset, restoreOAuthCallbackSession, signInWithOAuth, signInWithPassword, signUpWithPassword, unlinkIdentity, updatePassword, type LinkedIdentity, type OAuthProvider } from "./authActions";

type AuthContextValue = {
  state: AuthState;
  userId: string;
  email: string;
  message: string;
  configurationError: boolean;
  signIn: (email?: string, password?: string) => Promise<void>;
  signUp: (email?: string, password?: string) => Promise<void>;
  requestPasswordReset: (email?: string) => Promise<void>;
  recoverPasswordFromLink: (link?: string) => Promise<void>;
  updatePassword: (password?: string) => Promise<void>;
  signInWithOAuth: (provider: OAuthProvider) => Promise<void>;
  identities: LinkedIdentity[];
  linkIdentity: (provider: OAuthProvider) => Promise<void>;
  unlinkIdentity: (identity: LinkedIdentity) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : t("auth.fallback");
}

const configurationError = !isLocalDevelopmentMode && !supabase;

function configurationMessage(): string {
  return t("auth.configurationError");
}

function useStableEffect(effect: EffectCallback, dependencies: DependencyList): void {
  useEffect(effect, dependencies);
}

type SessionLike = { user?: { id?: string; identities?: LinkedIdentity[] } } | null;

function initialAuthState(): AuthState {
  if (isLocalDevelopmentMode) {
    return "signed-out";
  }
  return configurationError ? "auth-error" : "loading";
}

function applySession(
  session: SessionLike,
  setUserId: Dispatch<SetStateAction<string>>,
  setIdentities: Dispatch<SetStateAction<LinkedIdentity[]>>,
  setState: Dispatch<SetStateAction<AuthState>>,
): void {
  setUserId(session?.user?.id ?? "");
  setIdentities(session?.user?.identities ?? []);
  setState(session ? "signed-in" : "signed-out");
}

// Strip trailing slashes without a regex: simple, linear, and analyzer-friendly.
function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
}

function authRedirect(): string {
  // OAuth popups must return to the document that opened them, so their
  // callback targets the current instance unless a public URL is configured.
  const base = stripTrailingSlashes(authRedirectBaseUrl || window.location.origin);
  return `${base}/account`;
}

function passwordResetRedirect(): string | undefined {
  // Reset emails are opened later, possibly on another device, so they must
  // link to a stable public page. When no public URL is configured, omit
  // redirectTo entirely so Supabase links the email to its Site URL (the live
  // deployment in the dashboard) instead of a local instance.
  if (!authRedirectBaseUrl) return undefined;
  return `${stripTrailingSlashes(authRedirectBaseUrl)}/account`;
}

function clearAuthCallbackHash(): void {
  // PKCE recovery links arrive in the query string (?token_hash=...&type=recovery)
  // rather than the implicit-grant fragment; strip both so a reload does not
  // try to redeem the single-use token again.
  const url = new URL(window.location.href);
  url.hash = "";
  url.searchParams.delete("token_hash");
  url.searchParams.delete("type");
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

export function AuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [state, setState] = useState<AuthState>(initialAuthState);
  const [userId, setUserId] = useState(isLocalDevelopmentMode ? "local-user" : "");
  const [identities, setIdentities] = useState<LinkedIdentity[]>([]);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState(configurationError ? configurationMessage() : "");
  // While a recovery link is being restored, supabase-js may still emit the
  // stored session as INITIAL_SESSION or SIGNED_IN after the app has already
  // switched to the password-recovery view; those late events must not
  // override the recovery state.
  const recoveryStartup = useRef(false);

  useStableEffect(() => {
    if (isLocalDevelopmentMode || !supabase) {
      return () => undefined;
    }

    const client = supabase;
    let mounted = true;
    const handleSession = (event: string, session: SessionLike): void => {
      if (!mounted) return;
      if (event === "PASSWORD_RECOVERY" && session) {
        setUserId(session.user?.id ?? "");
        setState("password-recovery");
        return;
      }
      if (recoveryStartup.current && (event === "INITIAL_SESSION" || event === "SIGNED_IN")) {
        return;
      }
      applySession(session, setUserId, setIdentities, setState);
    };

    const restoreSession = async (): Promise<void> => {
      const callback = await restoreOAuthCallbackSession(client, window.location.href);
      if (callback.handled) {
        clearAuthCallbackHash();
        if (callback.recovery) {
          recoveryStartup.current = true;
          if (callback.result.ok) {
            handleSession("PASSWORD_RECOVERY", callback.result.session);
          } else if (mounted) {
            setState("auth-error");
            setMessage(callback.result.message);
          }
          return;
        }
        if (callback.result.ok) {
          handleSession("SIGNED_IN", callback.result.session);
        } else if (mounted) {
          setState("auth-error");
          setMessage(callback.result.message);
        }
        return;
      }

      const { data, error } = await client.auth.getSession();
      if (error) {
        if (mounted) {
          setState("auth-error");
          setMessage(errorMessage(error));
        }
        return;
      }
      handleSession("INITIAL_SESSION", data.session);
    };
    restoreSession().catch((error: unknown) => {
      if (mounted) {
        setState("auth-error");
        setMessage(errorMessage(error));
      }
    });

    const authStateChange = client.auth.onAuthStateChange((event, session) => {
      handleSession(event, session);
    });

    const cleanupAuthSubscription = (): void => {
      mounted = false;
      authStateChange.data.subscription.unsubscribe();
    };
    return cleanupAuthSubscription;
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    state,
    userId,
    email,
    message,
    configurationError,
    signIn: async (requestedEmail = "", password = "") => {
      const normalizedEmail = requestedEmail.trim();
      setEmail(normalizedEmail);
      setMessage("");
      recoveryStartup.current = false;

      if (isLocalDevelopmentMode) {
        setUserId("local-user");
        setState("signed-in");
        return;
      }

      if (!supabase) {
        setState("auth-error");
        setMessage(configurationMessage());
        return;
      }

      setState("loading");
      const result = await signInWithPassword(supabase, normalizedEmail, password);
      if (!result.ok) {
        setState("auth-error");
        setMessage(result.message);
        return;
      }

      applySession(result.session, setUserId, setIdentities, setState);
      setMessage("");
    },
    signUp: async (requestedEmail = "", password = "") => {
      const normalizedEmail = requestedEmail.trim();
      setEmail(normalizedEmail);
      setMessage("");
      recoveryStartup.current = false;

      if (isLocalDevelopmentMode) {
        setUserId("local-user");
        setState("signed-in");
        return;
      }

      if (!supabase) {
        setState("auth-error");
        setMessage(configurationMessage());
        return;
      }

      setState("loading");
      const result = await signUpWithPassword(supabase, normalizedEmail, password);
      if (!result.ok) {
        setState("auth-error");
        setMessage(result.message);
        return;
      }

      applySession(result.session, setUserId, setIdentities, setState);
      setMessage("");
    },
    requestPasswordReset: async (requestedEmail = "") => {
      const normalizedEmail = requestedEmail.trim();
      setEmail(normalizedEmail);
      setMessage("");
      if (isLocalDevelopmentMode) {
        setMessage(t("auth.resetNeedsConfig"));
        return;
      }
      if (!supabase) {
        setState("auth-error");
        setMessage(configurationMessage());
        return;
      }
      const result = await requestPasswordReset(supabase, normalizedEmail, passwordResetRedirect());
      setState(result.ok ? "signed-out" : "auth-error");
      setMessage(result.message);
    },
    recoverPasswordFromLink: async (link = "") => {
      setMessage("");
      if (isLocalDevelopmentMode) {
        setMessage(t("auth.resetNeedsConfig"));
        return;
      }
      if (!supabase) {
        setState("auth-error");
        setMessage(configurationMessage());
        return;
      }
      const callback = await recoverPasswordFromLink(supabase, link.trim());
      if (!callback.handled) {
        setState("auth-error");
        setMessage(t("auth.resetLinkInvalid"));
        return;
      }
      if (!callback.result.ok) {
        setState("auth-error");
        setMessage(callback.result.message);
        return;
      }
      if (callback.recovery) {
        recoveryStartup.current = true;
        setUserId(callback.result.session?.user?.id ?? "");
        setState("password-recovery");
        return;
      }
      applySession(callback.result.session, setUserId, setIdentities, setState);
    },
    updatePassword: async (password = "") => {
      if (!supabase) {
        setState("auth-error");
        setMessage(configurationMessage());
        return;
      }
      const result = await updatePassword(supabase, password);
      if (result.ok) {
        recoveryStartup.current = false;
        setState("signed-in");
      } else {
        setState("password-recovery");
      }
      setMessage(result.message);
    },
    signInWithOAuth: async (provider) => {
      setMessage("");
      if (isLocalDevelopmentMode) {
        setMessage(t("auth.oauthNeedsConfig", { provider }));
        return;
      }
      if (!supabase) {
        setState("auth-error");
        setMessage(configurationMessage());
        return;
      }
      const result = await signInWithOAuth(supabase, provider, authRedirect());
      setState(result.ok ? "loading" : "auth-error");
      setMessage(result.message);
    },
    identities,
    linkIdentity: async (provider) => {
      setMessage("");
      if (isLocalDevelopmentMode) {
        setMessage(t("auth.linkNeedsConfig", { provider }));
        return;
      }
      if (!supabase) {
        setState("auth-error");
        setMessage(configurationMessage());
        return;
      }
      const result = await linkIdentity(supabase, provider, authRedirect());
      setMessage(result.message);
    },
    unlinkIdentity: async (identity) => {
      setMessage("");
      if (isLocalDevelopmentMode) {
        setMessage(t("auth.unlinkNeedsConfig"));
        return;
      }
      if (!supabase) {
        setState("auth-error");
        setMessage(configurationMessage());
        return;
      }
      const result = await unlinkIdentity(supabase, identity);
      setMessage(result.message);
    },
    signOut: async () => {
      recoveryStartup.current = false;
      if (isLocalDevelopmentMode) {
        setUserId("local-user");
        setState("signed-out");
        return;
      }

      if (!supabase) {
        setState("auth-error");
        setMessage(configurationMessage());
        return;
      }

      const { error } = await supabase.auth.signOut();
      if (error) {
        setState("auth-error");
        setMessage(errorMessage(error));
        return;
      }
      setUserId("");
      setState("signed-out");
    },
  }), [email, identities, message, state, userId]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
