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
});
