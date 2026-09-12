import { describe, expect, test, vi } from "vitest";
import { alreadyRegisteredMessage, linkIdentity, recoverPasswordFromLink, requestPasswordReset, restoreOAuthCallbackSession, signInWithOAuth, signInWithPassword, signUpWithPassword, unlinkIdentity, updatePassword } from "./authActions";

function passwordClient(signInWithPasswordMock = vi.fn(), signUpMock = vi.fn()) {
  return { auth: { signInWithPassword: signInWithPasswordMock, signUp: signUpMock } };
}

function recoveryClient(resetMock = vi.fn(), updateMock = vi.fn()) {
  return { auth: { resetPasswordForEmail: resetMock, updateUser: updateMock } };
}

describe("password auth action", () => {
  test("rejects an empty email before calling Supabase", async () => {
    const signInWithPasswordMock = vi.fn();
    const result = await signInWithPassword(passwordClient(signInWithPasswordMock), "  ", "password");

    expect(result).toEqual({ ok: false, message: "請輸入電子郵件。" });
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
  });

  test("rejects an empty password before calling Supabase", async () => {
    const signInWithPasswordMock = vi.fn();
    const result = await signInWithPassword(passwordClient(signInWithPasswordMock), "user@example.com", "  ");

    expect(result).toEqual({ ok: false, message: "請輸入密碼。" });
    expect(signInWithPasswordMock).not.toHaveBeenCalled();
  });

  test("sends normalized credentials", async () => {
    const session = { user: { id: "user-1" } };
    const signInWithPasswordMock = vi.fn().mockResolvedValue({ data: { session }, error: null });
    const result = await signInWithPassword(passwordClient(signInWithPasswordMock), " user@example.com ", "secret");

    expect(result).toEqual({ ok: true, session });
    expect(signInWithPasswordMock).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "secret",
    });
  });

  test("returns the provider error without claiming success", async () => {
    const signInWithPasswordMock = vi.fn().mockResolvedValue({ data: null, error: new Error("invalid login") });

    await expect(signInWithPassword(passwordClient(signInWithPasswordMock), "user@example.com", "secret")).resolves.toEqual({ ok: false, message: "invalid login" });
  });

  test("rejects a successful provider response without a session", async () => {
    const signInWithPasswordMock = vi.fn().mockResolvedValue({ data: {}, error: null });

    await expect(signInWithPassword(passwordClient(signInWithPasswordMock), "user@example.com", "secret")).resolves.toEqual({
      ok: false,
      message: "驗證未回傳工作區工作階段。",
    });
  });

  test("creates an account with normalized credentials", async () => {
    const session = { user: { id: "new-user" } };
    const signUpMock = vi.fn().mockResolvedValue({ data: { session }, error: null });
    const result = await signUpWithPassword(passwordClient(vi.fn(), signUpMock), " new@example.com ", "secret");

    expect(result).toEqual({ ok: true, session });
    expect(signUpMock).toHaveBeenCalledWith({ email: "new@example.com", password: "secret" });
  });

  test("words a duplicate registration as an existing-account prompt", async () => {
    const signUpMock = vi.fn().mockResolvedValue({ data: null, error: new Error("User already registered") });

    await expect(signUpWithPassword(passwordClient(vi.fn(), signUpMock), "dup@example.com", "secret")).resolves.toEqual({
      ok: false,
      message: alreadyRegisteredMessage(),
    });
  });

  test("does not claim registration when Supabase returns no session", async () => {
    const signUpMock = vi.fn().mockResolvedValue({ data: {}, error: null });

    await expect(signUpWithPassword(passwordClient(vi.fn(), signUpMock), "new@example.com", "secret")).resolves.toEqual({
      ok: false,
      message: "帳戶已建立。請驗證電子郵件後登入,以啟用雲端同步。",
    });
  });

  test("sends password reset to the normalized email", async () => {
    const resetMock = vi.fn().mockResolvedValue({ error: null });

    await expect(requestPasswordReset(recoveryClient(resetMock), " user@example.com ", "https://app.test/settings")).resolves.toEqual({
      ok: true,
      message: "重設密碼的連結已寄出,請檢查電子郵件。",
    });
    expect(resetMock).toHaveBeenCalledWith("user@example.com", { redirectTo: "https://app.test/settings" });
  });

  test("falls back to the Supabase Site URL when no redirect URL is configured", async () => {
    const resetMock = vi.fn().mockResolvedValue({ error: null });

    await expect(requestPasswordReset(recoveryClient(resetMock), "user@example.com")).resolves.toEqual({
      ok: true,
      message: "重設密碼的連結已寄出,請檢查電子郵件。",
    });
    expect(resetMock).toHaveBeenCalledWith("user@example.com", {});
  });

  test("explains the platform email rate limit in user-facing language", async () => {
    const resetMock = vi.fn().mockResolvedValue({ error: new Error("Email rate limit exceeded") });

    await expect(requestPasswordReset(recoveryClient(resetMock), "user@example.com")).resolves.toEqual({
      ok: false,
      message: "寄送次數過多,請稍後再試。",
    });
  });

  test("does not request a reset without an email", async () => {
    const resetMock = vi.fn();

    await expect(requestPasswordReset(recoveryClient(resetMock), " ", "https://app.test/settings")).resolves.toEqual({ ok: false, message: "請輸入電子郵件。" });
    expect(resetMock).not.toHaveBeenCalled();
  });

  test("updates a recovery-session password", async () => {
    const updateMock = vi.fn().mockResolvedValue({ error: null });

    await expect(updatePassword(recoveryClient(vi.fn(), updateMock), "new-secret")).resolves.toEqual({
      ok: true,
      message: "密碼已更新,可以繼續進行雲端設定。",
    });
    expect(updateMock).toHaveBeenCalledWith({ password: "new-secret" });
  });

  test("starts a configured social sign-in redirect", async () => {
    const signInWithOAuthMock = vi.fn().mockResolvedValue({ error: null });

    await expect(signInWithOAuth({ auth: { signInWithOAuth: signInWithOAuthMock } }, "google", "https://app.test/settings")).resolves.toEqual({
      ok: true,
      message: "正在開啟 google 登入…",
    });
    expect(signInWithOAuthMock).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: "https://app.test/settings" } });
  });

  test("reports a failed social sign-in", async () => {
    const signInWithOAuthMock = vi.fn().mockResolvedValue({ error: new Error("provider unavailable") });

    await expect(signInWithOAuth({ auth: { signInWithOAuth: signInWithOAuthMock } }, "google", "https://app.test/settings")).resolves.toEqual({
      ok: false,
      message: "provider unavailable",
    });
  });

  test("recovers a password from a pasted reset link", async () => {
    const session = { user: { id: "recovering-user" } };
    const setSession = vi.fn().mockResolvedValue({ data: { session }, error: null });

    await expect(recoverPasswordFromLink({ auth: { setSession } }, "https://app.test/account#access_token=access&refresh_token=refresh&type=recovery")).resolves.toEqual({
      handled: true,
      recovery: true,
      result: { ok: true, session },
    });
    expect(setSession).toHaveBeenCalledWith({ access_token: "access", refresh_token: "refresh" });
  });

  test("recovers a password from a PKCE token_hash reset link in the query string", async () => {
    const session = { user: { id: "recovering-user" } };
    const verifyOtp = vi.fn().mockResolvedValue({ data: { session }, error: null });

    await expect(recoverPasswordFromLink({ auth: { setSession: vi.fn(), verifyOtp } }, "https://app.test/account?token_hash=pkce-hash&type=recovery")).resolves.toEqual({
      handled: true,
      recovery: true,
      result: { ok: true, session },
    });
    expect(verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "pkce-hash" });
  });

  test("reports a failed PKCE recovery token", async () => {
    const verifyOtp = vi.fn().mockResolvedValue({ data: null, error: new Error("Token has expired or is invalid") });

    await expect(recoverPasswordFromLink({ auth: { setSession: vi.fn(), verifyOtp } }, "https://app.test/account?token_hash=stale&type=recovery")).resolves.toEqual({
      handled: true,
      recovery: true,
      result: { ok: false, message: "Token has expired or is invalid" },
    });
  });

  test("ignores a token_hash link when the client has no verifyOtp", async () => {
    const setSession = vi.fn();

    await expect(recoverPasswordFromLink({ auth: { setSession } }, "https://app.test/account?token_hash=pkce-hash&type=recovery")).resolves.toEqual({ handled: false });
    expect(setSession).not.toHaveBeenCalled();
  });

  test("treats a pasted string without a callback as not handled", async () => {
    const setSession = vi.fn();

    await expect(recoverPasswordFromLink({ auth: { setSession } }, "not-a-link")).resolves.toEqual({ handled: false });
    expect(setSession).not.toHaveBeenCalled();
  });

  test("restores a social callback session from the URL fragment", async () => {
    const session = { user: { id: "oauth-user" } };
    const setSession = vi.fn().mockResolvedValue({ data: { session }, error: null });

    await expect(restoreOAuthCallbackSession({ auth: { setSession } }, "https://app.test/settings#access_token=access&refresh_token=refresh")).resolves.toEqual({
      handled: true,
      recovery: false,
      result: { ok: true, session },
    });
    expect(setSession).toHaveBeenCalledWith({ access_token: "access", refresh_token: "refresh" });
  });

  test("restores a password-recovery session and flags it for the recovery state", async () => {
    const session = { user: { id: "recovering-user" } };
    const setSession = vi.fn().mockResolvedValue({ data: { session }, error: null });

    await expect(restoreOAuthCallbackSession({ auth: { setSession } }, "https://app.test/account#access_token=access&refresh_token=refresh&type=recovery")).resolves.toEqual({
      handled: true,
      recovery: true,
      result: { ok: true, session },
    });
    expect(setSession).toHaveBeenCalledWith({ access_token: "access", refresh_token: "refresh" });
  });

  test("keeps the recovery flag when restoring a recovery link fails", async () => {
    const setSession = vi.fn().mockResolvedValue({ data: { session: null }, error: new Error("expired recovery token") });

    await expect(restoreOAuthCallbackSession({ auth: { setSession } }, "https://app.test/account#access_token=expired&refresh_token=expired&type=recovery")).resolves.toEqual({
      handled: true,
      recovery: true,
      result: { ok: false, message: "expired recovery token" },
    });
  });

  test("keeps the recovery flag when a recovery link returns no session", async () => {
    const setSession = vi.fn().mockResolvedValue({ data: {}, error: null });

    await expect(restoreOAuthCallbackSession({ auth: { setSession } }, "https://app.test/account#access_token=access&refresh_token=refresh&type=recovery")).resolves.toEqual({
      handled: true,
      recovery: true,
      result: { ok: false, message: "驗證未回傳工作區工作階段。" },
    });
  });

  test("ignores a normal settings URL", async () => {
    const setSession = vi.fn();

    await expect(restoreOAuthCallbackSession({ auth: { setSession } }, "https://app.test/settings")).resolves.toEqual({ handled: false });
    expect(setSession).not.toHaveBeenCalled();
  });

  test("links a provider identity for the signed-in user", async () => {
    const linkIdentityMock = vi.fn().mockResolvedValue({ error: null });
    const client = { auth: { linkIdentity: linkIdentityMock, unlinkIdentity: vi.fn() } };

    await expect(linkIdentity(client, "facebook", "https://app.test/account")).resolves.toEqual({
      ok: true,
      message: "正在開啟 facebook 登入…",
    });
    expect(linkIdentityMock).toHaveBeenCalledWith({ provider: "facebook", options: { redirectTo: "https://app.test/account" } });
  });

  test("reports a failed identity link", async () => {
    const linkIdentityMock = vi.fn().mockResolvedValue({ error: new Error("Already linked") });
    const client = { auth: { linkIdentity: linkIdentityMock, unlinkIdentity: vi.fn() } };

    await expect(linkIdentity(client, "google", "https://app.test/account")).resolves.toEqual({
      ok: false,
      message: "Already linked",
    });
  });

  test("unlinks a provider identity", async () => {
    const unlinkIdentityMock = vi.fn().mockResolvedValue({ error: null });
    const identity = { id: "id-1", user_id: "user-1", identity_id: "identity-1", provider: "google" };
    const client = { auth: { linkIdentity: vi.fn(), unlinkIdentity: unlinkIdentityMock } };

    await expect(unlinkIdentity(client, identity)).resolves.toEqual({
      ok: true,
      message: "已移除 google 登入。",
    });
    expect(unlinkIdentityMock).toHaveBeenCalledWith(identity);
  });

  test("reports a failed identity unlink", async () => {
    const unlinkIdentityMock = vi.fn().mockResolvedValue({ error: new Error("Last sign-in method") });
    const identity = { id: "id-1", user_id: "user-1", identity_id: "identity-1", provider: "facebook" };
    const client = { auth: { linkIdentity: vi.fn(), unlinkIdentity: unlinkIdentityMock } };

    await expect(unlinkIdentity(client, identity)).resolves.toEqual({
      ok: false,
      message: "Last sign-in method",
    });
  });
});
