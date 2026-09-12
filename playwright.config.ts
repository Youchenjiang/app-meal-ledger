import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  timeout: 30_000,
  reporter: "list",
  // Snapshot baselines carry a platform suffix. "missing" writes a baseline the
  // platform has never seen and still fails that run, so a new runner is loud
  // rather than silently unguarded; the written file is uploaded as an artifact
  // and can be committed. See docs/testing/visual-regression.md.
  updateSnapshots: "missing",
  expect: {
    toHaveScreenshot: {
      // Text rendering differs in sub-pixel noise between machines; that must
      // not fail the run, a shifted or clipped row must.
      maxDiffPixelRatio: 0.002,
      animations: "disabled",
    },
  },
  use: {
    baseURL: "http://127.0.0.1:4174",
    trace: "retain-on-failure",
    // The e2e specs assert the zh-TW UI. Without a locale the default en-US
    // browser would flip the app to the en-US fallback (see src/i18n).
    locale: "zh-TW",
  },
  webServer: {
    command: "npm run dev:e2e",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
