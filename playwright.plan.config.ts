import { homedir } from "node:os";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/plan-browser",
  outputDir: `${homedir()}/.diffing/plan-browser-results`,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4193",
    serviceWorkers: "block",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1440, height: 900 } } },
    // Safari engine (opt-in: needs `playwright install webkit`). Safari has no
    // navigator.vibrate and doesn't focus buttons on click, which changes
    // popover and composer behaviour.
    ...(process.env.DIFFING_E2E_WEBKIT
      ? [{ name: "webkit", use: { browserName: "webkit" as const, viewport: { width: 1440, height: 900 } } }]
      : []),
  ],
  webServer: {
    command: "node tests/plan-browser/server.mjs",
    url: "http://127.0.0.1:4193/api/plans",
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
  },
});
