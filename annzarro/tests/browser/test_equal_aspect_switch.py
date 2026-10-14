"""Switching coordinates with Equal aspect on shows the cells of the new coordinates.

Reported: on a spatial dataset, with Equal aspect on, switching the Cell Plot
from the spatial coordinates (thousands) to the UMAP (single digits) left every
cell out of view.

The store has two embeddings of very different scales: X_umap (about -4 to 2.5)
and spatial (the same layout, scaled to the thousands). Every switch is made
through the plot's own selectors, as a user makes it.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import base64
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request

import numpy as np
import pytest
import zarr

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "..", "data")
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
CELL = "cell-plot-A"

EMB = lambda key, column: {"type": "obsm", "key": key, "column": column}   # noqa: E731


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _store(path):
    shutil.copytree(os.path.join(DATA_DIR, "fixture_small.zarr"), path)
    g = zarr.open_group(str(path), mode="r+")
    umap = g["obsm"]["X_umap"][:]
    spatial = g["obsm"].create_array("spatial", shape=umap.shape, dtype="float64")
    spatial[:] = umap * 500.0 + np.array([4000.0, 4500.0])
    spatial.attrs.update({"encoding-type": "array", "encoding-version": "0.2.0"})
    zarr.consolidate_metadata(str(path))
    return {"X_umap": umap, "spatial": spatial[:]}


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    data = tmp_path_factory.mktemp("data")
    coords = _store(data / "aspect.zarr")
    home = tmp_path_factory.mktemp("home")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", str(data), "--no-browser", "--auth-disabled"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
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
    yield root, str(data / "aspect.zarr"), coords
    proc.terminate()
    proc.wait(10)


def _link(root, store, **fields):
    cfg = {"id": CELL, "title": "t", "z": None, "pointSize": 8, "pointOpacity": 1,
           "color": {"type": "none"}, "equalAspect": True}
    cfg.update(fields)
    view = {"v": 1, "constants": {}, "layout": {"v": 1, "hierarchy": [
        {"type": "tile", "id": CELL, "controlsVisible": True}],
        "controlState": {CELL: True}, "panelConfigs": {CELL: cfg}}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}"


GD = f'document.querySelector(\'.tile[data-tile-id="{CELL}"] .js-plotly-plot\')'

STATE = """() => {
  const gd = %s;
  const busy = [...document.querySelectorAll('.loading-overlay, .spinner-border')].filter(e => e.offsetParent !== null).length;
  if (!gd || !gd.data || !gd.data.length || !gd._fullLayout || !gd._fullLayout.xaxis) return {busy: busy || 1};
  const fl = gd._fullLayout;
  const pts = gd.data.filter(t => t.hoverinfo !== 'skip' && t.x && t.x.length);
  const xs = pts.flatMap(t => Array.from(t.x)), ys = pts.flatMap(t => Array.from(t.y));
  const [x0, x1] = fl.xaxis.range, [y0, y1] = fl.yaxis.range;
  let shown = 0;
  for (let i = 0; i < xs.length; i++) if (xs[i] >= Math.min(x0, x1) && xs[i] <= Math.max(x0, x1) && ys[i] >= Math.min(y0, y1) && ys[i] <= Math.max(y0, y1)) shown++;
  return {busy, n: xs.length, shown, xrange: fl.xaxis.range, yrange: fl.yaxis.range,
          xdata: [Math.min(...xs), Math.max(...xs)], ydata: [Math.min(...ys), Math.max(...ys)],
          anchor: fl.yaxis.scaleanchor || null, title: [fl.xaxis.title.text, fl.yaxis.title.text]};
}""" % GD


def _settle(page, timeout=60):
    end = time.time() + timeout
    s = None
    while time.time() < end:
        s = page.evaluate(STATE)
        if not s["busy"] and s.get("n"):
            page.wait_for_timeout(1500)       # a switch redraws after its data arrives
            s = page.evaluate(STATE)
            if not s["busy"]:
                return s
        page.wait_for_timeout(200)
    pytest.fail(f"plot never settled; last state {s}")


def _open(pw, root, store, **fields):
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": 1400, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(_link(root, store, **fields))
    page.wait_for_selector(f'.tile[data-tile-id="{CELL}"] .js-plotly-plot', timeout=60_000)
    return browser, page, errors


def _pick(page, axis, field):
    """Choose a field in the axis's type, key and column selects, as a user does."""
    base = f'.tile[data-tile-id="{CELL}"] '
    page.select_option(base + f'.axis-type-select[data-axis="{axis}"]', field["type"])
    key = base + f'.axis-key-select[data-axis="{axis}"]'
    page.wait_for_function("([sel, v]) => [...document.querySelector(sel).options].some(o => o.value === v)",
                           arg=[key, field["key"]], timeout=15000)
    page.select_option(key, field["key"])
    col = base + f'.axis-column-select[data-axis="{axis}"]'
    page.wait_for_function("([sel, v]) => [...document.querySelector(sel).options].some(o => o.value === v)",
                           arg=[col, field["column"]], timeout=15000)
    page.select_option(col, field["column"])
    page.wait_for_timeout(300)


def _all_in_view(s, where):
    assert s["anchor"] == "x", (where, "equal aspect is kept", s)
    assert s["shown"] == s["n"], (where, "cells out of view", s)


SWITCHES = [
    pytest.param("spatial", "X_umap", id="spatial-to-umap"),
    pytest.param("X_umap", "spatial", id="umap-to-spatial"),
]


@pytest.mark.parametrize("zoom", [False, True], ids=["fitted", "zoomed"])
@pytest.mark.parametrize("before,after", SWITCHES)
def test_both_axes_switched_show_every_cell(server, before, after, zoom):
    root, store, _ = server
    with playwright.sync_playwright() as pw:
        browser, page, errors = _open(pw, root, store, x=EMB(before, "0"), y=EMB(before, "1"))
        try:
            s = _settle(page)
            _all_in_view(s, "before the switch")
            if zoom:
                (x0, x1), (y0, y1) = s["xdata"], s["ydata"]
                page.evaluate(f"Plotly.relayout({GD}, {{'xaxis.range': [{x0}, {(x0 + x1) / 2}], "
                              f"'yaxis.range': [{y0}, {(y0 + y1) / 2}]}})")
                page.wait_for_timeout(800)
            _pick(page, "x", EMB(after, "0"))
            _settle(page)
            _pick(page, "y", EMB(after, "1"))
            _all_in_view(_settle(page), "after the switch")
            assert not errors, errors
        finally:
            browser.close()


@pytest.mark.parametrize("zoom", [False, True], ids=["fitted", "zoomed"])
@pytest.mark.parametrize("axis", ["x", "y"])
def test_one_axis_switched_shows_every_cell(server, axis, zoom):
    root, store, _ = server
    with playwright.sync_playwright() as pw:
        browser, page, errors = _open(pw, root, store, x=EMB("spatial", "0"), y=EMB("spatial", "1"))
        try:
            s = _settle(page)
            if zoom:
                (x0, x1), (y0, y1) = s["xdata"], s["ydata"]
                page.evaluate(f"Plotly.relayout({GD}, {{'xaxis.range': [{x0}, {(x0 + x1) / 2}], "
                              f"'yaxis.range': [{y0}, {(y0 + y1) / 2}]}})")
                page.wait_for_timeout(800)
            _pick(page, axis, EMB("X_umap", "0" if axis == "x" else "1"))
            _all_in_view(_settle(page), f"after switching {axis}")
            assert not errors, errors
        finally:
            browser.close()


def test_component_switched_shows_every_cell(server):
    root, store, _ = server
    with playwright.sync_playwright() as pw:
        browser, page, errors = _open(pw, root, store, x=EMB("spatial", "0"), y=EMB("spatial", "1"))
        try:
            s = _settle(page)
            (x0, x1), (y0, y1) = s["xdata"], s["ydata"]
            page.evaluate(f"Plotly.relayout({GD}, {{'xaxis.range': [{x0}, {(x0 + x1) / 2}], "
                          f"'yaxis.range': [{y0}, {(y0 + y1) / 2}]}})")
            page.wait_for_timeout(800)
            _pick(page, "x", EMB("spatial", "1"))
            _all_in_view(_settle(page), "after switching the component")
            assert not errors, errors
        finally:
            browser.close()


def test_the_reported_link_shows_every_cell(server):
    """The reported view: UMAP on the axes, a zoom kept from the spatial coordinates
    saved without the fields it was made on (as views before 0.5.0 saved it)."""
    root, store, _ = server
    stale = {"xrange": [2832.44, 5944.76], "yrange": [3455.12, 5558.82]}
    with playwright.sync_playwright() as pw:
        browser, page, errors = _open(pw, root, store, x=EMB("X_umap", "0"), y=EMB("X_umap", "1"),
                                      viewport2D=stale)
        try:
            _all_in_view(_settle(page), "opened")
            assert not errors, errors
        finally:
            browser.close()


def test_a_zoom_on_the_same_fields_is_kept(server):
    root, store, _ = server
    with playwright.sync_playwright() as pw:
        browser, page, errors = _open(pw, root, store, x=EMB("spatial", "0"), y=EMB("spatial", "1"))
        try:
            s = _settle(page)
            (x0, x1), (y0, y1) = s["xdata"], s["ydata"]
            page.evaluate(f"Plotly.relayout({GD}, {{'xaxis.range': [{x0}, {(x0 + x1) / 2}], "
                          f"'yaxis.range': [{y0}, {(y0 + y1) / 2}]}})")
            page.wait_for_timeout(800)
            zoomed = page.evaluate(STATE)
            assert zoomed["shown"] < zoomed["n"], zoomed
            # a redraw on the same fields (a new colour) keeps it
            page.select_option(f'.tile[data-tile-id="{CELL}"] .axis-type-select[data-axis="color"]', "obs")
            s = _settle(page)
            assert s["shown"] == zoomed["shown"] and s["shown"] < s["n"], (zoomed, s)
            assert not errors, errors
        finally:
            browser.close()
