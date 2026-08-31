import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { provisionEmulatorUser } from "../../scripts/lib/firebase-auth-emulator.mjs";

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
let getCurrentRole: typeof import("@/lib/firebase/auth").getCurrentRole;
let signIn: typeof import("@/lib/firebase/auth").signIn;
let signOut: typeof import("@/lib/firebase/auth").signOut;
let firebaseAuth: typeof import("@/lib/firebase/client").firebaseAuth;
let ownerId = "";

describe("Firebase reports repository", () => {
  beforeAll(async () => {
    vi.stubEnv("VITE_FIREBASE_USE_EMULATORS", "true");
    ({ firebaseAuth } = await import("@/lib/firebase/client"));
    ({ getCurrentRole, signIn, signOut } = await import("@/lib/firebase/auth"));
    ({ createProject } = await import("@/lib/firebase/repositories/projects"));
    ({
      createDailyReport,
      listDailyReports,
      createRiskAssessment,
      listRiskAssessments,
      signRiskAssessment,
      listRiskAssessmentSignatures,
    } = await import("@/lib/firebase/repositories/reports"));
    const owner = await provisionEmulatorUser({
      email: ownerCredentials.email,
      password: ownerCredentials.password,
      displayName: ownerCredentials.fullName,
      role: "builder",
    });
    ownerId = owner.uid;
    await provisionEmulatorUser({
      email: managerCredentials.email,
      password: managerCredentials.password,
      displayName: managerCredentials.fullName,
      role: "manager",
    });
    await signIn(ownerCredentials.email, ownerCredentials.password);
  });

  afterAll(async () => {
    await signOut();
    vi.unstubAllEnvs();
  });

  test("creates an owned daily report and an idempotent risk signature", async () => {
    await signOut();
    await signIn(managerCredentials.email, managerCredentials.password);
    const project = await createProject({
      builderId: ownerId,
      name: "Reports repository project",
      clientName: "Reports client",
    });
    await signOut();
    await signIn(ownerCredentials.email, ownerCredentials.password);
    const report = await createDailyReport({
      projectId: project.id,
      date: "2026-08-28",
      description: "Progress recorded by the project builder",
    });
    expect(report.builderId).toBe(project.ownerId);
    expect((await listDailyReports(project.id)).some((item) => item.id === report.id)).toBe(true);

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
