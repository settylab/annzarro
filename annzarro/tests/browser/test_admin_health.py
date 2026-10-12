"""The admin page's Health section in a real browser.

A server with login on, run in this process on a werkzeug thread (so the test
can put something in its cache), an admin and a user made through the auth
manager. The admin opens /admin#health:

* the worker table shows this process and its cache;
* a refusal the user draws (403 admin_only from /cache/info) shows up under
  "Refusals by reason" after a reload;
* "Clear cache" asks once (Cancel leaves the cache alone), then empties the
  cache, says so, and the audit log holds the record;
* the console has no errors and no CSP violations.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import os
import threading

import numpy as np
import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

from werkzeug.serving import make_server

from annzarro.core import zarr_reader
from annzarro.server.admin import audit
from annzarro.tests.server.admin_helpers import ADMIN, PASSWORD, USER, make_app


@pytest.fixture(scope="module")
def served(tmp_path_factory):
    app = make_app(tmp_path_factory.mktemp("health"))
    server = make_server("127.0.0.1", 0, app, threaded=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield app, f"http://127.0.0.1:{server.server_port}"
    server.shutdown()
    thread.join(10)


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        yield browser
        browser.close()


def _sign_in(browser, base, username):
    context = browser.new_context(viewport={"width": 1300, "height": 900})
    page = context.new_page()
    page.goto(base + "/login")
    page.fill("input[name=username]", username)
    page.fill("input[name=password]", PASSWORD)
    page.click("button[type=submit], input[type=submit]")
    page.wait_for_url(lambda url: not url.endswith("/login"))
    return context, page


def test_the_health_section(served, browser):
    app, base = served
    zarr_reader.clear_cache()
    zarr_reader._add_to_cache("path:%2Fd%2Fone.zarr:test_data", np.zeros((1000, 1000)), "matrix")

    user_context, user_page = _sign_in(browser, base, USER)
    reply = user_page.request.get(base + "/api/v1/cache/info")
    assert reply.status == 403

    context, page = _sign_in(browser, base, ADMIN)
    problems = []
    page.on("console", lambda m: m.type == "error" and problems.append(m.text))
    page.on("pageerror", lambda e: problems.append(str(e)))
    page.goto(base + "/admin#health")
    page.wait_for_selector("#admin-health-workers")
    assert page.inner_text("#admin-health-workers").startswith("1 ")
    assert str(os.getpid()) in page.inner_text("table")
    assert "admin_only 1" in page.inner_text("main, #admin-main")
    assert "7.6 MB" in page.inner_text("table")                      # the 1000 x 1000 float64 matrix

    # Cancel leaves the cache alone
    page.click("#admin-cache-clear")
    assert "Clear the cache of every worker?" in page.inner_text("#admin-main")
    page.click("text=Cancel")
    page.wait_for_selector("#admin-cache-clear")
    assert zarr_reader.get_cache_info()["item_counts"]["total"] == 1

    page.click("#admin-cache-clear")
    page.click("#admin-cache-confirm")
    page.wait_for_selector("text=Cache cleared.")
    page.wait_for_selector("#admin-cache-clear")
    assert zarr_reader.get_cache_info()["item_counts"]["total"] == 0
    last = audit.read(app.admin_dir, limit=1)[0]
    assert (last["action"], last["actor"], last["outcome"]) == ("cache.clear", ADMIN, "ok")
    assert problems == []
    context.close()
    user_context.close()
