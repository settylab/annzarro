// Guard for the panel-set permission helpers (static/js/utils/session-permissions.js).
//
// The server owns the rule; these helpers decide what the dialog OFFERS and
// what it SAYS when refused. Pinned here:
//
//   * a 403 body's sentence reaches the user instead of "FORBIDDEN", and a
//     body that is not JSON still yields a message;
//   * a listed set is locked only when the server says can_modify === false
//     (an older server that sends nothing keeps the old behaviour);
//   * the lock sentence names the owner, or says "admin only" for legacy sets;
//   * the header badge is silent locally, names the user when signed in, and
//     warns when the server is exposed without login;
//   * user-controlled strings are escaped before reaching innerHTML.
//
// Run: `node --test annzarro/tests/js/session-permissions.test.mjs`. Also
// driven by the pytest wrapper test_js_coverage.py.
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = path.resolve(
  __dirname,
  "../../../static/js/utils/session-permissions.js"
);

const {
  escapeHtml,
  canModify,
  lockReason,
  errorFromResponse,
  describeFailure,
  authIndicator,
} = await import(pathToFileURL(MODULE_PATH).href);

function jsonResponse(status, body, statusText = "") {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { "Content-Type": "application/json" },
  });
}

test("a 403 keeps the server's sentence, reason and owner", async () => {
  const result = await errorFromResponse(
    jsonResponse(403, {
      error: "Panel set 'x' belongs to alice; only alice or an admin can delete it.",
      reason: "not_owner",
      owner: "alice",
    }, "FORBIDDEN")
  );
  assert.equal(result.status, "error");
  assert.equal(result.httpStatus, 403);
  assert.equal(result.reason, "not_owner");
  assert.equal(result.owner, "alice");
  assert.match(result.message, /belongs to alice/);
  assert.doesNotMatch(result.message, /FORBIDDEN/);
});

test("a non-JSON failure still produces a message", async () => {
  const result = await errorFromResponse(
    new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" })
  );
  assert.equal(result.httpStatus, 502);
  assert.equal(result.reason, null);
  assert.match(result.message, /502/);
});

test("a 409 body's `message` is used when there is no `error`", async () => {
  const result = await errorFromResponse(jsonResponse(409, { status: "conflict", message: "exists" }));
  assert.equal(result.message, "exists");
});

test("a refusal is a warning, anything else stays an error", () => {
  assert.deepEqual(describeFailure({ httpStatus: 403 }, "Failed"), { title: "Not allowed", type: "warning" });
  assert.deepEqual(describeFailure({ httpStatus: 500 }, "Failed"), { title: "Failed", type: "error" });
  assert.deepEqual(describeFailure({ status: "error" }, "Failed"), { title: "Failed", type: "error" });
});

test("only an explicit can_modify === false locks a set", () => {
  assert.equal(canModify({ can_modify: true }), true);
  assert.equal(canModify({}), true, "an older server sends no can_modify");
  assert.equal(canModify({ can_modify: false }), false);
  assert.equal(lockReason({ can_modify: true, owner: "alice" }), null);
});

test("the lock sentence names the owner, or says admin-only for legacy sets", () => {
  assert.match(lockReason({ can_modify: false, owner: "alice" }), /Belongs to alice/);
  assert.match(lockReason({ can_modify: false, owner: null }), /Only an admin/);
});

test("header badge: silent locally, names the user, warns when exposed", () => {
  assert.equal(authIndicator(null), null);
  assert.equal(authIndicator({ auth_enabled: false, username: null, is_admin: false, exposed: false }), null);

  const exposed = authIndicator({ auth_enabled: false, username: null, is_admin: false, exposed: true });
  assert.equal(exposed.text, "No login");
  assert.equal(exposed.variant, "warning");
  assert.equal(exposed.href, null);

  const user = authIndicator({ auth_enabled: true, username: "bob", is_admin: false, exposed: false });
  assert.equal(user.text, "bob");
  assert.equal(user.href, "/logout");

  const admin = authIndicator({ auth_enabled: true, username: "root", is_admin: true, exposed: false });
  assert.equal(admin.text, "root (admin)");
  assert.match(admin.title, /any panel set/);
});

test("escapeHtml neutralises markup from uploaded panel-set files", () => {
  assert.equal(
    escapeHtml(`<img src=x onerror="alert('1')">&`),
    "&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;&amp;"
  );
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(undefined), "");
});
