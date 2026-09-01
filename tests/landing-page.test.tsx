import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test } from "vitest";
import Index from "../src/pages/Index";

const renderLanding = () =>
  renderToStaticMarkup(
    <MemoryRouter>
      <Index />
    </MemoryRouter>,
  );

describe("Public landing page contract", () => {
  test("exposes a semantic navigation and a focused project-pulse preview", () => {
    const html = renderLanding();

    expect(html).toContain('aria-label="Main navigation"');
    expect(html).toContain('href="#capabilities"');
    expect(html).toContain("Know what’s moving before the site does.");
    expect(html).toContain('aria-label="Illustrative project status panel"');
    expect(html).toContain("Northline Renovation");
    expect(html).toContain("Latest handoff");
  });

  test("keeps the public calls to action pointed at authentication", () => {
    const html = renderLanding();

    expect((html.match(/Start for free/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect((html.match(/Start your first project/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect((html.match(/Sign in/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect((html.match(/href="\/auth"/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  test("keeps the navigation call to action readable on its blue background", () => {
    const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

    expect(css).toContain(".landing-nav a.landing-nav-cta { color: white; }");
    expect(css).toContain(".landing-nav a.landing-nav-cta:hover { color: white; }");
  });

  test("uses restrained icon treatment instead of colorful icon tiles", () => {
    const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

    expect(css).not.toContain(".landing-activity-icon");
    expect(css).not.toContain(".landing-strip-icon");
    expect(css).not.toContain(".landing-capability-icon");
  });

  test("keeps the public story content-led instead of repeating decorative icons", () => {
    const html = renderLanding();

    expect(html).not.toContain("landing-activity-icon");
    expect(html).not.toContain("landing-strip-icon");
    expect(html).not.toContain("landing-capability-icon");
  });
});
