// Guard for static/js/utils/session-expiry.js: when the login expires
// mid-session, the first "login required" 401 sends the browser to the login
// page with a way back to the CURRENT view; nothing else is affected.
//
// Run: `node --test annzarro/tests/js/session-expiry.test.mjs`.
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOD = pathToFileURL(path.resolve(__dirname, "../../../static/js/utils/session-expiry.js")).href;
const { installSessionExpiryHandler, isLoginRequired, loginUrlFor } = await import(MOD);

const ORIGIN = "https://lab.example.org";
const json = (status, body) => new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json" } });

function fakeWindow(responder) {
    const calls = [];
    const win = {
        location: { href: `${ORIGIN}/explore/?dataset_path=a.zarr`, origin: ORIGIN },
        fetch: async (input) => { calls.push(String(input)); return responder(input); },
    };
    return { win, calls };
}

test("login URL carries path and query in next and the view in its own fragment", () => {
    const view = `${ORIGIN}/explore/?dataset_path=a.zarr&x=1#view=abc`;
    assert.equal(loginUrlFor(view, "/explore", ORIGIN),
        "/explore/login?next=%2Fexplore%2F%3Fdataset_path%3Da.zarr%26x%3D1#view=abc");
    assert.equal(loginUrlFor(`${ORIGIN}/?dataset_path=a.zarr#view=z`, "", ORIGIN),
        "/login?next=%2F%3Fdataset_path%3Da.zarr#view=z");
});

test("a return URL on another origin is dropped (no open redirect via the client)", () => {
    assert.equal(loginUrlFor("https://evil.example/x#view=1", "", ORIGIN), "/login");
    assert.equal(loginUrlFor("not a url at all", "/explore", "not an origin"), "/explore/login");
});

test("only the login-required 401 counts", async () => {
    assert.equal(await isLoginRequired(json(401, { error: "Authentication required", reason: "login_required" })), true);
    assert.equal(await isLoginRequired(json(401, { error: "Authentication required" })), true, "older servers");
    assert.equal(await isLoginRequired(json(401, { error: "Invalid credentials" })), false);
    assert.equal(await isLoginRequired(json(403, { reason: "login_required" })), false);
    assert.equal(await isLoginRequired(new Response("<html>", { status: 401 })), false);
    assert.equal(await isLoginRequired(json(200, {})), false);
});

test("first expired-login response navigates once, with the current view", async () => {
    const { win } = fakeWindow(() => json(401, { error: "Authentication required", reason: "login_required" }));
    const went = [];
    const uninstall = installSessionExpiryHandler({
        win, root: "/explore", navigate: url => went.push(url),
        currentViewUrl: async () => `${ORIGIN}/explore/?dataset_path=a.zarr#view=CURRENT`,
    });
    try {
        const r1 = await win.fetch("/explore/api/v1/data/obs");
        const r2 = await win.fetch("/explore/api/v1/data/var");
        assert.equal(r1.status, 401, "callers still get the response");
        assert.equal(r2.status, 401);
        assert.deepEqual(went, ["/explore/login?next=%2Fexplore%2F%3Fdataset_path%3Da.zarr#view=CURRENT"]);
    } finally {
        uninstall();
    }
});

test("other responses pass through untouched", async () => {
    const { win } = fakeWindow(() => json(404, { reason: "key_not_found" }));
    const went = [];
    const uninstall = installSessionExpiryHandler({ win, navigate: url => went.push(url), currentViewUrl: () => "" });
    try {
        const r = await win.fetch("/api/v1/data/layer/nope");
        assert.equal(r.status, 404);
        assert.deepEqual(await r.json(), { reason: "key_not_found" }, "body still readable by the caller");
        assert.deepEqual(went, []);
    } finally {
        uninstall();
    }
});

test("a view that cannot be encoded still returns to the current page", async () => {
    const { win } = fakeWindow(() => json(401, { reason: "login_required" }));
    const went = [];
    const uninstall = installSessionExpiryHandler({
        win, root: "/explore", navigate: url => went.push(url),
        currentViewUrl: () => { throw new Error("no layout yet"); },
    });
    try {
        await win.fetch("/explore/api/v1/config");
        assert.deepEqual(went, ["/explore/login?next=%2Fexplore%2F%3Fdataset_path%3Da.zarr"]);
    } finally {
        uninstall();
    }
});

test("installing twice wraps fetch once", async () => {
    const { win, calls } = fakeWindow(() => json(200, {}));
    const u1 = installSessionExpiryHandler({ win, currentViewUrl: () => "" });
    const u2 = installSessionExpiryHandler({ win, currentViewUrl: () => "" });
    assert.equal(u1, u2);
    await win.fetch("/api/v1/config");
    assert.equal(calls.length, 1);
    u1();
});
