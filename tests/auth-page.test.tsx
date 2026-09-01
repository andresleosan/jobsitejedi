import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, test, vi } from "vitest";
import Auth from "../src/pages/Auth";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    isLoading: false,
    signIn: vi.fn(),
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
    getAccessRequestStatus: vi.fn(),
    submitAccessRequest: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const renderAuth = () =>
  renderToStaticMarkup(
    <MemoryRouter>
      <Auth />
    </MemoryRouter>,
  );

describe("Auth page contract", () => {
  test("offers a clear route back to the public landing from both brand marks", () => {
    const html = renderAuth();

    expect(html).toContain('class="auth-page"');
    expect(html).toContain('aria-label="Back to BuildTrack Pro home"');
    expect((html.match(/href="\//g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  test("keeps the existing sign-in choices and accessible form labels", () => {
    const html = renderAuth();

    expect(html).toContain("Continue with Google");
    expect(html).toContain("Or continue with email");
    expect(html).toContain('for="signin-email"');
    expect(html).toContain('for="signin-password"');
    expect(html).toContain("Sign In");
  });

  test("keeps the access benefits quiet and content-led", () => {
    const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

    expect(css).toContain(".auth-benefit-icon { display: inline-flex; width: 20px;");
    expect(css).toContain("background: transparent; color: var(--auth-blue);");
  });
});
