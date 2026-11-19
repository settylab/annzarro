"""A link or panel set that is overtaken builds nothing more.

Opening another dataset while a link is still opening used to abort the link's dataset load but not
the rest of it: the link's layout was then built and drawn on the dataset the user had just chosen.
The user's own choice wins: the link's panels are never created, and the new dataset opens as a plain
switch does (blank dashboard).

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

from annzarro.tests.browser.loading_helpers import OPEN_TILES, make_link, slow, start_server
from annzarro.tests.ui_helpers import BROWSER, browser_row, open_browser, wait_for_open

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    root, proc, data = start_server(tmp_path_factory)
    yield root, data
    proc.terminate()
    proc.wait(10)


def test_switching_dataset_mid_link_drops_the_links_panels(server):
    root, data = server
    link = make_link(root, data / "fixture_small.zarr")
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_context(viewport={"width": 1400, "height": 900}).new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            slow(page, 1200)
            page.goto(link, wait_until="commit")
            page.wait_for_function("() => window.annzarro && window.annzarro.getDataset && "
                                   "window.annzarro.getDataset().status === 'opening'", timeout=60000)
            page.click("#dataset-button")
            page.locator(BROWSER).wait_for(state="visible", timeout=60000)
            row = browser_row(page, "other_small.zarr")
            row.first.wait_for(timeout=60000)
            row.first.locator(".dsb-name").click()
            wait_for_open(page, "other_small.zarr", timeout=90000)
            page.wait_for_timeout(5000)
            assert page.evaluate(OPEN_TILES) == [], "the link's panels were built on the other dataset"
            assert page.evaluate("() => document.querySelectorAll('.js-plotly-plot').length") == 0
            assert errors == []
        finally:
            page.unroute_all(behavior="ignoreErrors")
            browser.close()


def test_back_during_a_switch_stops_the_older_load_and_shows_the_entry(server):
    root, data = server
    ids = ("cell-plot-A", "gene-plot-B")
    link = make_link(root, data / "fixture_small.zarr", ids=ids)
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_context(viewport={"width": 1400, "height": 900}).new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        try:
            page.goto(link)
            wait_for_open(page)
            page.wait_for_function("() => document.querySelectorAll('.js-plotly-plot').length >= 2", timeout=60000)
            page.wait_for_timeout(1000)
            # a change that settles into a history entry of its own
            page.locator(".tile[data-tile-id='gene-plot-B'] .tile-close").first.click()
            page.wait_for_function("() => document.querySelectorAll('.tile-container .tile[data-tile-id]').length === 1")
            page.wait_for_function("() => (history.state && history.state.azIdx) >= 1", timeout=15000)
            page.wait_for_timeout(800)
            # start opening the other dataset, slowly, then step Back before it is open
            slow(page, 1500)
            page.click("#dataset-button")
            page.locator(BROWSER).wait_for(state="visible", timeout=30000)
            row = browser_row(page, "other_small.zarr")
            row.first.wait_for(timeout=30000)
            row.first.locator(".dsb-name").click()
            page.wait_for_function("() => window.annzarro.getDataset().status === 'opening'", timeout=30000)
            page.evaluate("() => history.back()")
            page.wait_for_function("() => window.annzarro.getDataset().status === 'open' "
                                   "&& window.annzarro.getDataset().path.endsWith('fixture_small.zarr')", timeout=90000)
            page.wait_for_function("() => document.querySelectorAll('.js-plotly-plot').length >= 2", timeout=90000)
            page.wait_for_timeout(4000)
            assert sorted(page.evaluate(OPEN_TILES)) == sorted(ids)
            assert page.evaluate("() => window.annzarro.getDataset().path").endswith("fixture_small.zarr")
            assert errors == []
        finally:
            page.unroute_all(behavior="ignoreErrors")
            browser.close()
