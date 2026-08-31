import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.firebase.spec.ts",
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  outputDir: "qa/test-results",
  reporter: [["list"], ["html", { outputFolder: "qa/reports", open: "never" }]],
  use: {
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    baseURL: "http://localhost:5173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host localhost --port 5173",
    url: "http://localhost:5173",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      VITE_FIREBASE_USE_EMULATORS: "true",
    },
  },
});
