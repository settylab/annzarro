"""The app waits for the bundled font before it starts (main.js, utils/fonts.js fontsReady), so a font that fails must not stop it.

A font file answered with 404, and one that never comes back in time, both leave a working app: the panels open and draw in the
fallback font. Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_gene_panel import served, page, _url  # noqa: E402,F401
from annzarro.tests.browser.test_cell_gene_plot_options import _configs, CP, _drawn  # noqa: E402

FONT = "**/OpenSans-latin-greek.woff2*"


def test_a_missing_font_file_still_starts_the_app(page, served):
    asked = []

    def missing(route):
        asked.append(route.request.url)
        route.fulfill(status=404, body="not found")

    page.route(FONT, missing)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    configs, pid = _configs("cell-plot", styleDefault=True)
    page.goto(_url(served, [pid], configs))
    _drawn(page, pid)                                    # the panel opened and drew
    assert asked, "the font file was not asked for"
    assert page.evaluate("() => !document.fonts.check('12px \"Open Sans\"') || document.fonts.status === 'loaded'")
    assert page.evaluate("(id) => !!window.PanelManager.getPanel(id)", pid)
    assert not errors, errors


def test_a_font_that_never_answers_does_not_hold_the_app_back_for_ever(page, served):
    held = []
    page.route(FONT, lambda route: held.append(route))     # never continued: the request hangs
    configs, pid = _configs("cell-plot", styleDefault=True)
    page.goto(_url(served, [pid], configs), wait_until="commit")     # a held font file keeps the load event waiting too
    _drawn(page, pid)                                    # fontsReady gives up after 5 s and the app starts
    assert held, "the font file was not asked for"
