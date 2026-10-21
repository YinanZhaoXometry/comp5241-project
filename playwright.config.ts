import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";

process.env.PLAYWRIGHT_BROWSERS_PATH ??= resolve(".local/playwright");

export default defineConfig({
  testDir: "./tests/browser", fullyParallel: false, workers: 1, retries: 0, forbidOnly: true,
  timeout: 60000, expect: { timeout: 15000 }, reporter: "list",
  use: { baseURL: "http://127.0.0.1:3000", browserName: "chromium", trace: "off", screenshot: "off", video: "off" },
  // Never reuse an unrelated service, expose listeners or capture credentials in traces.
  webServer: [
    { command: "npm run start", url: "http://127.0.0.1:3000", reuseExistingServer: false, timeout: 60000, stdout: "ignore", stderr: "pipe" },
    { command: "npm run worker", wait: { stdout: /worker-ready/ }, timeout: 30000, stdout: "ignore", stderr: "pipe" },
  ],
});