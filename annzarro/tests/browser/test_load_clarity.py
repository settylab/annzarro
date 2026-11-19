"""A link or panel set shows what is loading from the first frame, and disables nothing it need not.

Headless Chromium on the committed fixture, with the data requests held for a second or so (a slow
shared filesystem):

1. A link of three panels: every tile is named in a skeleton, with the dataset's name in the line in
   the dataset bar, soon after the page starts and long before any data arrives. The header, the
   dataset browser and the dataset button stay enabled. A tile is aria-busy until it is drawn.
   When everything is drawn the line and the skeleton are gone and nothing is busy.
2. A panel set loaded from the Load dialog: the dialog closes at once (no backdrop over the page),
   and the page shows the named tiles and the line.
3. A panel that is still loading can be closed.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os
import time

import pytest

from annzarro.tests.browser.loading_helpers import OPEN_TILES, make_link, slow, start_server
from annzarro.tests.ui_helpers import BROWSER, wait_for_open

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

DELAY = 1200
SKEL = ".az-skel-tile"


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    root, proc, data = start_server(tmp_path_factory)
    yield root, data
    proc.terminate()
    proc.wait(10)


@pytest.fixture()
def page(request):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        pg = browser.new_context(viewport={"width": 1400, "height": 900}).new_page()
        pg.errors = []
        pg.on("pageerror", lambda e: pg.errors.append(str(e)))
        yield pg
        pg.unroute_all(behavior="ignoreErrors")
        browser.close()


def _enabled(page, selector):
    return page.evaluate("(s) => { const e = document.querySelector(s); return !!e && !e.disabled "
                         "&& getComputedStyle(e).pointerEvents !== 'none'; }", selector)


def test_link_names_every_tile_from_the_start(server, page):
    root, data = server
    link = make_link(root, data / "fixture_small.zarr")
    slow(page, DELAY)
    t0 = time.time()
    page.goto(link, wait_until="commit")
    page.wait_for_selector(SKEL, timeout=5000)
    first = time.time() - t0
    names = page.eval_on_selector_all(f"{SKEL} .az-skel-name", "els => els.map(e => e.textContent)")
    assert names == ["Cell plot · UMAP · coloured by cell_type", "Gene plot", "Cell table"], names
    line = page.inner_text("#load-progress")
    assert "fixture_small.zarr" in line and "3 panels" in line, line
    # nothing is covered or disabled that the load does not need
    assert page.locator(".modal-backdrop").count() == 0
    assert page.evaluate("() => document.getElementById('load-skeleton').getAttribute('aria-hidden')") == "true"
    assert page.get_attribute("#load-progress", "aria-live") == "polite"
    # still before any data: the header and the dataset button work (the browser opens once the app has started)
    for sel in ("#btn-load-session", "#btn-share-link", "#theme-toggle button", "#dataset-button"):
        if page.locator(sel).count():
            assert _enabled(page, sel) or sel == "#btn-share-link", sel
    assert first < 2.0, f"first named frame took {first:.2f}s"
    page.wait_for_selector(".js-plotly-plot", timeout=60000)
    # busy while loading, then cleared
    page.wait_for_function("() => document.querySelectorAll('.tile[aria-busy]').length === 0 "
                           "&& document.querySelectorAll('.js-plotly-plot').length >= 2 "
                           "&& document.getElementById('load-progress').hidden", timeout=60000)
    assert page.locator(SKEL).count() == 0
    assert len(page.evaluate(OPEN_TILES)) == 3
    assert page.errors == []


def test_tiles_are_busy_then_ready_and_a_loading_panel_closes(server, page):
    root, data = server
    link = make_link(root, data / "fixture_small.zarr")
    slow(page, DELAY)
    page.goto(link, wait_until="commit")
    page.wait_for_selector(".tile[data-tile-id][aria-busy='true']", timeout=60000)
    # the header, other panels and the dataset browser stay usable while a panel loads
    assert _enabled(page, "#btn-load-session") and _enabled(page, "#dataset-button")
    page.click("#dataset-button")
    page.locator(BROWSER).wait_for(state="visible", timeout=30000)
    page.locator(f"{BROWSER} .btn-close").first.click()
    page.locator(BROWSER).wait_for(state="hidden", timeout=10000)
    busy = page.locator(".tile[data-tile-id][aria-busy='true']").first
    tile_id = busy.get_attribute("data-tile-id")
    busy.locator(".tile-close").first.click()
    page.wait_for_function("(id) => !document.querySelector(`.tile[data-tile-id='${id}']`)", arg=tile_id, timeout=20000)
    page.wait_for_function("() => document.querySelectorAll('.tile[aria-busy]').length === 0", timeout=60000)
    assert page.errors == []


def test_a_panel_set_load_closes_the_dialog_and_shows_its_tiles(server, page):
    root, data = server
    link = make_link(root, data / "fixture_small.zarr")
    page.goto(link)
    wait_for_open(page)
    page.wait_for_selector(".js-plotly-plot", timeout=60000)
    page.wait_for_timeout(1500)
    page.click("#btn-save-session")
    page.fill("#session-name", "clarity-set")
    page.click("#btn-confirm-session")
    page.wait_for_function("() => document.getElementById('session-modal').offsetParent === null")
    page.wait_for_selector(".modal-backdrop", state="detached")
    # a fresh page, welcome screen, slow data
    page.goto(root + "/")
    page.wait_for_function("() => !!(window.annzarro && window.annzarro.ready)", timeout=60000)
    slow(page, DELAY)
    page.click("#btn-load-session")
    card = page.locator(".session-card[data-session-name='clarity-set']")
    card.wait_for(timeout=30000)
    card.locator(".load-actions[data-status='ready']").wait_for(timeout=30000)
    card.locator(".session-load").click()
    page.wait_for_selector(SKEL, timeout=5000)
    assert page.locator("#session-modal.show").count() == 0 or page.wait_for_selector("#session-modal.show", state="hidden", timeout=2000) is None
    assert "clarity-set" in page.inner_text("#load-progress")
    page.wait_for_function("() => document.querySelectorAll('.js-plotly-plot').length >= 2 "
                           "&& document.getElementById('load-progress').hidden "
                           "&& document.querySelectorAll('.tile[aria-busy]').length === 0", timeout=90000)
    assert page.locator(".modal-backdrop").count() == 0
    assert page.errors == []


@pytest.fixture(scope="module")
def large_server(tmp_path_factory):
    # every cell counts as "large" (large-plot mode), as in test_large_plot_mode.py
    root, proc, data = start_server(tmp_path_factory, config="ui:\n  defaults:\n    large_plot_points: 100\n")
    yield root, data
    proc.terminate()
    proc.wait(10)


def test_a_large_plot_link_names_its_tile_and_ends_clean(large_server, page):
    root, data = large_server
    link = make_link(root, data / "fixture_small.zarr", ids=("cell-plot-A",))
    slow(page, DELAY)
    page.goto(link, wait_until="commit")
    page.wait_for_selector(SKEL, timeout=5000)
    assert "UMAP" in page.inner_text(f"{SKEL} .az-skel-name")
    assert _enabled(page, "#btn-load-session")
    page.wait_for_selector(".tile[aria-busy='true']", timeout=60000)
    page.wait_for_function("() => document.querySelectorAll('.js-plotly-plot').length >= 1 "
                           "&& document.querySelectorAll('.tile[aria-busy]').length === 0 "
                           "&& document.getElementById('load-progress').hidden", timeout=60000)
    assert page.errors == []
