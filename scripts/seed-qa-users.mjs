import {
  assertAuthEmulatorOnly,
  provisionEmulatorUser,
} from "./lib/firebase-auth-emulator.mjs";

const password = process.env.QA_TEST_PASSWORD;
if (typeof password !== "string" || password.length < 6) {
  console.error(
    "[qa-seed] QA_TEST_PASSWORD is required and must contain at least 6 characters; its value is never logged.",
  );
  process.exit(1);
}

const { emulatorHost, projectId } = assertAuthEmulatorOnly();
const fixtures = [
  {
    email: "admin@admin.com",
    displayName: "QA Admin",
    role: "admin",
  },
  {
    email: "manager@manager.com",
    displayName: "QA Manager",
    role: "manager",
  },
  {
    email: "builder@builder.com",
    displayName: "QA Builder",
    role: "builder",
  },
];

for (const fixture of fixtures) {
  await provisionEmulatorUser({ ...fixture, password });
}

const verifyPasswordSignIn = async (fixture) => {
  const response = await fetch(
    `http://${emulatorHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-emulator`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: fixture.email,
        password,
        returnSecureToken: true,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`[qa-seed] Password sign-in verification failed for ${fixture.email}`);
  }

  const body = await response.json();
  if (typeof body.idToken !== "string") {
    throw new Error(`[qa-seed] Auth Emulator returned no token for ${fixture.email}`);
  }
  const encodedClaims = body.idToken.split(".")[1];
  if (!encodedClaims) throw new Error(`[qa-seed] Auth Emulator returned an invalid token`);
  const claims = JSON.parse(Buffer.from(encodedClaims, "base64url").toString("utf8"));
  const actualRole = typeof claims.role === "string" ? claims.role : null;
  if (actualRole !== fixture.role) {
    throw new Error(`[qa-seed] Sign-in claim verification failed for ${fixture.email}`);
  }
};

for (const fixture of fixtures) {
  await verifyPasswordSignIn(fixture);
}

console.log(`[qa-seed] Prepared and verified ${fixtures.length} users in Auth Emulator project ${projectId}.`);
for (const fixture of fixtures) {
  console.log(`- ${fixture.email}: ${fixture.role}`);
}
console.log("[qa-seed] No password, token, or production credential was written or printed.");
