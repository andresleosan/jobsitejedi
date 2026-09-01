import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeAccessRequestInput,
  normalizeAccessRequestReviewInput,
  type AccessRequestRole,
} from "./access-requests.js";

test("normalizes a valid access request without accepting a client role claim", () => {
  assert.deepEqual(
    normalizeAccessRequestInput({
      requestedRole: " manager ",
      fullName: "  New Manager  ",
      phone: " +57 300 123 4567 ",
    }),
    {
      requestedRole: "manager",
      fullName: "New Manager",
      phone: "+57 300 123 4567",
    },
  );
});

test("rejects malformed access requests and unsupported roles", () => {
  assert.throws(
    () => normalizeAccessRequestInput({ requestedRole: "owner", fullName: "Someone" }),
    /requested role/i,
  );
  assert.throws(
    () => normalizeAccessRequestInput({ requestedRole: "builder", fullName: "" }),
    /full name/i,
  );
  assert.throws(
    () => normalizeAccessRequestInput({ requestedRole: "admin", fullName: "Someone", phone: "x".repeat(21) }),
    /phone/i,
  );
});

test("accepts only approve or reject review decisions", () => {
  assert.deepEqual(
    normalizeAccessRequestReviewInput({ requestId: "user-12345", decision: "approve" }),
    { requestId: "user-12345", decision: "approve", reason: null },
  );
  assert.deepEqual(
    normalizeAccessRequestReviewInput({ requestId: "user-12345", decision: "reject", reason: "  Not enough detail  " }),
    { requestId: "user-12345", decision: "reject", reason: "Not enough detail" },
  );
  assert.throws(
    () => normalizeAccessRequestReviewInput({ requestId: "", decision: "approve" }),
    /request id/i,
  );
  assert.throws(
    () => normalizeAccessRequestReviewInput({ requestId: "user-12345", decision: "pending" }),
    /decision/i,
  );
});

test("keeps the role contract limited to the three application roles", () => {
  const roles: AccessRequestRole[] = ["admin", "manager", "builder"];
  assert.deepEqual(roles, ["admin", "manager", "builder"]);
});
