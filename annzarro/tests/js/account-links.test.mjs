import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.document = { querySelector: () => null };
const { accountLinks } = await import("../../../static/js/utils/account-links.js");

test("an admin gets the admin link and the password link", () => {
  const links = accountLinks({ auth_enabled: true, username: "root", is_admin: true });
  assert.deepEqual(links.map((l) => [l.id, l.href]), [["admin", "/admin"], ["password", "/account/password"]]);
});

test("an ordinary user gets only the password link", () => {
  const links = accountLinks({ auth_enabled: true, username: "bob", is_admin: false });
  assert.deepEqual(links.map((l) => l.id), ["password"]);
});

test("a server without login and no answer get none", () => {
  assert.deepEqual(accountLinks({ auth_enabled: false, username: null, is_admin: false }), []);
  assert.deepEqual(accountLinks(null), []);
});
