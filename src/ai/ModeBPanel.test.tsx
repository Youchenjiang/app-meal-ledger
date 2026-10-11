import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createLocalAccount } from "../manualLedger/accounts";
import { LanguageProvider } from "../i18n/react";
import { ModeBPanel } from "./ModeBPanel";
import type { SpeechRecognitionLike } from "./speech";

vi.mock("./config", () => ({ isAiConfigured: vi.fn(() => true) }));
vi.mock("./client", () => ({ requestAiJson: vi.fn() }));

import { isAiConfigured } from "./config";
import { requestAiJson } from "./client";

function renderPanel(ui: ReactElement) {
  return render(<LanguageProvider>{ui}</LanguageProvider>);
}

const accounts = [{ name: "Daily wallet", currency: "TWD" }];
const categories = ["午餐"];

// A fake Web Speech API implementation that emits one transcript per start,
// so the panel's per-field capture path is exercised without a browser. The
// class is stubbed on the global, so the transcript is read from a mutable
// holder at start time.
let nextTranscript = "";

class FakeRecognition implements SpeechRecognitionLike {
  lang = "zh-TW";
  interimResults = false;
  onstart: SpeechRecognitionLike["onstart"] = null;
  onresult: SpeechRecognitionLike["onresult"] = null;
  onend: SpeechRecognitionLike["onend"] = null;
  onerror: SpeechRecognitionLike["onerror"] = null;
  start() {
    this.onstart?.();
    this.onresult?.({ results: [[{ transcript: nextTranscript, isFinal: true }]] });
    this.onend?.();
  }
  // skipcq: JS-0321, JS-0105 -- the fake has nothing to stop; the panel's
  // stop() calls must be tolerated without side effects.
  stop() {}
}

beforeEach(() => {
  vi.mocked(requestAiJson).mockReset();
  vi.mocked(isAiConfigured).mockReturnValue(true);
  nextTranscript = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ModeBPanel", () => {
  test("walks the fields step by step and saves the assembled draft", async () => {
    const onSaveRecord = vi.fn((_draft: unknown, _extra?: unknown[]) => null);
    const user = userEvent.setup();
    renderPanel(<ModeBPanel accounts={accounts} categories={categories} onSaveRecord={onSaveRecord} />);

    const fill = async (label: string, value: string) => {
      await user.type(screen.getByLabelText(label), value);
      await user.click(screen.getByRole("button", { name: /填入此欄/u }));
    };

    await fill("日期", "2026-07-25");
    await fill("類型", "expense");
    await fill("帳戶", "Daily wallet");
    await fill("類別", "午餐");
    await fill("對象", "麵店");
    await fill("品項", "牛肉麵");
    await fill("金額", "480");

    expect(screen.getByText("確認這筆記錄")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /確認寫入/u }));

    expect(onSaveRecord).toHaveBeenCalledTimes(1);
    const draft = onSaveRecord.mock.calls[0][0] as { amount: string; account: string; category: string };
    expect(draft.amount).toBe("480");
    expect(draft.account).toBe("Daily wallet");
    expect(draft.category).toBe("午餐");
  });

  test("corrects a spoken field through the per-field AI prompt", async () => {
    vi.mocked(requestAiJson).mockResolvedValue({ ok: true, data: { value: "2026-07-25" } });
    nextTranscript = "七月二十五";
    vi.stubGlobal("SpeechRecognition", FakeRecognition);
    const user = userEvent.setup();
    renderPanel(<ModeBPanel accounts={accounts} categories={categories} onSaveRecord={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "用說的" }));

    await waitFor(() => expect(screen.getByLabelText("日期")).toHaveValue("2026-07-25"));
    // 聽到的 row shows the raw transcript, the AI 校對 row carries the value.
    expect(screen.getByText("七月二十五")).toBeInTheDocument();
    expect(requestAiJson).toHaveBeenCalledWith(expect.objectContaining({ user: "七月二十五" }));
  });

  test("falls back to the raw transcript when AI is not configured", async () => {
    vi.mocked(isAiConfigured).mockReturnValue(false);
    nextTranscript = "2026-07-25";
    vi.stubGlobal("SpeechRecognition", FakeRecognition);
    const user = userEvent.setup();
    renderPanel(<ModeBPanel accounts={accounts} categories={categories} onSaveRecord={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "用說的" }));

    await waitFor(() => expect(screen.getByLabelText("日期")).toHaveValue("2026-07-25"));
    expect(requestAiJson).not.toHaveBeenCalled();
    expect(screen.getByText(/尚未設定 AI 金鑰/u)).toBeInTheDocument();
  });

  test("resolves an offline spoken Chinese date into the date picker", async () => {
    vi.mocked(isAiConfigured).mockReturnValue(false);
    nextTranscript = "七月二十五";
    vi.stubGlobal("SpeechRecognition", FakeRecognition);
    const user = userEvent.setup();
    renderPanel(<ModeBPanel accounts={accounts} categories={categories} onSaveRecord={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "用說的" }));

    await waitFor(() => expect(screen.getByLabelText("日期")).toHaveValue("2026-07-25"));
    expect(requestAiJson).not.toHaveBeenCalled();
  });

  test("applies the last interim transcript when the session ends without a final result", async () => {
    // Some engines stream interim results and then end without ever flagging
    // the last item isFinal (common when the user pauses). The panel must
    // promote the last interim words so the field still gets filled.
    let fired = false;
    class InterimOnlyRecognition implements SpeechRecognitionLike {
      lang = "zh-TW";
      interimResults = true;
      onstart: SpeechRecognitionLike["onstart"] = null;
      onresult: SpeechRecognitionLike["onresult"] = null;
      onend: SpeechRecognitionLike["onend"] = null;
      onerror: SpeechRecognitionLike["onerror"] = null;
      start() {
        // One interim result, then the session ends without a final one.
        this.onstart?.();
        this.onresult?.({ results: [[{ transcript: "昨天", isFinal: false }]] });
        this.onend?.();
        fired = true;
      }
      // skipcq: JS-0321, JS-0105 -- no-op fake stop, see FakeRecognition.
      stop() {}
    }
    vi.mocked(requestAiJson).mockResolvedValue({ ok: true, data: { value: "" } });
    vi.stubGlobal("SpeechRecognition", InterimOnlyRecognition);
    const user = userEvent.setup();
    renderPanel(<ModeBPanel accounts={accounts} categories={categories} onSaveRecord={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "用說的" }));

    expect(fired).toBe(true);
    // The interim transcript is promoted and resolved into the date field.
    await waitFor(() => {
      const value = (screen.getByLabelText("日期") as HTMLInputElement).value;
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
    expect(screen.getByText("昨天")).toBeInTheDocument();
  });

  test("shows the starting hint until the engine fires onstart", async () => {
    // The browser may take a few seconds to load the speech model / grant the
    // microphone; the panel must say it is starting instead of pretending to
    // listen (or looking dead) during that window.
    class SlowRecognition implements SpeechRecognitionLike {
      lang = "zh-TW";
      interimResults = true;
      onstart: SpeechRecognitionLike["onstart"] = null;
      onresult: SpeechRecognitionLike["onresult"] = null;
      onend: SpeechRecognitionLike["onend"] = null;
      onerror: SpeechRecognitionLike["onerror"] = null;
      // skipcq: JS-0105 -- the fake deliberately never fires onstart.
      start() {
        // The engine has not started listening yet — onstart is deferred.
      }
      // skipcq: JS-0321, JS-0105 -- no-op fake stop, see FakeRecognition.
      stop() {}
    }
    vi.stubGlobal("SpeechRecognition", SlowRecognition);
    const user = userEvent.setup();
    renderPanel(<ModeBPanel accounts={accounts} categories={categories} onSaveRecord={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "用說的" }));

    expect(screen.getByText("正在啟動麥克風,請稍候…")).toBeInTheDocument();
    // The button becomes the stop control while starting.
    expect(screen.getByRole("button", { name: "停止收音" })).toBeInTheDocument();
  });

  test("shows a date picker for the date field and keeps the raw value for others", async () => {
    const user = userEvent.setup();
    renderPanel(<ModeBPanel accounts={accounts} categories={categories} onSaveRecord={vi.fn()} />);

    expect(screen.getByLabelText("日期")).toHaveAttribute("type", "date");
    await user.type(screen.getByLabelText("日期"), "2026-07-25");
    await user.click(screen.getByRole("button", { name: /填入此欄/u }));

    await user.type(screen.getByLabelText("類型"), "expense");
    expect(screen.getByLabelText("類型")).toHaveAttribute("type", "text");
  });

  test("inserts a transfer destination step for transfers", async () => {
    const user = userEvent.setup();
    renderPanel(<ModeBPanel accounts={accounts} categories={categories} onSaveRecord={vi.fn()} />);

    await user.type(screen.getByLabelText("日期"), "2026-07-25");
    await user.click(screen.getByRole("button", { name: /填入此欄/u }));
    await user.type(screen.getByLabelText("類型"), "transfer");
    await user.click(screen.getByRole("button", { name: /填入此欄/u }));
    await user.type(screen.getByLabelText("帳戶"), "Daily wallet");
    await user.click(screen.getByRole("button", { name: /填入此欄/u }));

    // The next step is the transfer destination; the category step is skipped.
    expect(screen.getByLabelText("轉帳目標")).toBeInTheDocument();
    expect(screen.queryByLabelText("類別")).not.toBeInTheDocument();
  });

  test("creates a new account on save under the auto policy", async () => {
    const createdAccount = createLocalAccount("新錢包", "TWD", "account-1");
    const onResolveNewEntities = vi.fn(() => (createdAccount ? [createdAccount] : []));
    const onSaveRecord = vi.fn(() => null);
    const user = userEvent.setup();
    renderPanel(
      <ModeBPanel
        accounts={accounts}
        categories={categories}
        entityPolicy={{ account: "auto", category: "existing" }}
        onResolveNewEntities={onResolveNewEntities}
        onSaveRecord={onSaveRecord}
      />,
    );

    const fill = async (label: string, value: string) => {
      await user.type(screen.getByLabelText(label), value);
      await user.click(screen.getByRole("button", { name: /填入此欄/u }));
    };

    await fill("日期", "2026-07-25");
    await fill("類型", "expense");
    await fill("帳戶", "新錢包");
    await fill("類別", "午餐");
    await fill("對象", "麵店");
    await fill("品項", "牛肉麵");
    await fill("金額", "480");

    await user.click(screen.getByRole("button", { name: /確認寫入/u }));

    expect(onResolveNewEntities).toHaveBeenCalledTimes(1);
    expect(onResolveNewEntities).toHaveBeenCalledWith(expect.objectContaining({ newAccount: "新錢包" }));
    expect(onSaveRecord).toHaveBeenCalledTimes(1);
  });
});
