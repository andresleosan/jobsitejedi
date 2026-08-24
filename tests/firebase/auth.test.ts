import { beforeAll, beforeEach, afterAll, describe, expect, test, vi } from "vitest";

const makeCredentials = (label: string) => ({
  email: `builder-${label}-${Date.now()}@example.test`,
  password: "Valid-password-123!",
  fullName: `Builder ${label}`,
});

let getCurrentRole: typeof import("@/lib/firebase/auth").getCurrentRole;
let registerBuilder: typeof import("@/lib/firebase/auth").registerBuilder;
let signIn: typeof import("@/lib/firebase/auth").signIn;
let signOut: typeof import("@/lib/firebase/auth").signOut;
let subscribeToAuth: typeof import("@/lib/firebase/auth").subscribeToAuth;
let assignUserRole: typeof import("@/lib/firebase/functions").assignUserRole;

describe("Firebase Auth adapter", () => {
  beforeAll(async () => {
    vi.stubEnv("VITE_FIREBASE_USE_EMULATORS", "true");
    ({
      getCurrentRole,
      registerBuilder,
      signIn,
      signOut,
      subscribeToAuth,
    } = await import("@/lib/firebase/auth"));
    ({ assignUserRole } = await import("@/lib/firebase/functions"));
  });

  beforeEach(async () => {
    await signOut();
  });

  afterAll(async () => {
    if (signOut) {
      await signOut();
    }
    vi.unstubAllEnvs();
  });

  test("registers a builder with the builder role", async () => {
    const credentials = makeCredentials("registration");
    const user = await registerBuilder(credentials);

    expect(user.role).toBe("builder");
    expect(user.email).toBe(credentials.email);
    expect(user.fullName).toBe(credentials.fullName);
  });

  test("signs in with valid credentials", async () => {
    const credentials = makeCredentials("sign-in");
    await registerBuilder(credentials);
    await signOut();

    const user = await signIn(credentials.email, credentials.password);

    expect(user.email).toBe(credentials.email);
    expect(user.role).toBe("builder");
  });

  test("rejects a builder attempting to assign a manager role", async () => {
    const credentials = makeCredentials("role-escalation");
    const user = await registerBuilder(credentials);

    await expect(
      assignUserRole({ userId: user.id, role: "manager" }),
    ).rejects.toMatchObject({ code: "functions/permission-denied" });
  });

  test("normalizes invalid credentials into a safe error", async () => {
    const credentials = makeCredentials("invalid");
    await expect(signIn(credentials.email, credentials.password)).rejects.toThrow(
      "Invalid email or password",
    );
  });

  test("signs out the current user", async () => {
    const credentials = makeCredentials("sign-out");
    await registerBuilder(credentials);

    await signOut();

    expect(await getCurrentRole()).toBeNull();
  });

  test("notifies subscribers when the session changes", async () => {
    const credentials = makeCredentials("subscription");
    const users: Array<string | null> = [];
    const unsubscribe = subscribeToAuth((user) => users.push(user?.email ?? null));

    await registerBuilder(credentials);
    await signOut();
    unsubscribe();

    expect(users).toContain(credentials.email);
    expect(users).toContain(null);
  });
});
