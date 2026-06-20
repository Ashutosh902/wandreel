import test from "node:test";
import assert from "node:assert/strict";
import { buildClearSessionCookie, buildSessionCookie } from "./postgresAuth";

test("production session cookie uses cross-site safe attributes", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";

  try {
    const cookie = buildSessionCookie("token123");
    assert.match(cookie, /wr_session=token123/);
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=None/);
    assert.match(cookie, /Secure/);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
  }
});

test("local dev session cookie keeps lax same-site without secure", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";

  try {
    const cookie = buildSessionCookie("token123");
    assert.match(cookie, /SameSite=Lax/);
    assert.doesNotMatch(cookie, /Secure/);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
  }
});

test("clear session cookie mirrors production cross-site attributes", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";

  try {
    const cookie = buildClearSessionCookie();
    assert.match(cookie, /wr_session=/);
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=None/);
    assert.match(cookie, /Max-Age=0/);
    assert.match(cookie, /Secure/);
  } finally {
    process.env.NODE_ENV = previousNodeEnv;
  }
});
