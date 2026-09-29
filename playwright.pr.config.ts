import { homedir } from "node:os";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/pr-browser",
  outputDir: `${homedir()}/.diffing/pr-browser/results`,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4188",
    browserName: "chromium",
    serviceWorkers: "block",
    launchOptions: {
      executablePath: process.env.DIFFING_PR_BROWSER_EXECUTABLE || undefined,
    },
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command:
      "node node_modules/vite/bin/vite.js --config tests/pr-browser/vite.config.ts",
    url: "http://127.0.0.1:4188/gh/pr",
    reuseExistingServer: !process.env.CI,
  },
});
