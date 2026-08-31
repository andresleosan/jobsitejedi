import { defineConfig } from "@playwright/test";

const firebaseE2eOrigin = "http://127.0.0.1:41731";

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
    baseURL: firebaseE2eOrigin,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 41731 --strictPort",
    url: firebaseE2eOrigin,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      VITE_FIREBASE_USE_EMULATORS: "true",
    },
  },
});
