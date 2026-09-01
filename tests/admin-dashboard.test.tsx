import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, test, vi } from "vitest";
import ManagerDashboard from "../src/components/dashboard/ManagerDashboard";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock("@/lib/firebase/auth", () => ({ signOut: vi.fn() }));
vi.mock("@/lib/firebase/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/firebase/client")>()),
  firebaseAuth: { currentUser: { uid: "admin-1" } },
}));
vi.mock("@/lib/firebase/repositories/projects", () => ({ listProjects: vi.fn() }));
vi.mock("@/components/dashboard/AccessRequestsPanel", () => ({ default: () => null }));
vi.mock("@/components/dashboard/AdminUsersPanel", () => ({ default: () => null }));
vi.mock("@/components/dashboard/CreateProjectDialog", () => ({ default: () => null }));
vi.mock("@/components/dashboard/ProjectList", () => ({ default: () => null }));
vi.mock("@/components/dashboard/ManagerJobReviewPanel", () => ({ default: () => null }));
vi.mock("@/components/dashboard/ManagerMaterialDeliveryDialog", () => ({ default: () => null }));
vi.mock("@/components/dashboard/ManagerRubbishDialog", () => ({ default: () => null }));
vi.mock("@/components/dashboard/ManagerInvoicesDialog", () => ({ default: () => null }));
vi.mock("@/components/dashboard/JobImportDialog", () => ({ default: () => null }));
vi.mock("@/components/dashboard/SupplierCatalogDialog", () => ({ default: () => null }));
vi.mock("@/components/dashboard/ReportsRiskPanel", () => ({ default: () => null }));
vi.mock("@/components/dashboard/active-session-task", () => ({ runActiveSessionTask: vi.fn() }));
vi.mock("@/components/PwaInstallAction", () => ({ PwaInstallAction: () => null }));

const renderAdminDashboard = () =>
  renderToStaticMarkup(
    <MemoryRouter>
      <ManagerDashboard userId="admin-1" email="admin@example.com" role="admin" />
    </MemoryRouter>,
  );

describe("Admin dashboard contract", () => {
  test("exposes an operations overview and section navigation", () => {
    const html = renderAdminDashboard();

    expect(html).toContain('class="admin-dashboard"');
    expect(html).toContain('id="admin-overview-title"');
    expect(html).toContain("Keep every account in the right hands.");
    expect(html).toContain('href="#access-requests"');
    expect(html).toContain('href="#people-permissions"');
  });

  test("keeps the administrative workspace role-specific", () => {
    const html = renderAdminDashboard();

    expect(html).toContain("Admin workspace");
    expect(html).toContain("Admin Dashboard");
    expect(html).toContain("admin@example.com");
  });

  test("keeps the admin overview free of repeated decorative icon tiles", () => {
    const html = renderAdminDashboard();
    const navStart = html.indexOf('<nav class="admin-section-nav"');
    const navEnd = html.indexOf("</nav>", navStart);
    const sectionNav = html.slice(navStart, navEnd);

    expect(html).not.toContain('class="admin-overview-note"');
    expect(sectionNav).not.toContain("<svg");
  });
});
