"""The Focused Cell box does not send a dataset-wide name search for a dataset
whose names are too many to index.

A dataset-wide cell-name search (``scope=dataset``) makes the server build an
index of every cell name, and at a billion cells that is tens of GB. Under a
cell subset the Focused Cell box sent one on every keystroke (for the cells
the subset hides). The server now refuses an index over its memory budget
(``server.name_index_max_mb``) and says so in /data/names/status
('streaming'); the box then searches the cells shown only.

The store is the 50-cell one of test_focus_outside_subset. Two servers:

* a budget too small for any index: typing sends no scope=dataset search,
  and the cells shown are still found;
* the default budget (the control): the same typing does send one, so the
  first assertion is not satisfied by accident.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1.
"""
import os
import urllib.parse

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

import annzarro  # noqa: E402
from annzarro.tests.browser import test_focus_outside_subset as _focus  # noqa: E402
from annzarro.tests.browser.test_focus_outside_subset import _link, _part_rows  # noqa: E402


def _serve(tmp_path_factory, config=None):
    """The server of test_focus_outside_subset, running the code under test:
    its console script may belong to another checkout (an editable install),
    so the package's own directory goes first on the server's path."""
    root = os.path.dirname(os.path.dirname(os.path.abspath(annzarro.__file__)))
    old = os.environ.get("PYTHONPATH")
    os.environ["PYTHONPATH"] = root + (os.pathsep + old if old else "")
    try:
        return _focus._serve(tmp_path_factory, config)
    finally:
        if old is None:
            del os.environ["PYTHONPATH"]
        else:
            os.environ["PYTHONPATH"] = old


@pytest.fixture(scope="module")
def tiny_budget_server(tmp_path_factory):
    # 0.0002 MB = 200 bytes: no index of 50 names fits
    proc, root, store = _serve(tmp_path_factory, "server:\n  name_index_max_mb: 0.0002\n")
    yield root, store
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def default_server(tmp_path_factory):
    proc, root, store = _serve(tmp_path_factory)
    yield root, store
    proc.terminate()
    proc.wait(10)


def _type_in_focus_box(root, store, text):
    """Open part 2 of the subset, type ``text`` in the Focused Cell box, and
    return (the /data/names requests' query strings, the names offered)."""
    seen = []
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            page.on("request", lambda r: seen.append(dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(r.url).query)))
                    if "/data/names" in r.url and "/status" not in r.url else None)
            page.goto(_link(root, store, 1, "c1"))
            page.wait_for_function("() => document.getElementById('focused-cell') && "
                                   "document.getElementById('focused-cell').value === 'c1'", timeout=60000)
            del seen[:]
            box = page.locator("#focused-cell")
            box.click()
            box.fill("")
            box.type(text, delay=60)
            page.wait_for_selector(".name-picker-option", timeout=20000)
            page.wait_for_timeout(1500)
            offered = page.eval_on_selector_all(".name-picker-option .name-picker-name", "els => els.map(e => e.textContent)")
        finally:
            browser.close()
    return seen, offered


def test_no_dataset_wide_search_when_the_names_cannot_be_indexed(tiny_budget_server):
    root, store = tiny_budget_server
    seen, offered = _type_in_focus_box(root, store, "c")
    assert seen, "typing sent no name search at all"
    assert not [q for q in seen if q.get("scope") == "dataset"], seen
    part = {f"c{r}" for r in _part_rows(root, store, 1)}
    assert offered and set(offered) <= part, (offered, part)       # the cells shown are still searched


def test_control_dataset_wide_search_is_sent_with_the_default_budget(default_server):
    root, store = default_server
    seen, offered = _type_in_focus_box(root, store, "c")
    assert [q for q in seen if q.get("scope") == "dataset"], seen
    assert offered
