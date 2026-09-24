import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { defineConfig } from "@playwright/test";

const repoId = createHash("sha256").update(process.cwd()).digest("hex").slice(0, 12);
export default defineConfig({
  testDir: "./tests/search-browser",
  outputDir: `${homedir()}/.diffing/search-browser/${repoId}/results`,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4187",
    browserName: "chromium",
    serviceWorkers: "block",
    screenshot: "only-on-failure",
    launchOptions: { executablePath: process.env.DIFFING_SEARCH_BROWSER_EXECUTABLE || undefined },
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "narrow", use: { viewport: { width: 390, height: 844 } } },
  ],
  webServer: {
    command: "pnpm exec vite --config tests/search-browser/vite.config.ts",
    url: "http://127.0.0.1:4187/tests/search-browser/fixture.html",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
