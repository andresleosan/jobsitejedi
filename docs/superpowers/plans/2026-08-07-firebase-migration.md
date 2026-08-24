# Firebase Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the current Supabase-backed application on a new Firebase project while preserving the existing manager/builder functionality and user experience.

**Architecture:** Keep the React/Vite frontend and replace direct Supabase access with repositories under `src/lib/firebase/`. Use Firebase Auth, Cloud Firestore, private Storage, Cloud Functions, Firestore/Storage Rules, and the Emulator Suite. The new Firebase installation starts empty; no historical Supabase data is imported.

**Tech Stack:** React 18, Vite, TypeScript, Firebase Web SDK, Firebase Auth, Cloud Firestore, Firebase Storage, Firebase Functions, Firebase Emulator Suite, Vitest, `@firebase/rules-unit-testing`, Playwright.

## Global Constraints

- This is a new Firebase installation; users, records and files from Supabase are not imported.
- The implementation does not maintain a compatibility layer for the Supabase query API.
- No remote Firebase project is created, linked or deployed without operator access and explicit confirmation.
- Roles remain exactly `manager` and `builder`.
- Files remain private; Firestore stores file paths, not public URLs.
- Authorization is enforced by Firebase Rules and Functions, not only by React guards.
- Manager role creation requires a server-side invitation flow.
- Network retries are finite and use backoff; no operation retries indefinitely.
- Local development and security tests use the Firebase Emulator Suite.
- Do not commit `.env`, Firebase private keys, service-account JSON, or Function secrets.
- Do not change unrelated lint debt while migrating modules.
- Do not commit or deploy automatically; stop at review checkpoints unless the operator explicitly requests integration.

---

## File Map

Create the Firebase infrastructure in focused units:

- `firebase.json`: emulator, Functions, Firestore, Storage and Hosting configuration.
- `.firebaserc`: local demo project alias `demo-jobsite-jedi`; production linking remains an operator action.
- `firestore.rules`: authorization rules for every Firestore collection.
- `firestore.indexes.json`: composite indexes required by repository queries.
- `storage.rules`: private Storage authorization by path, role and owner.
- `functions/package.json`: isolated Functions runtime dependencies.
- `functions/tsconfig.json`: Functions TypeScript compiler settings.
- `functions/src/index.ts`: exported callable, HTTP and scheduled Functions.
- `src/lib/firebase/config.ts`: Firebase environment parsing and emulator endpoints.
- `src/lib/firebase/client.ts`: browser SDK initialization.
- `src/lib/firebase/auth.ts`: Auth operations and session subscription.
- `src/lib/firebase/firestore.ts`: Firestore converters, timestamps and shared query helpers.
- `src/lib/firebase/storage.ts`: private file upload/download and thumbnail helpers.
- `src/lib/firebase/functions.ts`: typed Functions client and normalized errors.
- `src/lib/firebase/repositories/`: domain repositories with no React dependencies.
- `src/hooks/useAuth.ts`: authenticated user and role state.
- `playwright.firebase.config.ts`: Playwright configuration for emulator-backed E2E.
- `tests/provider-guard.test.ts`: repository-level provider reference guard.
- `tests/firebase/`: emulator-backed Auth, Firestore, Storage and Functions tests.

Existing files are modified only when replacing a Supabase import or preserving an existing screen's behavior. The primary callsite groups are:

- Auth and navigation: `src/pages/Auth.tsx`, `src/pages/Invite.tsx`, `src/pages/Dashboard.tsx`, `src/pages/Builders.tsx`, `src/pages/Managers.tsx`, `src/pages/Storage.tsx`.
- Projects and jobs: `src/components/dashboard/{ProjectList,CreateProjectDialog,EditProjectDialog,ChangeProjectDialog,ManagerJobsList,FinishedProjectList}.tsx`, `src/pages/ProjectDetails.tsx`, `src/components/jobs/*.tsx`.
- Inventory and tools: `src/components/storage/*.tsx`, `src/components/dashboard/{EnhancedMaterialDialog,MaterialUsageDialog,MaterialsDetailDialog,MaterialDeliveryDialog,ManagerMaterialDeliveryDialog}.tsx`, `src/components/builders/ToolRequestDialog.tsx`.
- Financials and reports: `src/components/dashboard/{InvoiceDialog,EnhancedInvoiceDialog,InvoicesDetailDialog,DailyReportDialog,SupplierManagement,ManagerRiskAssessmentDialog,RiskAssessmentDialog,RubbishCollectionDialog,ManagerRubbishDialog,TimeTrackingDetailDialog}.tsx`, `src/pages/Statements.tsx`.
- Data types and provider cleanup: `src/integrations/supabase/`, `supabase/`, package dependencies and environment documentation.

---

## Task 1: Add Firebase Local Infrastructure

**Files:**
- Create: `firebase.json`
- Create: `.firebaserc`
- Create: `firestore.rules`
- Create: `firestore.indexes.json`
- Create: `storage.rules`
- Create: `functions/package.json`
- Create: `functions/tsconfig.json`
- Create: `src/lib/firebase/config.ts`
- Create: `playwright.firebase.config.ts`
- Modify: `package.json`
- Modify: `.env.example`
- Test: `tests/firebase/infrastructure.test.ts`

**Interfaces:**
- Produces local project alias `demo-jobsite-jedi` and emulator ports Auth `9099`, Firestore `8080`, Storage `9199`, Functions `5001`, Emulator UI `4000`.
- Produces npm scripts `firebase:emulators`, `firebase:deploy:rules`, `test:firebase`, `test:e2e:firebase`, and `test:provider-guard`.

- [ ] **Step 1: Write the failing infrastructure test**

Create a test that asserts the local Firebase config exposes Auth, Firestore and Storage emulator endpoints and that the project alias is `demo-jobsite-jedi`.

```ts
test("uses the local demo Firebase project", () => {
  expect(firebaseConfig.projectId).toBe("demo-jobsite-jedi");
  expect(firebaseConfig.emulators.auth).toBe(9099);
  expect(firebaseConfig.emulators.firestore).toBe(8080);
  expect(firebaseConfig.emulators.storage).toBe(9199);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npm run test:firebase -- tests/firebase/infrastructure.test.ts`

Expected: FAIL because Firebase configuration and the exported local config do not exist.

- [ ] **Step 3: Add Firebase configuration and dependencies**

Add `firebase` to browser dependencies. Add `vitest`, `@firebase/rules-unit-testing`, and `firebase-tools` to development dependencies. Add `.firebaserc` with the demo project alias and configure the four emulators in `firebase.json`. Add placeholder-safe `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, and `VITE_FIREBASE_APP_ID` entries to `.env.example`. Add `test:firebase` as `vitest run`, `test:e2e:firebase` as `playwright test --config=playwright.firebase.config.ts`, and `test:provider-guard` as the focused Vitest invocation for `tests/provider-guard.test.ts`.

- [ ] **Step 4: Run the test and verify it passes**

Run: `npm run test:firebase -- tests/firebase/infrastructure.test.ts`

Expected: PASS with one test passing.

- [ ] **Step 5: Verify the emulator command without a remote project**

Run: `npx firebase emulators:exec --project demo-jobsite-jedi --only auth,firestore,storage "node -e \"process.exit(0)\""`

Expected: exit code `0`; no production project is contacted.

---

## Task 2: Implement Firebase Client and Authentication

**Files:**
- Create: `src/lib/firebase/client.ts`
- Create: `src/lib/firebase/auth.ts`
- Create: `src/lib/firebase/types.ts`
- Create: `src/hooks/useAuth.ts`
- Modify: `src/pages/Auth.tsx`
- Modify: `src/pages/Invite.tsx`
- Test: `tests/firebase/auth.test.ts`

**Interfaces:**
- Produces `type AppRole = "manager" | "builder"`.
- Consumes `src/lib/firebase/config.ts` and produces `src/lib/firebase/types.ts` with `AppRole` and `SessionUser`.
- Produces `signIn(email: string, password: string): Promise<SessionUser>`.
- Produces `registerBuilder(input: { email: string; password: string; fullName: string }): Promise<SessionUser>`.
- Produces `signOut(): Promise<void>` and `subscribeToAuth(listener: (user: SessionUser | null) => void): () => void`.
- Produces `getCurrentRole(): Promise<AppRole | null>` from the authenticated user's custom claims.

- [ ] **Step 1: Write failing Auth tests against the emulator**

Cover builder registration, successful sign-in, invalid credentials, sign-out, and session subscription. Use `connectAuthEmulator` and clear the emulator Auth state between tests.

```ts
test("registers a builder with the builder role", async () => {
  const user = await registerBuilder({
    email: "builder@example.test",
    password: "Valid-password-123!",
    fullName: "Builder Test",
  });
  expect(user.role).toBe("builder");
});
```

- [ ] **Step 2: Run Auth tests and verify the expected failure**

Run: `npm run test:firebase -- tests/firebase/auth.test.ts`

Expected: FAIL because the Firebase Auth adapter does not exist.

- [ ] **Step 3: Implement the client and Auth adapter**

Initialize the Firebase browser app once, connect to emulators when `VITE_FIREBASE_USE_EMULATORS=true`, and normalize Firebase Auth errors into user-safe messages. Do not log tokens or password values. Use `onIdTokenChanged` for role refresh after custom claims update.

- [ ] **Step 4: Update Auth and route state**

Replace Supabase calls in `Auth.tsx`, `Invite.tsx`, and route-level auth checks with `useAuth`. Preserve current form validation, loading states, redirects and toast messages. Keep manager creation behind the Function interface until Task 6.

- [ ] **Step 5: Run Auth tests and verify green**

Run: `npm run test:firebase -- tests/firebase/auth.test.ts`

Expected: all Auth tests pass against the emulator.

---

## Task 3: Define Firestore Data Contracts and Security Rules

**Files:**
- Create: `src/lib/firebase/firestore.ts`
- Modify: `firestore.rules`
- Modify: `firestore.indexes.json`
- Test: `tests/firebase/firestore-rules.test.ts`

**Interfaces:**
- Produces typed document shapes with explicit `id`, `createdAt`, `updatedAt`, `userId`, `projectId`, `jobId`, `createdBy`, and `uploadedBy` fields where applicable.
- Produces `toFirestore<T>()` and `fromFirestore<T>()` converters that normalize Firestore `Timestamp` values.
- Produces Rules for `users`, `projects`, `jobs`, `jobCompletions`, `invoices`, `dailyReports`, `riskAssessments`, `rubbishRequests`, inventory and tool collections.

- [ ] **Step 1: Write Rules tests first**

Test anonymous denial, builder ownership, manager access, cross-user denial, and project/job relationship checks. Use `@firebase/rules-unit-testing` with Auth tokens containing `role: "builder"` and `role: "manager"`.

```ts
test("a builder cannot read another builder's invoice", async () => {
  const builder = testEnv.authenticatedContext("builder-2", { role: "builder" });
  await assertFails(builder.firestore().collection("invoices").doc("invoice-1").get());
});
```

- [ ] **Step 2: Run Rules tests and verify they fail**

Run: `npm run test:firebase -- tests/firebase/firestore-rules.test.ts`

Expected: FAIL because the Rules do not implement the Firebase contract.

- [ ] **Step 3: Implement document contracts and converters**

Define only fields required by current screens. Keep child records in separate collections to avoid Firestore document size limits. Use server timestamps for writes and never trust client-supplied role fields for authorization.

- [ ] **Step 4: Implement Rules and indexes**

Encode manager access through `request.auth.token.role == "manager"`, builder ownership through `request.auth.uid`, and project/job checks through stored IDs. Add indexes for project/status/date, job/project/date, invoice/project/date, request/status/date, and user/date queries used by the current screens.

- [ ] **Step 5: Run Rules tests and verify green**

Run: `npm run test:firebase -- tests/firebase/firestore-rules.test.ts`

Expected: all authorization tests pass, including anonymous denial.

---

## Task 4: Implement Core Firestore Repositories

**Files:**
- Create: `src/lib/firebase/repositories/projects.ts`
- Create: `src/lib/firebase/repositories/jobs.ts`
- Create: `src/lib/firebase/repositories/timeTracking.ts`
- Create: `src/lib/firebase/repositories/materialUsage.ts`
- Test: `tests/firebase/repositories/projects.test.ts`
- Test: `tests/firebase/repositories/jobs.test.ts`

**Interfaces:**
- `projectsRepository.listForUser(user: SessionUser): Promise<Project[]>`.
- `projectsRepository.create(input: CreateProjectInput): Promise<Project>`.
- `jobsRepository.listByProject(projectId: string): Promise<Job[]>`.
- `jobsRepository.create(input: CreateJobInput): Promise<Job>`.
- `jobsRepository.update(jobId: string, patch: JobPatch): Promise<void>`.
- `jobsRepository.subscribeByProject(projectId: string, listener: (jobs: Job[]) => void): () => void`.
- `timeTrackingRepository.start(input: StartTrackingInput): Promise<TimeEntry>` and `stop(entryId: string): Promise<void>`.

- [ ] **Step 1: Write repository tests against Firestore emulator**

Cover manager project creation, builder project visibility, job creation, status updates, time tracking start/stop, and listener cleanup.

- [ ] **Step 2: Run repository tests and verify failure**

Run: `npm run test:firebase -- tests/firebase/repositories/projects.test.ts tests/firebase/repositories/jobs.test.ts`

Expected: FAIL because repositories do not exist.

- [ ] **Step 3: Implement repositories**

Use Firestore `addDoc`, `updateDoc`, `query`, `where`, `orderBy`, `onSnapshot`, and `writeBatch` behind repository functions. Return domain objects with IDs and normalized timestamps. Keep query construction out of components.

- [ ] **Step 4: Run repository tests and verify green**

Run: `npm run test:firebase -- tests/firebase/repositories/projects.test.ts tests/firebase/repositories/jobs.test.ts`

Expected: PASS with listener unsubscribe tests proving no duplicate subscriptions.

---

## Task 5: Implement Inventory, Invoices, Reports and Requests Repositories

**Files:**
- Create: `src/lib/firebase/repositories/inventory.ts`
- Create: `src/lib/firebase/repositories/invoices.ts`
- Create: `src/lib/firebase/repositories/reports.ts`
- Create: `src/lib/firebase/repositories/riskAssessments.ts`
- Create: `src/lib/firebase/repositories/rubbishRequests.ts`
- Create: `src/lib/firebase/repositories/tools.ts`
- Test: `tests/firebase/repositories/inventory.test.ts`
- Test: `tests/firebase/repositories/invoices.test.ts`
- Test: `tests/firebase/repositories/reports.test.ts`

**Interfaces:**
- Inventory repositories expose material CRUD, stock logs, tool requests and checkouts.
- Invoice repositories expose invoice CRUD, supplier/training data and invoice item operations.
- Report repositories expose daily reports, risk assessments/signatures and rubbish requests.
- Each repository accepts typed inputs and returns typed records; no repository accepts arbitrary `Record<string, unknown>` writes.

- [ ] **Step 1: Write failing repository tests**

Cover manager-only inventory mutations, builder-owned daily reports, owner/manager invoice visibility, risk assessment signatures, rubbish request ownership, and tool checkout transitions.

- [ ] **Step 2: Run the tests and verify failure**

Run: `npm run test:firebase -- tests/firebase/repositories/inventory.test.ts tests/firebase/repositories/invoices.test.ts tests/firebase/repositories/reports.test.ts`

Expected: FAIL because the repositories do not exist.

- [ ] **Step 3: Implement typed repositories and batch operations**

Use transactions for stock quantity changes and batch writes when creating a parent record with child references. Validate IDs, dates, amounts and status transitions before writing. Preserve current user-visible success and error messages.

- [ ] **Step 4: Run the tests and verify green**

Run: `npm run test:firebase -- tests/firebase/repositories/inventory.test.ts tests/firebase/repositories/invoices.test.ts tests/firebase/repositories/reports.test.ts`

Expected: PASS with all ownership and manager authorization cases covered.

---

## Task 6: Replace Supabase Storage with Firebase Storage

**Files:**
- Modify: `src/lib/storage.ts`
- Create: `src/lib/firebase/storage.ts`
- Modify: `storage.rules`
- Modify: `src/components/jobs/{CreateJobDialog,EditJobDialog,JobSubmissionDialog,ManagerFeedbackDialog,ManagerReferencePhotosDialog,JobReviewDialog}.tsx`
- Modify: `src/components/dashboard/{DailyReportDialog,EnhancedInvoiceDialog,InvoicesDetailDialog,ManagerRiskAssessmentDialog,ManagerRubbishDialog,RiskAssessmentDialog,RubbishCollectionDialog}.tsx`
- Modify: `src/components/storage/StorageMaterialsTab.tsx`
- Modify: `src/pages/ProjectDetails.tsx`
- Test: `tests/firebase/storage-rules.test.ts`
- Test: `tests/firebase/storage.test.ts`

**Interfaces:**
- `uploadPrivateFile(path: string, file: Blob | File, metadata?: StorageMetadata): Promise<string>` returns the stored path.
- `downloadPrivateFile(path: string): Promise<Blob>`.
- `getPrivateDownloadUrl(path: string): Promise<string>` returns an in-memory URL only.
- `createThumbnail(file: File): Promise<Blob>` remains compatible with `src/lib/imageUtils.ts`.
- `getStoragePath(value: string, bucket: string): string` remains available for old path-shaped values during the fresh install transition.

- [ ] **Step 1: Write failing Storage tests**

Test authorized manager upload, owner-only upload, unauthorized download denial, path normalization and thumbnail fallback using the Storage emulator.

- [ ] **Step 2: Run Storage tests and verify failure**

Run: `npm run test:firebase -- tests/firebase/storage-rules.test.ts tests/firebase/storage.test.ts`

Expected: FAIL because Firebase Storage helpers and rules do not exist.

- [ ] **Step 3: Implement private Storage helpers and Rules**

Use the approved path layout from the design. Enforce `request.auth`, role and first path segment ownership in `storage.rules`. Store paths in Firestore, not download URLs. Return user-safe errors for missing thumbnails and denied downloads.

- [ ] **Step 4: Refactor Storage callsites**

Replace every `supabase.storage` call with the Firebase helper while preserving thumbnails, previews, downloads, loading state and toasts. Keep invoice and document paths private. Do not write URLs back to Firestore.

- [ ] **Step 5: Run Storage tests and verify green**

Run: `npm run test:firebase -- tests/firebase/storage-rules.test.ts tests/firebase/storage.test.ts`

Expected: PASS for manager, builder, owner, foreign-user and anonymous cases.

---

## Task 7: Port Privileged Cloud Functions

**Files:**
- Create: `functions/src/index.ts`
- Create: `functions/src/auth/invitations.ts`
- Create: `functions/src/auth/roles.ts`
- Create: `functions/src/invoices/processInvoice.ts`
- Create: `functions/src/jobs/extractJobsFromExcel.ts`
- Create: `functions/src/maintenance/cleanupOldProjects.ts`
- Modify: `functions/package.json`
- Test: `functions/src/**/*.test.ts`

**Interfaces:**
- `createManagerInvitation(data: { email: string }): Promise<{ invitationId: string }>` requires a manager claim.
- `setUserRole(data: { uid: string; role: AppRole }): Promise<void>` requires a manager claim.
- `processInvoice(data: { imagePath: string; supplierId: string | null }): Promise<ExtractedInvoice>` validates path and supplier ID.
- `extractJobsFromExcel(data: { filePath: string; projectId: string }): Promise<{ createdJobIds: string[] }>` requires a manager claim.
- `cleanupOldProjects` is scheduled and idempotent.

- [ ] **Step 1: Write failing Function tests**

Test manager-only invitation and role changes, builder denial, invalid input rejection, idempotent cleanup, and bounded external processing retries.

- [ ] **Step 2: Run Function tests and verify failure**

Run: `npm --prefix functions test`

Expected: FAIL because the Functions package and handlers do not exist.

- [ ] **Step 3: Implement Functions with Admin SDK**

Use the Admin SDK only inside Functions. Validate all callable input with schemas, omit secrets from errors and logs, set timeouts, and use a finite retry count with exponential backoff for external processing.

- [ ] **Step 4: Run Function tests and verify green**

Run: `npm --prefix functions test`

Expected: PASS against the Functions emulator with no external paid API calls.

---

## Task 8: Migrate Auth, Navigation and Project Screens

**Files:**
- Modify: `src/pages/Auth.tsx`
- Modify: `src/pages/Invite.tsx`
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/pages/Builders.tsx`
- Modify: `src/pages/Managers.tsx`
- Modify: `src/pages/Storage.tsx`
- Modify: `src/components/dashboard/{ProjectList,CreateProjectDialog,EditProjectDialog,ChangeProjectDialog,ManagerDashboard,ManagerJobsList,FinishedProjectList}.tsx`
- Test: `tests/firebase/e2e/auth-projects.spec.ts`

- [ ] **Step 1: Write the failing E2E flow**

Against the emulator, cover builder registration/login, manager login, manager project creation, builder project visibility, route denial and logout.

- [ ] **Step 2: Run the E2E flow and verify failure**

Run: `npm run test:e2e:firebase -- tests/firebase/e2e/auth-projects.spec.ts`

Expected: FAIL while these screens still call Supabase.

- [ ] **Step 3: Replace screen data access**

Use `useAuth`, `projectsRepository`, `jobsRepository` and typed Functions clients. Preserve existing navigation, loading indicators, toasts and responsive layout.

- [ ] **Step 4: Run the E2E flow and verify green**

Run: `npm run test:e2e:firebase -- tests/firebase/e2e/auth-projects.spec.ts`

Expected: PASS for both roles.

---

## Task 9: Migrate Jobs, Inventory, Tools, Financials and Reports Screens

**Files:**
- Modify: all files listed in the File Map under project/jobs, inventory/tools, and financials/reports.
- Test: `tests/firebase/e2e/jobs-inventory.spec.ts`
- Test: `tests/firebase/e2e/invoices-reports.spec.ts`

- [ ] **Step 1: Write failing E2E flows**

Cover job creation/edit/review/completion, photo upload/download, time tracking, materials usage, tool request/check-out, invoice upload/view, daily report, risk assessment signing and rubbish request resolution.

- [ ] **Step 2: Run the flows and verify failure**

Run: `npm run test:e2e:firebase -- tests/firebase/e2e/jobs-inventory.spec.ts tests/firebase/e2e/invoices-reports.spec.ts`

Expected: FAIL while screens still use Supabase.

- [ ] **Step 3: Replace module calls with repositories and Functions**

Refactor one module at a time. Keep database writes and child-record creation in repository functions. Use Storage helpers for every file operation. Use `onSnapshot` only where the current screen has realtime behavior.

- [ ] **Step 4: Run the flows and verify green**

Run: `npm run test:e2e:firebase -- tests/firebase/e2e/jobs-inventory.spec.ts tests/firebase/e2e/invoices-reports.spec.ts`

Expected: PASS for manager and builder scenarios, with unauthorized file access denied.

---

## Task 10: Remove Supabase Runtime Dependencies

**Files:**
- Delete: `src/integrations/supabase/client.ts`
- Delete: `src/integrations/supabase/types.ts`
- Delete: `supabase/functions/` after Function parity is verified
- Modify: `package.json`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `docs/supabase-setup.md`

- [ ] **Step 1: Add a repository guard test**

Create a script test that fails when `src/` contains imports from `@/integrations/supabase/client`, `supabase.storage`, or `supabase.from`.

```ts
test("has no Supabase runtime imports", () => {
  expect(scanSource("src")).toEqual([]);
});
```

- [ ] **Step 2: Run the guard and verify failure**

Run: `npm run test:provider-guard`

Expected: FAIL with the remaining Supabase imports.

- [ ] **Step 3: Remove remaining imports and dependencies**

Delete the Supabase client/types only after every repository and screen uses Firebase. Remove `@supabase/supabase-js` from `package.json` and remove obsolete `VITE_SUPABASE_*` documentation. Preserve historical migration files as audit artifacts until the operator chooses repository cleanup.

- [ ] **Step 4: Run the guard and verify green**

Run: `npm run test:provider-guard`

Expected: PASS with zero Supabase runtime references under `src/`.

---

## Task 11: Full Emulator QA and Release Readiness

**Files:**
- Modify: `firebase.json`, `firestore.rules`, `storage.rules`, `firestore.indexes.json` only if emulator tests identify a concrete defect.
- Create: `docs/firebase-setup.md`
- Create: `docs/firebase-release-checklist.md`
- Test: `tests/firebase/e2e/*.spec.ts`

- [ ] **Step 1: Run all unit, Rules and Function tests**

Run: `npm run test:firebase` and `npm --prefix functions test`

Expected: all emulator-backed tests pass with no external network or paid API calls.

- [ ] **Step 2: Run full E2E against emulators**

Run: `npm run test:e2e:firebase`

Expected: authentication, CRUD, uploads, downloads, role boundaries and realtime flows pass.

- [ ] **Step 3: Run provider guard, lint and build**

Run: `npm run test:provider-guard`, `npm run lint`, and `npm run build`.

Expected: provider guard and build pass. Existing unrelated lint errors must be recorded separately rather than hidden by disabling rules.

- [ ] **Step 4: Perform security review**

Verify no service-account files or Function secrets are tracked, anonymous Storage reads fail, foreign-user reads fail, manager-only Functions reject builders, and error logs omit tokens/passwords.

- [ ] **Step 5: Write release checklist**

Document Firebase project creation, Auth providers, Firestore/Storage Rules deployment, Function secrets, budget alert, staging smoke tests, rollback and the explicit production approval gate. Do not execute deployment commands without Firebase project access.

---

## Plan Self-Review

- Architecture coverage: Tasks 1-3 establish Firebase services, data contracts and Rules.
- Component coverage: Tasks 2, 4-6 define Auth, repositories, Storage and Functions clients.
- Function coverage: Task 7 ports all privileged operations named by the approved design.
- UI coverage: Tasks 8-9 cover every Supabase-importing screen group found in the repository.
- Security coverage: Tasks 3, 6, 7 and 11 cover Firestore Rules, Storage Rules, claims, input validation and secret handling.
- Testing coverage: every task has a failing-test step and a fresh verification command; Task 11 adds full emulator and E2E coverage.
- Cost and operations coverage: Tasks 1 and 11 configure local emulators, billing gates, budget alerts and release checks.
- Rollback coverage: the approved design and Task 11 preserve previous frontend/rules/function artifacts and require operator approval before deployment.
- No unresolved `TODO`, `TBD` or vague implementation placeholder remains in this plan.
