import { spawn } from "node:child_process";
import { chromium } from "@playwright/test";

const HOST = "127.0.0.1";
const PORT = 4173;
const URL = `http://${HOST}:${PORT}/auth`;
const SAMPLES = 5;
const THRESHOLDS = { lcpMs: 2_500, inpMs: 200, cls: 0.1 };

const profiles = [
  { name: "desktop", context: { viewport: { width: 1440, height: 900 } } },
  {
    name: "mobile",
    context: {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      hasTouch: true,
      isMobile: true,
    },
  },
];

const waitForPreview = async () => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(URL);
      if (response.ok) return;
    } catch {
      // Preview is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Vite preview did not become ready at ${URL}`);
};

const percentile = (values, fraction) => {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
};

const round = (value, digits = 2) => Number(value.toFixed(digits));

const runSample = async (browser, profile, sample) => {
  const context = await browser.newContext(profile.context);
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__buildTrackVitals = { cls: 0, inpMs: 0, lcpMs: 0 };

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__buildTrackVitals.lcpMs = entry.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__buildTrackVitals.cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.interactionId) {
          window.__buildTrackVitals.inpMs = Math.max(window.__buildTrackVitals.inpMs, entry.duration);
        }
      }
    }).observe({ type: "event", buffered: true, durationThreshold: 16 });
  });

  await page.goto(`${URL}?profile=${profile.name}&sample=${sample}`, { waitUntil: "load" });
  await page.locator("#signin-email").click();
  await page.locator("#signin-email").fill("performance@example.test");
  await page.waitForTimeout(500);

  const result = await page.evaluate(() => {
    const navigation = performance.getEntriesByType("navigation")[0];
    const paint = performance.getEntriesByName("first-contentful-paint")[0];
    return {
      ...window.__buildTrackVitals,
      fcpMs: paint?.startTime ?? 0,
      ttfbMs: navigation ? navigation.responseStart - navigation.requestStart : 0,
    };
  });
  await context.close();
  return result;
};

const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this measurement through npm so npm_execpath is available.");

const preview = spawn(
  process.execPath,
  [npmCli, "run", "preview", "--", "--host", HOST, "--port", String(PORT)],
  { cwd: process.cwd(), env: process.env, stdio: "ignore", windowsHide: true },
);

let browser;
try {
  await waitForPreview();
  browser = await chromium.launch({ headless: true });
  const report = {};

  for (const profile of profiles) {
    const samples = [];
    for (let sample = 1; sample <= SAMPLES; sample += 1) {
      samples.push(await runSample(browser, profile, sample));
    }
    const p75 = {
      lcpMs: round(percentile(samples.map((entry) => entry.lcpMs), 0.75)),
      inpMs: round(percentile(samples.map((entry) => entry.inpMs), 0.75)),
      cls: round(percentile(samples.map((entry) => entry.cls), 0.75), 4),
      fcpMs: round(percentile(samples.map((entry) => entry.fcpMs), 0.75)),
      ttfbMs: round(percentile(samples.map((entry) => entry.ttfbMs), 0.75)),
    };
    report[profile.name] = {
      p75,
      passes: {
        lcp: p75.lcpMs <= THRESHOLDS.lcpMs,
        inp: p75.inpMs <= THRESHOLDS.inpMs,
        cls: p75.cls <= THRESHOLDS.cls,
      },
    };
  }

  console.log(JSON.stringify({ url: URL, samplesPerProfile: SAMPLES, thresholds: THRESHOLDS, profiles: report }, null, 2));
  const failed = Object.values(report).some((profile) => Object.values(profile.passes).includes(false));
  if (failed) process.exitCode = 1;
} finally {
  await browser?.close();
  preview.kill();
}
