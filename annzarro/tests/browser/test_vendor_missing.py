"""A server that does not send a bundled library: the page says which, and how to fix it.

When static/vendor lost files (an incomplete install, a source checkout without
`python scripts/vendor_assets.py`), the page used to start anyway and stop with
"Can't find variable: bootstrap". utils/vendor-check.js (pure rules in
tests/js/vendor-check.test.mjs) names the missing libraries and files instead.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI).
"""
import os

import pytest

from annzarro.tests.browser.test_refresh_reads_disk import served  # noqa: F401  (fixture)

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")


def _open(root, block=None):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            if block:
                page.route(f"**/static/vendor/{block}", lambda route: route.fulfill(status=404, body="not found"))
            page.goto(root)
            # started (the chooser is drawn) or stopped with a notice
            page.wait_for_function("() => document.querySelector('#tile-container .tile-selector, #notification-container .notification')",
                                   timeout=30000)
            page.wait_for_timeout(1000)
            toasts = page.locator("#notification-container .notification").all_inner_texts()
            return toasts, errors
        finally:
            browser.close()


def test_a_missing_bootstrap_is_named_with_its_file_and_the_fix(served):  # noqa: F811
    root, _store = served
    toasts, errors = _open(root, block="js/bootstrap.bundle.min.js")
    text = "\n".join(toasts)
    assert "AnnZarro did not start" in text
    assert "Bootstrap (bootstrap.bundle.min.js)" in text
    assert "static/vendor" in text and "python scripts/vendor_assets.py" in text
    assert "find variable" not in text and "is not defined" not in text
    assert not [e for e in errors if "bootstrap" in e], errors


def test_nothing_is_said_when_everything_loads(served):  # noqa: F811
    root, _store = served
    toasts, _errors = _open(root)
    assert not [t for t in toasts if "did not start" in t]
