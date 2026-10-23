"""The address names the open dataset, and the bare address is a clean start, in a real (headless) browser.

The operator, with no panel open, switched from bm_aging to tahoe: the address did not change, and a
refresh opened bm_aging again. Removing the dataset from the address opened the last one anyway.

1. Every way a dataset opens (the dataset browser, the desktop app's call, the back button beside the
   name) writes ``?dataset_path=<path relative to the data directory>``, panels or not; a reload opens that
   dataset. The first dataset replaces the welcome address; each later switch is a history entry
   (Back returns to the previous dataset).
2. A fresh visit to the bare address opens no dataset, although several were opened before: the
   welcome screen offers the recent ones and the dataset browser.
3. One store in the data directory is still opened at start (the server's choice, not leftover state),
   and the desktop app still reopens the dataset opened last.

Needs Playwright with Chromium; skipped without it, or failed when ANNZARRO_REQUIRE_BROWSER=1.
"""
import os
import urllib.parse

import pytest

from annzarro.tests.ui_helpers import browser_row, dataset_path, open_browser, open_dataset, wait_for_open

from .dsb_servers import Session, _copies, _require, single_server, start  # noqa: F401  (fixtures)

STORES = ("bm_aging.zarr", "tahoe_95.6M.zarr", "projects/lung_v2.zarr")
RECENTS_KEY = "'annzarro.recents:' + location.origin + '|local'"
DESKTOP = """(() => {
  const mark = () => document.documentElement.setAttribute('data-desktop', '');
  if (document.documentElement) mark(); else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); mark(); } }).observe(document, {childList: true});
  window.api = { platform: 'darwin', datasetOpened: () => {} };
})()"""


@pytest.fixture(scope="module")
def stores(tmp_path_factory):
    _require()
    tmp = tmp_path_factory.mktemp("address")
    data = tmp / "data"
    data.mkdir()
    _copies(data, STORES)
    base, proc = start(tmp, data)
    yield base, str(data)
    proc.terminate()
    proc.wait(20)


def _named(page):
    """The dataset_path of the address, or None."""
    return urllib.parse.parse_qs(urllib.parse.urlsplit(page.url).query).get("dataset_path", [None])[0]


def _wait_named(page, rel, timeout=10_000):
    page.wait_for_function("(want) => new URLSearchParams(location.search).get('dataset_path') === want",
                           arg=rel, timeout=timeout)


def _tiles(page):
    return page.locator(".tile-container .tile[data-tile-id]").count()


def test_the_address_follows_every_switch_with_no_panel_open_and_a_reload_opens_it(stores):
    base, data = stores
    s = Session(base)
    page = s.page
    try:
        assert _named(page) is None and dataset_path(page) is None
        history = page.evaluate("() => history.length")

        # the dataset browser
        open_browser(page, query="bm_aging")
        browser_row(page, "bm_aging.zarr").locator(".dsb-name").click()
        wait_for_open(page, "bm_aging.zarr")
        _wait_named(page, "bm_aging.zarr")
        assert _tiles(page) == 0 and "#" not in page.url

        # the desktop app's call (an absolute path): the address takes the data directory's name for it
        open_dataset(page, os.path.join(data, "tahoe_95.6M.zarr"))
        _wait_named(page, "tahoe_95.6M.zarr")
        assert page.url == f"{base}/?dataset_path=tahoe_95.6M.zarr", page.url

        # a store in a subfolder is named by its path below the data directory
        open_dataset(page, os.path.join(data, "projects", "lung_v2.zarr"))
        _wait_named(page, "projects/lung_v2.zarr")

        # the back button beside the name
        page.click("#dataset-back")
        wait_for_open(page, "tahoe_95.6M.zarr")
        _wait_named(page, "tahoe_95.6M.zarr")
        # the first dataset replaced the bare address; tahoe, lung and the way back to tahoe each added an entry
        assert page.evaluate("() => history.length") == history + 3

        # a reload opens the dataset of the address, not the one opened first
        page.reload()
        wait_for_open(page, "tahoe_95.6M.zarr")
        page.wait_for_timeout(1000)
        assert dataset_path(page).endswith("tahoe_95.6M.zarr") and _named(page) == "tahoe_95.6M.zarr"
        assert not s.errors, s.errors
    finally:
        s.close()


def test_a_fresh_visit_to_the_bare_address_opens_no_dataset(stores):
    base, data = stores
    s = Session(base)
    page = s.page
    try:
        open_dataset(page, os.path.join(data, "bm_aging.zarr"))
        open_dataset(page, os.path.join(data, "tahoe_95.6M.zarr"))
        _wait_named(page, "tahoe_95.6M.zarr")

        # the address emptied by hand (a navigation, not a reload): nothing opens, nothing is preselected
        page.goto(base + "/")
        page.evaluate("() => window.annzarro.ready")
        page.wait_for_timeout(1500)
        assert dataset_path(page) is None
        assert page.evaluate("() => window.annzarro.getDataset().status") == "none"
        assert _named(page) is None
        # the welcome screen offers the recent datasets and the browser
        welcome = page.locator(".welcome-open-dataset")
        welcome.wait_for(timeout=10_000)
        page.wait_for_selector(".welcome-open-dataset[data-recents='ready']", timeout=10_000)
        recents = welcome.locator(".welcome-recent")
        assert recents.count() == 2
        assert "tahoe_95.6M.zarr" in recents.first.inner_text()
        # and the reload of that tab stays clean too
        page.reload()
        page.evaluate("() => window.annzarro.ready")
        page.wait_for_timeout(1500)
        assert dataset_path(page) is None and _named(page) is None
        assert not s.errors, s.errors
    finally:
        s.close()


def test_the_only_store_opens_at_start_and_the_address_names_it(single_server):
    s = Session(single_server[0])
    try:
        wait_for_open(s.page, "only_one.zarr")
        _wait_named(s.page, "only_one.zarr")
    finally:
        s.close()


def test_the_desktop_app_reopens_the_dataset_opened_last(stores):
    base, data = stores
    s = Session(base, init_script=DESKTOP)
    page = s.page
    try:
        assert dataset_path(page) is None
        open_dataset(page, os.path.join(data, "bm_aging.zarr"))
        # the desktop app's next start loads the bare address
        page.goto(base + "/")
        wait_for_open(page, "bm_aging.zarr")
        _wait_named(page, "bm_aging.zarr")
        assert not s.errors, s.errors
    finally:
        s.close()
