import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRoleAssignmentTarget,
  assertRoleRevocationTarget,
  authorizationGrantMatches,
} from "./firebase-role-safety.mjs";

const eligibleUser = () => ({
  uid: "verified-target-uid",
  email: "verified@example.test",
  emailVerified: true,
  disabled: false,
  providerData: [{ providerId: "password" }],
  customClaims: {},
});

const validate = (user) => assertRoleAssignmentTarget({
  user,
  targetEmail: "verified@example.test",
  targetUid: "verified-target-uid",
  expectedProvider: "password",
});

test("accepts only the exact verified identity and provider", () => {
  assert.doesNotThrow(() => validate(eligibleUser()));
});

test("rejects an unverified email before administrative role assignment", () => {
  assert.throws(
    () => validate({ ...eligibleUser(), emailVerified: false }),
    /target email is not verified/,
  );
});

test("rejects identity, provider, disabled-state, and enrollment mismatches", () => {
  const cases = [
    [{ ...eligibleUser(), uid: "other-uid" }, /target UID does not match/],
    [{ ...eligibleUser(), email: "other@example.test" }, /target email does not match/],
    [{ ...eligibleUser(), providerData: [{ providerId: "google.com" }] }, /provider does not match/],
    [{ ...eligibleUser(), disabled: true }, /target user is disabled/],
    [
      { ...eligibleUser(), customClaims: { invitationEnrollmentId: "active" } },
      /active invitation enrollment/,
    ],
  ];

  for (const [user, expectedError] of cases) {
    assert.throws(() => validate(user), expectedError);
  }
});

test("allows an exact disabled or unverified identity to be revoked", () => {
  assert.doesNotThrow(() => assertRoleRevocationTarget({
    user: { ...eligibleUser(), disabled: true, emailVerified: false },
    targetEmail: "verified@example.test",
    targetUid: "verified-target-uid",
    expectedProvider: "password",
  }));
  assert.throws(() => assertRoleRevocationTarget({
    user: { ...eligibleUser(), uid: "other-uid" },
    targetEmail: "verified@example.test",
    targetUid: "verified-target-uid",
    expectedProvider: "password",
  }), /target UID does not match/);
});

test("matches only an exact, timestamped authorization grant", () => {
  const grantId = "a".repeat(32);
  const grant = {
    active: true,
    role: "manager",
    grantId,
    updatedAt: { toMillis: () => 1_700_000_000_000 },
  };
  assert.equal(authorizationGrantMatches({ grant, role: "manager", grantId }), true);
  assert.equal(authorizationGrantMatches({ grant: { ...grant, active: false }, role: "manager", grantId }), false);
  assert.equal(authorizationGrantMatches({ grant: { ...grant, extra: true }, role: "manager", grantId }), false);
  assert.equal(authorizationGrantMatches({ grant, role: "admin", grantId }), false);
  assert.equal(authorizationGrantMatches({ grant, role: "manager", grantId: "short" }), false);
});
