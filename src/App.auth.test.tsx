import { act, render, screen, within } from "@testing-library/react";
import { alreadyRegisteredMessage } from "./auth/authActions";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

function createAuthMock() {
  return {
    getSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
    onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
    setSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "remote-user" } } }, error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: { session: { user: { id: "remote-user" } } }, error: null }),
    signUp: vi.fn(),
    resetPasswordForEmail: vi.fn(),
    updateUser: vi.fn(),
    signInWithOAuth: vi.fn(),
    linkIdentity: vi.fn().mockResolvedValue({ error: null }),
    unlinkIdentity: vi.fn().mockResolvedValue({ error: null }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
    verifyOtp: vi.fn(),
  };
}

async function renderRemoteApp(authMock = createAuthMock()) {
  vi.resetModules();
  vi.doMock("./lib/supabase", () => ({
    isLocalDevelopmentMode: false,
    isSupabaseConfigured: true,
    supabase: { auth: authMock },
    authRedirectBaseUrl: "",
  }));
  // Imported from the same (reset) module registry as App so the i18n
  // context is shared; a static import would reference a different module
  // instance after vi.resetModules and break useI18n.
  const { App } = await import("./App");
  const { LanguageProvider } = await import("./i18n/react");
  return { authMock, view: render(<LanguageProvider><App /></LanguageProvider>) };
}

async function openAccountPage(user: ReturnType<typeof userEvent.setup>) {
  // /account merged into Settings: the 登入 section is the default tab, so
  // opening 設定 lands directly on the account content (settings spec).
  await user.click(screen.getByRole("button", { name: "設定" }));
}

// renderRemoteApp() resets the module registry and re-imports the whole App
// graph, so the first test in this file spends its budget on module evaluation
// before it can assert anything. That cost tracks the size of the app and had
// grown past the default 5s budget, which reported a slow cold start as a
// failing assertion. The budget is raised for this file rather than globally,
// so a genuinely hung render elsewhere still fails on the default.
describe("app auth boundary", { timeout: 20_000 }, () => {
  beforeEach(() => {
    vi.stubGlobal("scrollTo", vi.fn());
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "local-id") });
    window.localStorage.clear();
    window.history.pushState(null, "", "/");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  test("opens the local workspace without a sign-in gate", async () => {
    await renderRemoteApp();

    expect(await screen.findByRole("heading", { name: "概覽" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "建立你的第一個帳戶" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open workspace/i })).not.toBeInTheDocument();
  });

  test("opens the 登入 section from Settings with password and provider sign-in", async () => {
    const user = userEvent.setup();
    const { authMock } = await renderRemoteApp();

    await openAccountPage(user);
    expect(screen.getByRole("heading", { name: "選用雲端同步" })).toBeInTheDocument();
    expect(window.location.pathname).toBe("/settings");
    expect(screen.getByLabelText("電子郵件")).toBeInTheDocument();
    expect(screen.getByLabelText("密碼")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "繼續" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "使用 Google 繼續" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "使用 Facebook 繼續" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "忘記密碼?" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("電子郵件"), "user@example.com");
    await user.type(screen.getByLabelText("密碼"), "secret");
    await user.click(screen.getByRole("button", { name: "繼續" }));

    expect(authMock.signInWithPassword).toHaveBeenCalledWith({ email: "user@example.com", password: "secret" });
    expect(await screen.findByRole("button", { name: "確認雲端交接" })).toBeInTheDocument();
    expect(screen.getByLabelText("本機資料交接摘要")).toBeInTheDocument();
  });

  test("confirms local data handoff from the dedicated account route", async () => {
    const user = userEvent.setup();
    await renderRemoteApp();

    await openAccountPage(user);
    await user.type(screen.getByLabelText("電子郵件"), "user@example.com");
    await user.type(screen.getByLabelText("密碼"), "secret");
    await user.click(screen.getByRole("button", { name: "繼續" }));
    expect(await screen.findByRole("button", { name: "確認雲端交接" })).toBeInTheDocument();
    expect(screen.getByLabelText("本機資料交接摘要")).toHaveTextContent("帳戶0記錄0草稿0餐點0媒體0");

    await user.click(screen.getByRole("button", { name: "確認雲端交接" }));
    expect(await screen.findByText("雲端同步就緒")).toBeInTheDocument();
  });

  test("links and unlinks provider identities from the signed-in account", async () => {
    const user = userEvent.setup();
    const authMock = createAuthMock();
    authMock.signInWithPassword = vi.fn().mockResolvedValue({
      data: {
        session: {
          user: {
            id: "remote-user",
            identities: [
              { id: "email-1", user_id: "remote-user", identity_id: "email-1", provider: "email" },
              { id: "google-1", user_id: "remote-user", identity_id: "google-1", provider: "google" },
            ],
          },
        },
      },
      error: null,
    });
    await renderRemoteApp(authMock);

    await openAccountPage(user);
    await user.type(screen.getByLabelText("電子郵件"), "user@example.com");
    await user.type(screen.getByLabelText("密碼"), "secret");
    await user.click(screen.getByRole("button", { name: "繼續" }));
    await user.click(await screen.findByRole("button", { name: "確認雲端交接" }));
    await screen.findByText("雲端同步就緒");

    const methods = screen.getByRole("group", { name: "登入方式" });
    expect(within(methods).getByText("電子郵件與密碼")).toBeInTheDocument();
    expect(within(methods).getByText("主要")).toBeInTheDocument();
    expect(within(methods).getByRole("button", { name: "解除連結" })).toBeInTheDocument();
    expect(within(methods).getByRole("button", { name: "連結 Facebook" })).toBeInTheDocument();

    await user.click(within(methods).getByRole("button", { name: "解除連結" }));
    expect(authMock.unlinkIdentity).toHaveBeenCalledWith({ id: "google-1", user_id: "remote-user", identity_id: "google-1", provider: "google" });

    await user.click(within(methods).getByRole("button", { name: "連結 Facebook" }));
    expect(authMock.linkIdentity).toHaveBeenCalledWith({ provider: "facebook", options: { redirectTo: `${window.location.origin}/account` } });
  });

  test("sets a new password from a recovery session", async () => {
    const user = userEvent.setup();
    let authListener: (_event: string, session: unknown) => void = () => undefined;
    const authMock = createAuthMock();
    authMock.updateUser = vi.fn().mockResolvedValue({ error: null });
    authMock.onAuthStateChange.mockImplementation((listener) => {
      authListener = listener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    await renderRemoteApp(authMock);

    await openAccountPage(user);
    act(() => authListener("PASSWORD_RECOVERY", { user: { id: "remote-user" } }));

    expect(screen.getByLabelText("新密碼")).toBeInTheDocument();
    await user.type(screen.getByLabelText("新密碼"), "new-secret");
    await user.click(screen.getByRole("button", { name: "設定新密碼" }));

    expect(authMock.updateUser).toHaveBeenCalledWith({ password: "new-secret" });
    expect(await screen.findByRole("button", { name: "確認雲端交接" })).toBeInTheDocument();
  });

  test("lands a password-recovery link on the new-password form instead of signing in", async () => {
    const user = userEvent.setup();
    const authMock = createAuthMock();
    authMock.updateUser = vi.fn().mockResolvedValue({ error: null });

    window.history.pushState(null, "", "/account#access_token=access&refresh_token=refresh&type=recovery");
    await renderRemoteApp(authMock);

    expect(authMock.setSession).toHaveBeenCalledWith({ access_token: "access", refresh_token: "refresh" });
    expect(await screen.findByLabelText("新密碼")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "設定新密碼" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "確認雲端交接" })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("新密碼"), "new-secret");
    await user.click(screen.getByRole("button", { name: "設定新密碼" }));

    expect(authMock.updateUser).toHaveBeenCalledWith({ password: "new-secret" });
    expect(await screen.findByRole("button", { name: "確認雲端交接" })).toBeInTheDocument();
  });

  test("reveals and masks the sign-in password with the visibility toggle", async () => {
    const user = userEvent.setup();
    await renderRemoteApp();

    await openAccountPage(user);

    const passwordInput = screen.getByLabelText("密碼");
    expect(passwordInput).toHaveAttribute("type", "password");
    await user.type(passwordInput, "secret");

    await user.click(screen.getByRole("button", { name: "顯示密碼" }));
    expect(screen.getByLabelText("密碼")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("密碼")).toHaveValue("secret");
    expect(screen.getByRole("button", { name: "隱藏密碼" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "隱藏密碼" }));
    expect(screen.getByLabelText("密碼")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("密碼")).toHaveValue("secret");
  });

  test("reveals and masks the new password field during recovery", async () => {
    const user = userEvent.setup();
    let authListener: (_event: string, session: unknown) => void = () => undefined;
    const authMock = createAuthMock();
    authMock.onAuthStateChange.mockImplementation((listener) => {
      authListener = listener;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    await renderRemoteApp(authMock);

    await openAccountPage(user);
    act(() => authListener("PASSWORD_RECOVERY", { user: { id: "remote-user" } }));

    const newPasswordInput = screen.getByLabelText("新密碼");
    expect(newPasswordInput).toHaveAttribute("type", "password");
    await user.type(newPasswordInput, "new-secret");

    await user.click(screen.getByRole("button", { name: "顯示密碼" }));
    expect(screen.getByLabelText("新密碼")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("新密碼")).toHaveValue("new-secret");
    expect(screen.getByRole("button", { name: "隱藏密碼" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "隱藏密碼" }));
    expect(screen.getByLabelText("新密碼")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("新密碼")).toHaveValue("new-secret");
  });

  test("switches to a dedicated sign-up view and creates an account", async () => {
    const user = userEvent.setup();
    const { authMock } = await renderRemoteApp();
    authMock.signUp = vi.fn().mockResolvedValue({ data: { session: { user: { id: "new-user" } } }, error: null });

    await openAccountPage(user);
    await user.click(screen.getByRole("radio", { name: "建立帳戶" }));

    expect(screen.getByLabelText("確認密碼")).toBeInTheDocument();
    await user.type(screen.getByLabelText("電子郵件"), "new@example.com");
    await user.type(screen.getByLabelText("密碼"), "secret");
    await user.type(screen.getByLabelText("確認密碼"), "secret");
    await user.click(screen.getByRole("button", { name: "建立帳戶" }));

    expect(authMock.signUp).toHaveBeenCalledWith({ email: "new@example.com", password: "secret" });
  });

  test("lands a duplicate sign-up on the sign-in view with the email kept", async () => {
    const user = userEvent.setup();
    const { authMock } = await renderRemoteApp();
    authMock.signUp = vi.fn().mockResolvedValue({ data: null, error: new Error("User already registered") });

    await openAccountPage(user);
    await user.click(screen.getByRole("radio", { name: "建立帳戶" }));
    await user.type(screen.getByLabelText("電子郵件"), "dup@example.com");
    await user.type(screen.getByLabelText("密碼"), "secret");
    await user.type(screen.getByLabelText("確認密碼"), "secret");
    await user.click(screen.getByRole("button", { name: "建立帳戶" }));

    expect(authMock.signUp).toHaveBeenCalledWith({ email: "dup@example.com", password: "secret" });
    expect(await screen.findByText(alreadyRegisteredMessage())).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "登入" })).toBeChecked();
    expect(screen.getByLabelText("電子郵件")).toHaveValue("dup@example.com");
  });

  test("rejects mismatched passwords before calling Supabase", async () => {
    const user = userEvent.setup();
    const { authMock } = await renderRemoteApp();

    await openAccountPage(user);
    await user.click(screen.getByRole("radio", { name: "建立帳戶" }));
    await user.type(screen.getByLabelText("電子郵件"), "new@example.com");
    await user.type(screen.getByLabelText("密碼"), "secret");
    await user.type(screen.getByLabelText("確認密碼"), "different");
    await user.click(screen.getByRole("button", { name: "建立帳戶" }));

    expect(screen.getByRole("alert")).toHaveTextContent("兩次輸入的密碼不一致。");
    expect(authMock.signUp).not.toHaveBeenCalled();
  });

  test("opens a dedicated forgot-password view and sends the reset link", async () => {
    const user = userEvent.setup();
    const { authMock } = await renderRemoteApp();
    authMock.resetPasswordForEmail = vi.fn().mockResolvedValue({ error: null });

    await openAccountPage(user);
    await user.click(screen.getByRole("button", { name: "忘記密碼?" }));

    expect(screen.getByRole("button", { name: "寄送重設連結" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("電子郵件"), "user@example.com");
    await user.click(screen.getByRole("button", { name: "寄送重設連結" }));

    expect(authMock.resetPasswordForEmail).toHaveBeenCalledWith("user@example.com", expect.anything());
    expect(await screen.findByText("重設密碼的連結已寄出,請檢查電子郵件。")).toBeInTheDocument();
  });

  test("finishes password recovery from a reset link pasted into the forgot-password view", async () => {
    const user = userEvent.setup();
    const authMock = createAuthMock();
    authMock.updateUser = vi.fn().mockResolvedValue({ error: null });

    await renderRemoteApp(authMock);
    await openAccountPage(user);
    await user.click(screen.getByRole("button", { name: "忘記密碼?" }));

    // The paste-a-link rescue stays collapsed by default (progressive
    // disclosure) so it does not compete with the primary reset action.
    expect(screen.queryByLabelText("重設連結")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /在此貼上/ }));
    expect(screen.getByLabelText("重設連結")).toBeInTheDocument();
    await user.type(screen.getByLabelText("重設連結"), "https://app.test/account#access_token=access&refresh_token=refresh&type=recovery");
    await user.click(screen.getByRole("button", { name: "使用重設連結" }));

    expect(authMock.setSession).toHaveBeenCalledWith({ access_token: "access", refresh_token: "refresh" });
    expect(await screen.findByLabelText("新密碼")).toBeInTheDocument();

    await user.type(screen.getByLabelText("新密碼"), "new-secret");
    await user.click(screen.getByRole("button", { name: "設定新密碼" }));

    expect(authMock.updateUser).toHaveBeenCalledWith({ password: "new-secret" });
    expect(await screen.findByRole("button", { name: "確認雲端交接" })).toBeInTheDocument();
  });

  test("finishes password recovery from a pasted PKCE token_hash reset link", async () => {
    const user = userEvent.setup();
    const authMock = createAuthMock();
    authMock.verifyOtp = vi.fn().mockResolvedValue({ data: { session: { user: { id: "remote-user" } } }, error: null });
    authMock.updateUser = vi.fn().mockResolvedValue({ error: null });

    await renderRemoteApp(authMock);
    await openAccountPage(user);
    await user.click(screen.getByRole("button", { name: "忘記密碼?" }));

    await user.click(screen.getByRole("button", { name: /在此貼上/ }));
    await user.type(screen.getByLabelText("重設連結"), "https://app.test/account?token_hash=pkce-hash&type=recovery");
    await user.click(screen.getByRole("button", { name: "使用重設連結" }));

    expect(authMock.verifyOtp).toHaveBeenCalledWith({ type: "recovery", token_hash: "pkce-hash" });
    expect(await screen.findByLabelText("新密碼")).toBeInTheDocument();
  });
});
