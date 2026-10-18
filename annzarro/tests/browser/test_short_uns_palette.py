"""A categorical colour whose uns.<key>_colors is shorter than its categories.

The fixture's `leiden` has five categories; its copy here stores two colours.
They used to be repeated, so categories shared a colour. Now the stored list
is set aside, as scanpy does, the default palette is generated, and the
panel's status strip carries a tag that says so. Checked in the regular plot
and in large-plot mode (large_plot_points lowered below the 200 cells).
A list with a colour for every category is used as stored.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import base64
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

import numpy as np
import pytest

from annzarro.tests.zarr_compat import open_group, write_strings
import zarr

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
SHORT = ["#111111", "#222222"]
FIT = ["#aa0000", "#00aa00", "#0000aa", "#aaaa00", "#00aaaa"]


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _colours(store, key, values):
    from annzarro.tests.zarr_compat import write_array  # noqa: F401  (same compat layer)
    uns = open_group(os.path.join(store, "uns"), mode="a")
    write_strings(uns, key, values)
    uns[key].attrs.update({"encoding-type": "string-array", "encoding-version": "0.2.0"})


@pytest.fixture(scope="module", params=["regular", "large"])
def server(request, tmp_path_factory):
    home = tmp_path_factory.mktemp("home")
    data = tmp_path_factory.mktemp("data")
    store = str(data / "short_uns.zarr")
    shutil.copytree(os.path.join(DATA_DIR, "fixture_small.zarr"), store)
    _colours(store, "leiden_colors", SHORT)
    _colours(store, "cell_type_colors", FIT[:3])
    zarr.consolidate_metadata(store)
    cfg = home / "c.yaml"
    cfg.write_text("ui:\n  defaults:\n    large_plot_points: 100\n" if request.param == "large" else "ui: {}\n")
    exe = shutil.which("annzarro", path=os.path.dirname(sys.executable)) or shutil.which("annzarro")
    if not exe:
        (pytest.fail if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1" else pytest.skip)(
            "annzarro console script not found")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1")
    proc = subprocess.Popen([exe, "start", "--config", str(cfg), "--host", "127.0.0.1", "--port", str(port),
                             "--data-dir", str(data), "--no-browser", "--auth-disabled"],
                            env=env, cwd=home, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for _ in range(120):
        try:
            urllib.request.urlopen(root + "/api/v1/config", timeout=1)
            break
        except OSError:
            time.sleep(0.25)
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield root, store, request.param
    proc.terminate()
    proc.wait(10)


def _link(root, store, column):
    cfg = {"cell-plot-P": {"id": "cell-plot-P", "title": "t", "z": None,
                           "x": {"type": "obsm", "key": "X_umap", "column": "0"},
                           "y": {"type": "obsm", "key": "X_umap", "column": "1"},
                           "color": {"type": "obs", "key": column, "column": ""}}}
    view = {"v": 1, "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": "cell-plot-P", "controlsVisible": True}],
                               "controlState": {"cell-plot-P": True}, "panelConfigs": cfg}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={store}#view={enc}"


STATE = """() => {
  const tile = document.querySelector('.tile[data-tile-id="cell-plot-P"]');
  const g = tile && tile.querySelector('.js-plotly-plot');
  if (!g || !g.data) return null;
  const legend = g.data.filter(t => t.meta === 'az-legend' && t.name !== 'NA');
  const tag = tile.querySelector('.plot-status .ps-tag[data-tag="uns-palette"]');
  const busy = [...document.querySelectorAll('.loading-overlay, .spinner-border')].filter(e => e.offsetParent !== null).length;
  return {
    colours: legend.map(t => String(t.marker.color).toLowerCase()),
    large: !!tile.querySelector('.plot-status .ps-tag[data-tag="large"]'),
    tag: tag ? (tag.getAttribute('title') || '') : null,
    busy
  };
}"""


def _state(page, pred, timeout=60):
    t0 = time.time()
    s = None
    while time.time() - t0 < timeout:
        s = page.evaluate(STATE)
        if s and not s["busy"] and s["colours"] and pred(s):
            return s
        time.sleep(0.2)
    pytest.fail(f"timed out; last state {s}")


def _open(pw, link):
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": 1500, "height": 1000})
    page.goto(link)
    return browser, page


def test_a_short_palette_is_not_repeated(server):
    root, store, mode = server
    with playwright.sync_playwright() as pw:
        browser, page = _open(pw, _link(root, store, "leiden"))
        try:
            s = _state(page, lambda s: s["large"] == (mode == "large"))
            assert len(s["colours"]) == 5
            assert len(set(s["colours"])) == 5, s["colours"]
            assert not set(SHORT) & set(s["colours"])
            assert s["tag"] and "uns.leiden_colors (2)" in s["tag"] and "categories (5)" in s["tag"], s["tag"]
        finally:
            browser.close()


def test_a_palette_with_a_colour_per_category_is_used(server):
    root, store, mode = server
    with playwright.sync_playwright() as pw:
        browser, page = _open(pw, _link(root, store, "cell_type"))
        try:
            s = _state(page, lambda s: s["large"] == (mode == "large"))
            assert s["colours"] == FIT[:3]
            assert s["tag"] is None
        finally:
            browser.close()
