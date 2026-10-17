"""The subset size the user chose, carried across dataset switches, in a real (headless) browser.

Three synthetic stores: a small one (3,000 cells) and two large ones (30,000 cells each). The size
chosen is 10,000. The user chooses it by hand on a large store; the small one then shows every cell
and its badge says the size is still in effect; the other large one opens on 10,000 cells; the back
button returns to the rule (not to the part the dataset was left on); a reload keeps the size; a
share link applies its own subset and leaves the size unchanged.

Needs Playwright with Chromium; skipped without it, or failed when ANNZARRO_REQUIRE_BROWSER=1.
"""
import base64
import json
import os
import re

import numpy as np
import pytest

from annzarro.tests.server.test_focus_rows import _array, _dataframe
from annzarro.tests.ui_helpers import open_dataset, wait_for_open
from annzarro.tests.zarr_compat import open_group

from .dsb_servers import SHOTS, Session, _require, start

SIZE = 10_000
SMALL, LARGE = 3_000, 30_000
KEY = "annzarro.subsetSize:"


def _store(path, n_obs, n_var=3):
    rng = np.random.default_rng(n_obs)
    root = open_group(str(path))
    root.attrs.update({"encoding-type": "anndata", "encoding-version": "0.1.0"})
    _array(root, "X", rng.random((n_obs, n_var), dtype=np.float32))
    _array(root.create_group("obsm"), "X_umap", rng.random((n_obs, 2), dtype=np.float32))
    _dataframe(root, "obs", [f"c{i}" for i in range(n_obs)], {"score": np.arange(n_obs, dtype=np.float64)})
    _dataframe(root, "var", [f"g{i}" for i in range(n_var)], {"mean": np.zeros(n_var)})


@pytest.fixture(scope="module")
def stores(tmp_path_factory):
    _require()
    tmp = tmp_path_factory.mktemp("carry")
    data = tmp / "data"
    data.mkdir()
    for name, n in (("small.zarr", SMALL), ("large_a.zarr", LARGE), ("large_b.zarr", LARGE)):
        _store(data / name, n)
    base, proc = start(tmp, data)
    yield base, str(data)
    proc.terminate()
    proc.wait(20)


def _count(page):
    return page.inner_text("#cell-count").strip()


def _badge(page):
    return page.get_attribute("#subset-button", "aria-label")


def _wait_count(page, text, timeout=60_000):
    page.wait_for_function("(t) => document.getElementById('cell-count').textContent.trim() === t",
                           arg=text, timeout=timeout)


def _kept(page):
    return page.evaluate(f"""() => {{ const k = Object.keys(localStorage).filter(k => k.startsWith('{KEY}'));
        return k.length === 1 ? JSON.parse(localStorage.getItem(k[0])).size : (k.length ? 'several' : null); }}""")


def _choose_size(page, n):
    """The dialog, as the user uses it: turn the subset on, type the size, Apply."""
    page.click("#subset-button")
    page.wait_for_selector("#subset-modal.show, .modal.show #subset-apply", timeout=10_000)
    if not page.is_checked("#subset-enabled"):
        page.check("#subset-enabled")
    if page.is_checked("#subset-n-all"):
        page.uncheck("#subset-n-all")
    page.fill("#subset-n", str(n))
    page.wait_for_function("() => !document.getElementById('subset-apply').disabled")
    page.click("#subset-apply")


def _shot(page, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        page.screenshot(path=os.path.join(SHOTS, name), clip={"x": 0, "y": 0, "width": 1280, "height": 110})


def test_the_size_chosen_follows_the_user_across_datasets(stores):
    base, data = stores
    small, large_a, large_b = (os.path.join(data, n) for n in ("small.zarr", "large_a.zarr", "large_b.zarr"))
    s = Session(base, width=1280, height=800)
    page = s.page
    try:
        # never chosen: the server's default (30,000 cells is under its threshold: every cell)
        open_dataset(page, large_a)
        _wait_count(page, "30,000")
        assert _badge(page) == "All cells"
        assert _kept(page) is None

        # chosen by hand on a large store: 10,000 of 30,000, and kept
        _choose_size(page, SIZE)
        _wait_count(page, "10,000 of 30,000")
        assert _kept(page) == SIZE

        # a smaller store: every cell, and the badge says the size still holds for larger ones
        open_dataset(page, small)
        _wait_count(page, "3,000")
        assert _badge(page) == "All cells (≤ 10,000)"
        title = page.get_attribute("#subset-button", "title")
        assert "subset of 10,000 cells" in title, title
        assert _kept(page) == SIZE, "a small dataset does not change the size"
        _shot(page, "carry-small-light.png")

        # another large store: subsampled to the size again
        open_dataset(page, large_b)
        _wait_count(page, "10,000 of 30,000")
        # a part step is not a choice of size
        page.click("#subset-part-next")
        page.wait_for_function("document.querySelector('#subset-part-input').value === '2'", timeout=60_000)
        _wait_count(page, "10,000 of 30,000")
        assert _kept(page) == SIZE

        # back (to the small store) and on to large_b again by the back button: the rule, not part 2
        page.click("#dataset-back")
        wait_for_open(page, small)
        _wait_count(page, "3,000")
        page.click("#dataset-back")
        wait_for_open(page, large_b)
        _wait_count(page, "10,000 of 30,000")
        assert page.input_value("#subset-part-input") == "1", "the back button opens on the size, at part 1"

        # a reload keeps the size: the next switch to a large store is subsampled to it
        page.reload()
        page.wait_for_function("() => !!(window.annzarro && window.annzarro.openDataset)", timeout=60_000)
        assert _kept(page) == SIZE
        open_dataset(page, small)
        _wait_count(page, "3,000")
        page.wait_for_function("() => document.getElementById('subset-button').getAttribute('aria-label') === 'All cells (≤ 10,000)'",
                               timeout=10_000)
        open_dataset(page, large_a)
        _wait_count(page, "10,000 of 30,000")

        # a share link applies its own subset exactly, and leaves the size alone
        view = {"v": 1, "subset": {"n": 5000, "seed": 2}}
        enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
        page.goto(f"{base}/?dataset_path={large_b}#view={enc}")
        wait_for_open(page, large_b)
        _wait_count(page, "5,000 of 30,000")
        assert "seed 2" in _badge(page)
        assert _kept(page) == SIZE, "a link does not change the size"
        # and the next switch is on the size again
        open_dataset(page, large_a)
        _wait_count(page, "10,000 of 30,000")

        # every cell, chosen on a large store: the new intent, carried the same way
        page.click("#subset-button")
        page.wait_for_selector(".modal.show #subset-apply", timeout=10_000)
        page.uncheck("#subset-enabled")
        page.wait_for_function("() => !document.getElementById('subset-apply').disabled")
        page.click("#subset-apply")
        _wait_count(page, "30,000")
        assert _kept(page) == "all"
        open_dataset(page, large_b)
        _wait_count(page, "30,000")
        assert _badge(page) == "All cells"
        assert not s.errors, s.errors
    finally:
        s.close()


def test_the_badge_with_the_size_in_effect_light_and_dark(stores):
    """The screenshots of the dataset bar on the small store with the size in effect (DATASET_SHOTS)."""
    base, data = stores
    for scheme in ("light", "dark"):
        s = Session(base, width=1280, height=800, scheme=scheme,
                    init_script=f"localStorage.setItem('{KEY}' + location.origin + '|local', JSON.stringify({{size: {SIZE}}}))")
        page = s.page
        try:
            open_dataset(page, os.path.join(data, "small.zarr"))
            _wait_count(page, "3,000")
            assert _badge(page) == "All cells (≤ 10,000)"
            # the badge is not cut: the whole note is visible
            fits = page.eval_on_selector("#subset-button", "e => e.scrollWidth <= e.clientWidth + 1")
            assert fits
            _shot(page, f"carry-small-{scheme}.png")
            assert not s.errors, s.errors
        finally:
            s.close()


# The read of a plot's coordinates fails as a browser out of memory does: the arrayBuffer of an obsm
# reply rejects with V8's RangeError while window.__oom is set
OOM = """window.__oom = true;
const read = Response.prototype.arrayBuffer;
Response.prototype.arrayBuffer = function () {
    if (window.__oom && /\\/data\\/obsm/.test(this.url)) return Promise.reject(new RangeError('Array buffer allocation failed'));
    return read.call(this);
};"""


def test_a_read_out_of_memory_says_so_and_offers_fewer_cells(stores):
    base, data = stores
    large = os.path.join(data, "large_a.zarr")
    x = {"type": "obsm", "key": "X_umap", "column": "0"}
    y = {"type": "obsm", "key": "X_umap", "column": "1"}
    plot = {"id": "cell-plot-M", "title": "umap", "x": x, "y": y, "z": None,
            "color": {"type": "obs", "key": "score", "column": ""}}
    layout = {"v": 1, "hierarchy": [{"type": "tile", "id": "cell-plot-M"}],
              "controlState": {"cell-plot-M": False}, "panelConfigs": {"cell-plot-M": plot}}
    enc = base64.urlsafe_b64encode(json.dumps({"v": 1, "layout": layout}).encode()).decode().rstrip("=")
    s = Session(base, width=1280, height=800, init_script=OOM)
    page = s.page
    try:
        page.goto(f"{base}/?dataset_path={large}#view={enc}")
        wait_for_open(page, large)
        tile = '.tile[data-tile-id="cell-plot-M"]'
        place = page.wait_for_selector(f"{tile} .coverage-placeholder", timeout=60_000)
        text = place.inner_text()
        assert re.search(r"obsm\.X_umap\.\d: the browser ran out of memory \(30,000 cells\) -- "
                         r"Close a plot, or show fewer cells \(a smaller subset\), and try again\.", text), text
        assert "allocation" not in text, "the engine's words are not shown"
        assert page.locator(f"{tile} .coverage-placeholder__hints").count() == 0, "no hints about a missing embedding"
        assert page.locator(f"{tile} .coverage-placeholder [data-ps-action='subset']").count() == 1
        half = page.locator(f"{tile} .coverage-placeholder [data-ps-action='subset-half']")
        assert half.inner_text() == "Half the cells"
        if SHOTS:
            page.locator(tile).screenshot(path=os.path.join(SHOTS, "oom-placeholder.png"))

        # memory again: half the cells, a choice of size like any other
        page.evaluate("() => { window.__oom = false; }")
        half.click()
        _wait_count(page, "15,000 of 30,000")
        page.wait_for_function(f"""() => {{ const g = document.querySelector('{tile} .js-plotly-plot');
            return !!(g && g._fullData && g._fullData.length); }}""", timeout=60_000)
        assert page.locator(f"{tile} .coverage-placeholder").count() == 0
        assert _kept(page) == LARGE // 2, "half the cells is the size kept"
        assert not s.errors, s.errors
    finally:
        s.close()
