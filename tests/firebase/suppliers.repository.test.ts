import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { provisionEmulatorUser } from "../../scripts/lib/firebase-auth-emulator.mjs";

const managerCredentials = {
  email: `suppliers-manager-${Date.now()}@example.test`,
  password: "Valid-password-123!",
  fullName: "Suppliers Manager",
};

const builderCredentials = {
  email: `suppliers-builder-${Date.now()}@example.test`,
  password: "Valid-password-123!",
  fullName: "Suppliers Builder",
};

let firebaseAuth: typeof import("@/lib/firebase/client").firebaseAuth;
let signIn: typeof import("@/lib/firebase/auth").signIn;
let signOut: typeof import("@/lib/firebase/auth").signOut;
let createSupplier: typeof import("@/lib/firebase/repositories/suppliers").createSupplier;
let listSuppliers: typeof import("@/lib/firebase/repositories/suppliers").listSuppliers;
let updateSupplier: typeof import("@/lib/firebase/repositories/suppliers").updateSupplier;

describe("Firebase suppliers repository", () => {
  beforeAll(async () => {
    vi.stubEnv("VITE_FIREBASE_USE_EMULATORS", "true");
    ({ firebaseAuth } = await import("@/lib/firebase/client"));
    ({ signIn, signOut } = await import("@/lib/firebase/auth"));
    ({ createSupplier, listSuppliers, updateSupplier } =
      await import("@/lib/firebase/repositories/suppliers"));

    await provisionEmulatorUser({ ...managerCredentials, role: "manager" });
    await signIn(managerCredentials.email, managerCredentials.password);
    await firebaseAuth.currentUser?.getIdToken(true);
  });

  afterAll(async () => {
    await signOut();
    vi.unstubAllEnvs();
  });

  test("creates a canonical supplier and makes repeated creation idempotent", async () => {
    const first = await createSupplier({ name: "Jedi Timber Supplies Repository" });
    const second = await createSupplier({ name: "  JEDI timber supplies repository  " });

    expect(first.id).toBe("jedi-timber-supplies-repository");
    expect(second.id).toBe(first.id);
    expect((await listSuppliers()).filter((supplier) => supplier.id === first.id)).toHaveLength(1);

    const updated = await updateSupplier(first.id, { name: "JEDI Timber Supplies Repository" });
    expect(updated.name).toBe("JEDI Timber Supplies Repository");
  });

  test("allows builders to read suppliers but not manage them", async () => {
    await signOut();
    await provisionEmulatorUser({ ...builderCredentials, role: "builder" });
    await signIn(builderCredentials.email, builderCredentials.password);

    expect((await listSuppliers()).some((supplier) => supplier.id === "jedi-timber-supplies-repository")).toBe(true);
    await expect(createSupplier({ name: "Builder forged supplier" })).rejects.toThrow("Manager access is required");
  });
});
