import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

const ownerCredentials = {
  email: `reports-owner-${Date.now()}@example.test`,
  password: "Valid-password-123!",
  fullName: "Reports Owner",
};

const managerCredentials = {
  email: `reports-manager-${Date.now()}@example.test`,
  password: "Valid-password-123!",
  fullName: "Reports Manager",
};

let createProject: typeof import("@/lib/firebase/repositories/projects").createProject;
let createDailyReport: typeof import("@/lib/firebase/repositories/reports").createDailyReport;
let listDailyReports: typeof import("@/lib/firebase/repositories/reports").listDailyReports;
let createRiskAssessment: typeof import("@/lib/firebase/repositories/reports").createRiskAssessment;
let listRiskAssessments: typeof import("@/lib/firebase/repositories/reports").listRiskAssessments;
let signRiskAssessment: typeof import("@/lib/firebase/repositories/reports").signRiskAssessment;
let listRiskAssessmentSignatures: typeof import("@/lib/firebase/repositories/reports").listRiskAssessmentSignatures;
let registerBuilder: typeof import("@/lib/firebase/auth").registerBuilder;
let getCurrentRole: typeof import("@/lib/firebase/auth").getCurrentRole;
let signIn: typeof import("@/lib/firebase/auth").signIn;
let signOut: typeof import("@/lib/firebase/auth").signOut;
let firebaseAuth: typeof import("@/lib/firebase/client").firebaseAuth;

const promoteToManager = async (userId: string) => {
  const [{ getApps, initializeApp }, { getAuth }] = await Promise.all([
    import("../../functions/node_modules/firebase-admin/lib/app/index.js"),
    import("../../functions/node_modules/firebase-admin/lib/auth/index.js"),
  ]);
  const adminApp = getApps().find((app) => app.name === "reports-repository-tests")
    ?? initializeApp({ projectId: "demo-jobsite-jedi" }, "reports-repository-tests");
  await getAuth(adminApp).setCustomUserClaims(userId, { role: "manager" });
};

describe("Firebase reports repository", () => {
  beforeAll(async () => {
    vi.stubEnv("VITE_FIREBASE_USE_EMULATORS", "true");
    ({ firebaseAuth } = await import("@/lib/firebase/client"));
    ({ registerBuilder, getCurrentRole, signIn, signOut } = await import("@/lib/firebase/auth"));
    ({ createProject } = await import("@/lib/firebase/repositories/projects"));
    ({
      createDailyReport,
      listDailyReports,
      createRiskAssessment,
      listRiskAssessments,
      signRiskAssessment,
      listRiskAssessmentSignatures,
    } = await import("@/lib/firebase/repositories/reports"));
    await registerBuilder(ownerCredentials);
  });

  afterAll(async () => {
    await signOut();
    vi.unstubAllEnvs();
  });

  test("creates an owned daily report and an idempotent risk signature", async () => {
    const project = await createProject({
      name: "Reports repository project",
      clientName: "Reports client",
    });
    const report = await createDailyReport({
      projectId: project.id,
      date: "2026-08-28",
      description: "Progress recorded by the project builder",
    });
    expect(report.builderId).toBe(project.ownerId);
    expect((await listDailyReports(project.id)).some((item) => item.id === report.id)).toBe(true);

    const manager = await registerBuilder(managerCredentials);
    await promoteToManager(manager.id);
    await signOut();
    await signIn(managerCredentials.email, managerCredentials.password);
    await firebaseAuth.currentUser?.getIdToken(true);
    expect(await getCurrentRole()).toBe("manager");
    const assessment = await createRiskAssessment({
      projectId: project.id,
      title: "Reports repository risk assessment",
      file: new File(["%PDF-1.7 test"], "site-risk.pdf", { type: "application/pdf" }),
    });
    expect(assessment.filePath).toBe(`documents/${project.id}/${assessment.id}/site-risk.pdf`);
    expect((await listRiskAssessments(project.id)).some((item) => item.id === assessment.id)).toBe(true);

    await signOut();
    await signIn(ownerCredentials.email, ownerCredentials.password);
    expect(await getCurrentRole()).toBe("builder");
    const firstSignature = await signRiskAssessment(assessment.id);
    const secondSignature = await signRiskAssessment(assessment.id);
    expect(secondSignature.id).toBe(firstSignature.id);
    expect(await listRiskAssessmentSignatures(assessment.id)).toHaveLength(1);
  });

  test("rejects invalid daily report input before writing", async () => {
    await expect(createDailyReport({
      projectId: "missing-project",
      date: "2026-02-30",
      description: "Invalid report",
    })).rejects.toThrow("Report date is invalid");
  });
});
