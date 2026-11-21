"""The export hook says when the figure is final: `annzarroPlotState().pending` counts the automatic
size/opacity restyles still waiting or running, and the signature carries the resolved values, so
`annzarro export` (annzarro/export.py `_wait_until_drawn`) never captures an intermediate point size.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import json
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import waits  # noqa: E402
from annzarro.tests.browser.test_dark_theme import browser, server  # noqa: E402,F401  (fixtures)
from annzarro.tests.browser.test_plot_options import A, B, DRAWN, _link  # noqa: E402


def _state(page):
    return json.loads(page.evaluate("window.annzarroPlotState()"))


def test_pending_counts_an_automatic_restyle_and_ends_only_when_it_is_applied(browser, server):
    context = browser.new_context(viewport={"width": 1500, "height": 1000})
    page = context.new_page()
    try:
        page.goto(_link(server, None))
        for pid in (A, B):
            page.wait_for_function(DRAWN, arg=pid, timeout=60000)
        page.wait_for_function("() => JSON.parse(window.annzarroPlotState()).pending === 0", timeout=30000)
        before = _state(page)
        assert all(len(p) == 5 and p[4][0] for p in before["plots"]), "each plot reports its resolved point size"

        # a draw, zoom or resize asks for a restyle: it is pending until the follow-up has run
        page.evaluate("""(id) => { const gd = document.querySelector(`.tile[data-tile-id="${id}"] .js-plotly-plot`);
            window.__azRestyleSeen = 0; gd.__azFollowView(); }""", A)
        assert _state(page)["pending"] >= 1
        page.wait_for_function("() => JSON.parse(window.annzarroPlotState()).pending === 0", timeout=30000)
        settled = _state(page)
        waits.expect_stays(lambda: _state(page) == settled, "a settled figure must not change by itself",
                           page=page, seconds=1.0)
    finally:
        context.close()
