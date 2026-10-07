"""Columns with many categories, in a real browser (static/js/utils/categories.js).

The committed 200-cell fixture plus two categorical obs columns: `barcode`,
one category per cell, and `clone`, 120 categories (clone000-079 two cells
each, clone080-119 one).

- Colouring by either draws every point in 64 colour groups, by the
  column's ranking over all its cells, with one legend entry per colour
  naming its largest categories, and a hover naming each point's category.
  The colour requests ask for the labels of the points and the column's
  ranks, never every category.
- `barcode` also works as a hover column and as a table column.

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
import zarr

from annzarro.tests.zarr_compat import open_group, write_array, write_strings

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
N = 200
CLONES = 120


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _categorical(obs, name, codes, categories):
    g = obs.create_group(name)
    g.attrs.update({"encoding-type": "categorical", "encoding-version": "0.2.0", "ordered": False})
    write_array(g, "codes", np.asarray(codes, dtype=np.int16))
    write_strings(g, "categories", categories)


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    home = tmp_path_factory.mktemp("home")
    data = tmp_path_factory.mktemp("data")
    store = str(data / "fixture_many.zarr")
    shutil.copytree(os.path.join(DATA_DIR, "fixture_small.zarr"), store)
    obs = open_group(os.path.join(store, "obs"), mode="a")
    _categorical(obs, "barcode", np.arange(N)[::-1], [f"BC{i:04d}-1" for i in range(N)])
    _categorical(obs, "clone", np.arange(N) % CLONES, [f"clone{i:03d}" for i in range(CLONES)])
    zarr.consolidate_metadata(store)
    (home / "c.yaml").write_text("ui: {}\n")
    exe = shutil.which("annzarro", path=os.path.dirname(sys.executable)) or shutil.which("annzarro")
    if not exe:
        (pytest.fail if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1" else pytest.skip)(
            "annzarro console script not found")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1")
    proc = subprocess.Popen([exe, "start", "--config", str(home / "c.yaml"), "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", str(data), "--no-browser", "--auth-disabled"],
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
    yield root, store
    proc.terminate()
    proc.wait(10)


def _link(root, store, colour=None, hover=None, table_columns=None):
    configs, tiles = {}, []
    if colour is not None or hover is not None:
        cfg = {"id": "cell-plot-M", "title": "umap", "z": None,
               "x": {"type": "obsm", "key": "X_umap", "column": "0"},
               "y": {"type": "obsm", "key": "X_umap", "column": "1"},
               "color": {"type": "obs", "key": colour, "column": ""} if colour
               else {"type": "none", "key": "", "column": ""}}
        if hover:
            cfg["hoverInfo"] = [{"type": "obs", "key": "_index"}, {"type": "obs", "key": hover}]
        configs["cell-plot-M"] = cfg
        tiles.append({"type": "tile", "id": "cell-plot-M", "controlsVisible": True})
    if table_columns:
        configs["cell-table-T"] = {"id": "cell-table-T", "title": "cells",
                                   "columns": [{"type": "obs", "key": c, "column": ""} for c in table_columns]}
        tiles.append({"type": "tile", "id": "cell-table-T", "controlsVisible": True})
    view = {"v": 1, "layout": {"v": 1, "hierarchy": tiles,
                               "controlState": {t["id"]: True for t in tiles}, "panelConfigs": configs}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={store}#view={enc}"


PLOT = """() => {
  const g = document.querySelector('.tile[data-tile-id="cell-plot-M"] .js-plotly-plot');
  const s = document.querySelector('.tile[data-tile-id="cell-plot-M"] .plot-status');
  if (!g || !g.data || !g.data.some(t => t.x && t.x.length && t.x[0] !== null)) return null;
  // the point traces: not the legend entries, nor the focused cell's ring
  const points = g.data.filter(t => t.meta !== 'az-legend' && !String(t.name || '').includes('Focused'));
  return {
    drawn: points.reduce((n, t) => n + (t.x ? t.x.filter(v => v !== null).length : 0), 0),
    traces: points.length,
    legend: g.data.filter(t => t.meta === 'az-legend' && t.name !== 'NA')
        .sort((a, b) => (a.legendrank ?? 0) - (b.legendrank ?? 0)).map(t => t.name),
    labelled: points.filter(t => Array.isArray(t._azLabels))
        .map(t => [t.customdata[0], t._azLabels[0], String((t.hovertext || [])[0])]),
    hovertext: points.map(t => t.hovertext ? String(t.hovertext[0]) : null),
    headline: s ? s.querySelector('.ps-headline').innerText.trim() : null,
    chips: s ? [...s.querySelectorAll('.ps-chip')].map(e => e.textContent.trim()) : [],
    notes: s ? [...s.querySelectorAll('.ps-notes li')].map(e => e.textContent.trim()) : [],
    busy: [...document.querySelectorAll('.loading-overlay, .spinner-border')].filter(e => e.offsetParent !== null).length
  };
}"""


def _plot(page, pred, timeout=60):
    t0 = time.time()
    s = None
    while time.time() - t0 < timeout:
        s = page.evaluate(PLOT)
        if s and not s["busy"] and pred(s):
            return s
        time.sleep(0.2)
    pytest.fail(f"timed out; last state {s}")


def _open(pw, link):
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": 1500, "height": 1000})
    requests = []
    page.on("request", lambda r: requests.append(r.url) if "/api/v1/data/obs" in r.url else None)
    page.goto(link)
    return browser, page, requests


@pytest.mark.parametrize("column,first", [("clone", "clone000, clone064"),
                                            ("barcode", "BC0000-1, BC0064-1, BC0128-1 +1 more")])
def test_many_categories_are_drawn_in_64_colour_groups(server, column, first):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser, page, requests = _open(pw, _link(root, store, colour=column))
        try:
            s = _plot(page, lambda s: s["legend"])
            assert s["drawn"] == N
            assert s["traces"] <= 64 and len(s["legend"]) == 64, s["legend"][:5]
            assert s["legend"][0] == first
            assert not any("categor" in c for c in s["chips"])
            for cell, label, hover in s["labelled"]:
                assert hover.startswith(f"<br>{label}")
            # the points' labels (for the hover) and the column's ranks, never all categories
            kinds = {u.split("categories=")[1].split("&")[0] for u in requests if f"columns={column}" in u}
            assert kinds == {"used", "ranked"}, requests
        finally:
            browser.close()


def test_a_one_per_cell_column_in_the_hover_and_a_table(server):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser, page, _ = _open(pw, _link(root, store, hover="barcode", table_columns=["barcode"]))
        try:
            s = _plot(page, lambda s: any(h and "barcode:" in h for h in s["hovertext"]))
            assert any(h and "barcode: BC" in h for h in s["hovertext"])
            page.wait_for_function(
                "() => [...document.querySelectorAll('.tile[data-tile-id=\"cell-table-T\"] table tbody td')]"
                ".some(td => /^BC\\d{4}-1$/.test(td.textContent.trim()))", timeout=60000)
        finally:
            browser.close()
