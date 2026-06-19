/// <reference types="node" />
import assert from "node:assert/strict";
import test from "node:test";
import { parseAuthSessionSnapshot, normalizeSessionUser } from "./authStorage";

test("normalizeSessionUser keeps required auth fields", () => {
  const user = normalizeSessionUser({
    userId: "user_123",
    customerId: "cust_123",
    email: "hello@example.com",
    emailVerified: true,
    phoneNumber: null,
    phoneVerified: false,
    displayName: "Ash",
    avatarUrl: null,
    authProvider: "GOOGLE",
  });

  assert.deepEqual(user, {
    userId: "user_123",
    customerId: "cust_123",
    email: "hello@example.com",
    emailVerified: true,
    phoneNumber: null,
    phoneVerified: false,
    displayName: "Ash",
    avatarUrl: null,
    authProvider: "GOOGLE",
  });
});

test("parseAuthSessionSnapshot rejects invalid payloads", () => {
  assert.equal(parseAuthSessionSnapshot(null), null);
  assert.equal(parseAuthSessionSnapshot("{"), null);
  assert.equal(parseAuthSessionSnapshot(JSON.stringify({ savedAtMs: Date.now() })), null);
});

test("parseAuthSessionSnapshot restores cached session user", () => {
  const snapshot = parseAuthSessionSnapshot(JSON.stringify({
    user: {
      userId: "user_123",
      customerId: "cust_123",
      email: "hello@example.com",
      emailVerified: true,
      phoneNumber: null,
      phoneVerified: false,
      displayName: "Ash",
      avatarUrl: null,
      authProvider: "EMAIL",
    },
    savedAtMs: 12345,
  }));

  assert.ok(snapshot);
  assert.equal(snapshot?.user.displayName, "Ash");
  assert.equal(snapshot?.savedAtMs, 12345);
});
