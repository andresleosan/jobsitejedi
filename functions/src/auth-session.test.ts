import assert from "node:assert/strict";
import test from "node:test";
import { hasCurrentAuthSession, hasRecentAuthentication } from "./auth-session.js";

const validAfter = "2026-08-31T05:00:00.000Z";
const validAfterSeconds = Date.parse(validAfter) / 1_000;

test("accepts only auth_time at or after tokensValidAfterTime", () => {
  assert.equal(hasCurrentAuthSession(validAfter, validAfterSeconds - 1), false);
  assert.equal(hasCurrentAuthSession(validAfter, validAfterSeconds), true);
  assert.equal(hasCurrentAuthSession(validAfter, validAfterSeconds + 1), true);
});

test("fails closed for missing, malformed, fractional, or non-positive session values", () => {
  assert.equal(hasCurrentAuthSession(undefined, validAfterSeconds), false);
  assert.equal(hasCurrentAuthSession("not-a-date", validAfterSeconds), false);
  assert.equal(hasCurrentAuthSession(validAfter, 0), false);
  assert.equal(hasCurrentAuthSession(validAfter, validAfterSeconds + 0.5), false);
  assert.equal(hasCurrentAuthSession(validAfter, String(validAfterSeconds)), false);
});

test("requires privileged invitation authentication within five minutes", () => {
  const now = 2_000_000_000;
  assert.equal(hasRecentAuthentication(now, now), true);
  assert.equal(hasRecentAuthentication(now - 300, now), true);
  assert.equal(hasRecentAuthentication(now - 301, now), false);
  assert.equal(hasRecentAuthentication(now + 1, now), false);
  assert.equal(hasRecentAuthentication("2000000000", now), false);
});
