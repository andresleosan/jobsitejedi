import { beforeAll, beforeEach, afterAll, describe, expect, test, vi } from "vitest";

const projectId = "demo-jobsite-jedi";
const emulatorUrl = "http://127.0.0.1:9099";
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

const clearAuthEmulator = async () => {
  const response = await fetch(
    `${emulatorUrl}/emulator/v1/projects/${projectId}/accounts`,
    { method: "DELETE" },
  );

  if (!response.ok) {
    throw new Error(`Unable to clear Auth Emulator: ${response.status}`);
  }
};

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
  });

  beforeEach(async () => {
    await signOut();
    await clearAuthEmulator();
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

    expect(user.role).toBeNull();
    expect(user.email).toBe(credentials.email);
    expect(user.fullName).toBe(credentials.fullName);
  });

  test("signs in with valid credentials", async () => {
    const credentials = makeCredentials("sign-in");
    await registerBuilder(credentials);
    await signOut();

    const user = await signIn(credentials.email, credentials.password);

    expect(user.email).toBe(credentials.email);
    expect(user.role).toBeNull();
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
