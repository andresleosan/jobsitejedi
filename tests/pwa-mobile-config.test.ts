import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const readProjectFile = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("BuildTrack mobile installation contract", () => {
  test("publishes an installable Android PWA manifest with the Jedi logo", () => {
    const manifest = JSON.parse(readProjectFile("public/manifest.webmanifest")) as {
      display: string;
      start_url: string;
      icons: Array<{ src: string; sizes: string; type: string }>;
    };

    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/dashboard");
    expect(manifest.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ src: "/pwa-icon-192.png", sizes: "192x192", type: "image/png" }),
      expect.objectContaining({ src: "/pwa-icon-512.png", sizes: "512x512", type: "image/png" }),
    ]));
    expect(existsSync(resolve(process.cwd(), "public/pwa-icon-192.png"))).toBe(true);
    expect(existsSync(resolve(process.cwd(), "public/pwa-icon-512.png"))).toBe(true);
  });

  test("registers the service worker and exposes the install action after authentication", () => {
    const index = readProjectFile("index.html");
    const main = readProjectFile("src/main.tsx");
    const manager = readProjectFile("src/components/dashboard/ManagerDashboard.tsx");
    const builder = readProjectFile("src/components/dashboard/BuilderDashboard.tsx");

    expect(index).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    expect(index).toContain('rel="apple-touch-icon"');
    expect(main).toContain('navigator.serviceWorker.register("/sw.js")');
    expect(manager).toContain("PwaInstallAction");
    expect(builder).toContain("PwaInstallAction");
  });
});

describe("Admin dashboard mobile density contract", () => {
  test("keeps the access review surface compact and stacks actions on narrow screens", () => {
    const manager = readProjectFile("src/components/dashboard/ManagerDashboard.tsx");
    const panel = readProjectFile("src/components/dashboard/AccessRequestsPanel.tsx");

    expect(manager).toContain("space-y-4 px-3 py-4 sm:space-y-6 sm:px-4 sm:py-6");
    expect(panel).toContain("rounded-lg border p-3 sm:p-4");
    expect(panel).toContain("grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_28rem]");
  });
});
