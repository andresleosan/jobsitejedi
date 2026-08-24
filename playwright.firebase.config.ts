import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.firebase.spec.ts",
  timeout: 30_000,
  outputDir: "qa/test-results",
  reporter: [["list"], ["html", { outputFolder: "qa/reports", open: "never" }]],
  use: {
    headless: true,
    baseURL: "http://127.0.0.1:5173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm.cmd run dev -- --host 127.0.0.1 --port 5173",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      VITE_FIREBASE_USE_EMULATORS: "true",
      VITE_SUPABASE_URL: "https://legacy-disabled.invalid",
      VITE_SUPABASE_PUBLISHABLE_KEY: "e2e-disabled-key",
    },
  },
});
