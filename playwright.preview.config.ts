// TEMPORARY — this host cannot bind the committed config's 4173/4174 ports and
// Playwright asks for chromium r1228 while only r1208/r1234 are installed.
// Point at a server started by hand and pin the executable. Delete after use.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 2,
  timeout: 30_000,
  reporter: "list",
  updateSnapshots: "missing",
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.002,
      animations: "disabled",
    },
  },
  use: {
    baseURL: "http://127.0.0.1:5176",
    trace: "retain-on-failure",
    locale: "zh-TW",
    launchOptions: {
      executablePath:
        process.env.LOCALAPPDATA + "/ms-playwright/chromium-1234/chrome-win64/chrome.exe",
    },
  },
});
