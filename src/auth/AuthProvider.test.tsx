import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

type SupabaseAuthMock = {
  getSession: ReturnType<typeof vi.fn>;
  onAuthStateChange: ReturnType<typeof vi.fn>;
  setSession: ReturnType<typeof vi.fn>;
  signInWithPassword: ReturnType<typeof vi.fn>;
  signUp: ReturnType<typeof vi.fn>;
  resetPasswordForEmail: ReturnType<typeof vi.fn>;
  updateUser: ReturnType<typeof vi.fn>;
  verifyOtp: ReturnType<typeof vi.fn>;
  signInWithOAuth: ReturnType<typeof vi.fn>;
  linkIdentity: ReturnType<typeof vi.fn>;
  unlinkIdentity: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
};

async function renderAuthHarness(authMock?: SupabaseAuthMock, redirectBase = "") {
  vi.resetModules();
  vi.doMock("../lib/supabase", () => ({
    isLocalDevelopmentMode: !authMock,
    isSupabaseConfigured: Boolean(authMock),
    supabase: authMock ? { auth: authMock } : null,
    authRedirectBaseUrl: redirectBase,
  }));

  const { AuthProvider, useAuth } = await import("./AuthProvider");

  function AuthHarness({ children }: Readonly<{ children?: ReactNode }>) {
    const auth = useAuth();
    return (
      <div>
        <output aria-label="auth-state">{auth.state}</output>
        <output aria-label="auth-user">{auth.userId}</output>
        <output aria-label="auth-message">{auth.message}</output>
        <button type="button" onClick={() => { auth.signIn(" user@example.com ", "secret").catch(() => undefined); }}>Sign in</button>
        <button type="button" onClick={() => { auth.signUp(" new@example.com ", "secret").catch(() => undefined); }}>Create account</button>
        <button type="button" onClick={() => { auth.requestPasswordReset(" user@example.com ").catch(() => undefined); }}>Reset password</button>
        <button type="button" onClick={() => { auth.updatePassword("new-secret").catch(() => undefined); }}>Update password</button>
        <button type="button" onClick={() => { auth.recoverPasswordFromLink("https://app.test/account#access_token=access&refresh_token=refresh&type=recovery").catch(() => undefined); }}>Recover from link</button>
        <button type="button" onClick={() => { auth.signInWithOAuth("google").catch(() => undefined); }}>Google sign in</button>
        <button type="button" onClick={() => { auth.linkIdentity("google").catch(() => undefined); }}>Link Google</button>
        <button type="button" onClick={() => { auth.unlinkIdentity({ id: "g1", user_id: "remote-user", identity_id: "g1", provider: "google" }).catch(() => undefined); }}>Unlink Google</button>
        <button type="button" onClick={() => { auth.signOut().catch(() => undefined); }}>Sign out</button>
        {children}
      </div>
    );
  }

  return render(<AuthProvider><AuthHarness /></AuthProvider>);
}

function createAuthMock(session: unknown = null): SupabaseAuthMock {
  return {
    getSession: vi.fn().mockResolvedValue({ data: { session }, error: null }),
    onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    setSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "remote-user" } } }, error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: { session: { user: { id: "remote-user" } } }, error: null }),
    signUp: vi.fn().mockResolvedValue({ data: { session: { user: { id: "new-user" } } }, error: null }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
    updateUser: vi.fn().mockResolvedValue({ error: null }),
    verifyOtp: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
    linkIdentity: vi.fn().mockResolvedValue({ error: null }),
    unlinkIdentity: vi.fn().mockResolvedValue({ error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  };
}

describe("auth provider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  test("supports local development sign in and sign out", async () => {
    const user = userEvent.setup();
    await renderAuthHarness();

    expect(screen.getByLabelText("auth-state")).toHaveTextContent("signed-out");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByLabelText("auth-state")).toHaveTextContent("signed-in");
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.getByLabelText("auth-state")).toHaveTextContent("signed-out");
  });

  test("uses a returned password session immediately", async () => {
    const user = userEvent.setup();
    const authMock = createAuthMock();
    await renderAuthHarness(authMock);

    await waitFor(() => expect(screen.getByLabelText("auth-state")).toHaveTextContent("signed-out"));
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(authMock.signInWithPassword).toHaveBeenCalledWith({ email: "user@example.com", password: "secret" });
    await waitFor(() => expect(screen.getByLabelText("auth-user")).toHaveTextContent("remote-user"));
    expect(screen.getByLabelText("auth-state")).toHaveTextContent("signed-in");
  });

  test("uses a returned sign-up session immediately", async () => {
    const user = userEvent.setup();
    const authMock = createAuthMock();
    await renderAuthHarness(authMock);

    await waitFor(() => expect(screen.getByLabelText("auth-state")).toHaveTextContent("signed-out"));
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(authMock.signUp).toHaveBeenCalledWith({ email: "new@example.com", password: "secret" });
    await waitFor(() => expect(screen.getByLabelText("auth-user")).toHaveTextContent("new-user"));
    expect(screen.getByLabelText("auth-state")).toHaveTextContent("signed-in");
  });

  test("returns to local-only when the provider sends an expired session", async () => {
    let authListener: (_event: string, session: unknown) => void = () => undefined;
    const authMock = createAuthMock({ user: { id: "remote-user" } });
    authMock.onAuthStateChange.mockImplementation((listener) => {
      authListener = listener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    await renderAuthHarness(authMock);

    await waitFor(() => expect(screen.getByLabelText("auth-state")).toHaveTextContent("signed-in"));
    act(() => authListener("SIGNED_OUT", null));

    await waitFor(() => expect(screen.getByLabelText("auth-state")).toHaveTextContent("signed-out"));
    expect(screen.getByLabelText("auth-user")).toHaveTextContent("");
  });

  test("keeps a provider failure actionable", async () => {
    const user = userEvent.setup();
    const authMock = createAuthMock();
    authMock.signInWithPassword.mockResolvedValue({ data: null, error: new Error("invalid login") });
    await renderAuthHarness(authMock);

    await waitFor(() => expect(screen.getByLabelText("auth-state")).toHaveTextContent("signed-out"));
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByLabelText("auth-state")).toHaveTextContent("auth-error"));
    expect(screen.getByLabelText("auth-message")).toHaveTextContent("invalid login");
  });

  test("uses the recovery session to update a password", async () => {
    let authListener: (_event: string, session: unknown) => void = () => undefined;
    const authMock = createAuthMock();
    authMock.onAuthStateChange.mockImplementation((listener) => {
      authListener = listener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    const user = userEvent.setup();
    await renderAuthHarness(authMock);

    await waitFor(() => expect(screen.getByLabelText("auth-state")).toHaveTextContent("signed-out"));
    act(() => authListener("PASSWORD_RECOVERY", { user: { id: "remote-user" } }));
    await waitFor(() => expect(screen.getByLabelText("auth-state")).toHaveTextContent("password-recovery"));
    await user.click(screen.getByRole("button", { name: "Update password" }));

    expect(authMock.updateUser).toHaveBeenCalledWith({ password: "new-secret" });
    await waitFor(() => expect(screen.getByLabelText("auth-state")).toHaveTextContent("signed-in"));
  });

  test("lands a password-recovery link on the recovery state instead of signing in", async () => {
    window.history.pushState(null, "", "/account#access_token=access&refresh_token=refresh&type=recovery");
    const authMock = createAuthMock();
    await renderAuthHarness(authMock);

    expect(authMock.setSession).toHaveBeenCalledWith({ access_token: "access", refresh_token: "refresh" });
    await waitFor(() => expect(screen.getByLabelText("auth-state")).toHaveTextContent("password-recovery"));
    expect(screen.getByLabelText("auth-user")).toHaveTextContent("remote-user");
    expect(window.location.hash).toBe("");

    window.history.pushState(null, "", "/");
  });

  test("lands a PKCE token_hash recovery link on the recovery state and clears it from the URL", async () => {
    const authMock = createAuthMock();
    authMock.verifyOtp = vi.fn().mockResolvedValue({ data: { session: { user: { id: "remote-user" } } }, error: null });
    window.history.pushState(null, "", "/account?token_hash=pkce-hash&type=recovery");
    await renderAuthHarness(authMock);

    expect(authMock.verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "pkce-hash" });
    await waitFor(() => expect(screen.getByLabelText("auth-state")).toHaveTextContent("password-recovery"));
    expect(screen.getByLabelText("auth-user")).toHaveTextContent("remote-user");
    expect(window.location.search).toBe("");

    window.history.pushState(null, "", "/");
  });

  test("lands a failed recovery link on auth-error instead of the form or a sign-in", async () => {
    window.history.pushState(null, "", "/account#access_token=expired&refresh_token=expired&type=recovery");
    const authMock = createAuthMock();
    authMock.setSession = vi.fn().mockResolvedValue({ data: { session: null }, error: new Error("expired recovery token") });
    await renderAuthHarness(authMock);

    await waitFor(() => expect(screen.getByLabelText("auth-state")).toHaveTextContent("auth-error"));
    expect(screen.getByLabelText("auth-message")).toHaveTextContent("expired recovery token");
    expect(screen.getByLabelText("auth-user")).toHaveTextContent("");

    window.history.pushState(null, "", "/");
  });

  test("keeps the recovery view when supabase-js emits a stored session afterwards", async () => {
    let authListener: (_event: string, session: unknown) => void = () => undefined;
    const authMock = createAuthMock();
    authMock.onAuthStateChange.mockImplementation((listener) => {
      authListener = listener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    window.history.pushState(null, "", "/account#access_token=access&refresh_token=refresh&type=recovery");
    await renderAuthHarness(authMock);

    await waitFor(() => expect(screen.getByLabelText("auth-state")).toHaveTextContent("password-recovery"));
    act(() => authListener("INITIAL_SESSION", { user: { id: "remote-user" } }));
    act(() => authListener("SIGNED_IN", { user: { id: "remote-user" } }));

    expect(screen.getByLabelText("auth-state")).toHaveTextContent("password-recovery");
    expect(screen.getByLabelText("auth-user")).toHaveTextContent("remote-user");

    window.history.pushState(null, "", "/");
  });

  test("starts an OAuth redirect through the same provider", async () => {
    const user = userEvent.setup();
    const authMock = createAuthMock();
    await renderAuthHarness(authMock);

    await waitFor(() => expect(screen.getByLabelText("auth-state")).toHaveTextContent("signed-out"));
    await user.click(screen.getByRole("button", { name: "Google sign in" }));

    expect(authMock.signInWithOAuth).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: `${window.location.origin}/account` } });
    expect(screen.getByLabelText("auth-state")).toHaveTextContent("loading");
  });

  test("finishes password recovery from a pasted reset link", async () => {
    const user = userEvent.setup();
    const authMock = createAuthMock();
    await renderAuthHarness(authMock);

    await waitFor(() => expect(screen.getByLabelText("auth-state")).toHaveTextContent("signed-out"));
    await user.click(screen.getByRole("button", { name: "Recover from link" }));

    expect(authMock.setSession).toHaveBeenCalledWith({ access_token: "access", refresh_token: "refresh" });
    await waitFor(() => expect(screen.getByLabelText("auth-state")).toHaveTextContent("password-recovery"));
    expect(screen.getByLabelText("auth-user")).toHaveTextContent("remote-user");
  });

  test("reports a pasted link without a recovery session", async () => {
    const user = userEvent.setup();
    const authMock = createAuthMock();
    authMock.setSession = vi.fn().mockResolvedValue({ data: { session: null }, error: new Error("expired recovery token") });
    await renderAuthHarness(authMock);

    await waitFor(() => expect(screen.getByLabelText("auth-state")).toHaveTextContent("signed-out"));
    await user.click(screen.getByRole("button", { name: "Recover from link" }));

    await waitFor(() => expect(screen.getByLabelText("auth-state")).toHaveTextContent("auth-error"));
    expect(screen.getByLabelText("auth-message")).toHaveTextContent("expired recovery token");
  });

  test("uses the configured public redirect URL for auth emails instead of the current origin", async () => {
    const user = userEvent.setup();
    const authMock = createAuthMock();
    await renderAuthHarness(authMock, "https://app.example.com/");

    await waitFor(() => expect(screen.getByLabelText("auth-state")).toHaveTextContent("signed-out"));
    await user.click(screen.getByRole("button", { name: "Google sign in" }));

    expect(authMock.signInWithOAuth).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: "https://app.example.com/account" } });
  });

  test("links the reset email to the configured public URL when set", async () => {
    const user = userEvent.setup();
    const authMock = createAuthMock();
    await renderAuthHarness(authMock, "https://app.example.com/");

    await waitFor(() => expect(screen.getByLabelText("auth-state")).toHaveTextContent("signed-out"));
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(authMock.resetPasswordForEmail).toHaveBeenCalledWith("user@example.com", { redirectTo: "https://app.example.com/account" });
  });

  test("lets the reset email fall back to the Supabase Site URL when no public URL is configured", async () => {
    const user = userEvent.setup();
    const authMock = createAuthMock();
    await renderAuthHarness(authMock);

    await waitFor(() => expect(screen.getByLabelText("auth-state")).toHaveTextContent("signed-out"));
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(authMock.resetPasswordForEmail).toHaveBeenCalledWith("user@example.com", {});
  });

  test("links a provider identity for the signed-in account", async () => {
    const user = userEvent.setup();
    const authMock = createAuthMock({ user: { id: "remote-user" } });
    await renderAuthHarness(authMock);

    await waitFor(() => expect(screen.getByLabelText("auth-state")).toHaveTextContent("signed-in"));
    await user.click(screen.getByRole("button", { name: "Link Google" }));

    expect(authMock.linkIdentity).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: `${window.location.origin}/account` } });
    expect(screen.getByLabelText("auth-state")).toHaveTextContent("signed-in");
  });

  test("unlinks a provider identity while staying signed in", async () => {
    const user = userEvent.setup();
    const authMock = createAuthMock({ user: { id: "remote-user" } });
    await renderAuthHarness(authMock);

    await waitFor(() => expect(screen.getByLabelText("auth-state")).toHaveTextContent("signed-in"));
    await user.click(screen.getByRole("button", { name: "Unlink Google" }));

    expect(authMock.unlinkIdentity).toHaveBeenCalledWith({ id: "g1", user_id: "remote-user", identity_id: "g1", provider: "google" });
    expect(screen.getByLabelText("auth-message")).toHaveTextContent("已移除 google 登入。");
    expect(screen.getByLabelText("auth-state")).toHaveTextContent("signed-in");
  });

  test("defers identity linking until cloud authentication is configured", async () => {
    const user = userEvent.setup();
    await renderAuthHarness();

    await user.click(screen.getByRole("button", { name: "Link Google" }));

    expect(screen.getByLabelText("auth-message")).toHaveTextContent("連結 google 需先設定雲端驗證。");
  });
});
