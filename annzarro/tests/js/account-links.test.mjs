import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.document = { querySelector: () => null };
const { accountLinks } = await import("../../../static/js/utils/account-links.js");

test("an admin gets the admin link", () => {
  const links = accountLinks({ auth_enabled: true, username: "root", is_admin: true });
  assert.deepEqual(links.map((l) => [l.id, l.href]), [["admin", "/admin"]]);
});

test("an ordinary user, a server without login and no answer get none", () => {
  assert.deepEqual(accountLinks({ auth_enabled: true, username: "bob", is_admin: false }), []);
  assert.deepEqual(accountLinks({ auth_enabled: false, username: null, is_admin: false }), []);
  assert.deepEqual(accountLinks(null), []);
});
