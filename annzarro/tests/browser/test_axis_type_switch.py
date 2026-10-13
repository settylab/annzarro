"""An axis switched between text and numbers is drawn as what the new field is.

Reported: with a categorical or string column on an axis, switching that axis to
a numeric column drew the numbers as categories (and the reverse); only a page
refresh drew them right. The Plotly axis kept the type it had been given for the
first field.

The store has categorical (cell_type), string (label) and numeric (total_counts,
score) obs columns, a categorical (cell_type) and a numeric colour to switch
between, and string (ensembl_id) and numeric (mean) var columns for the Gene Plot.
Every switch is made through the plot's own selectors, as a user makes it.

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
N_OBS, N_GENES = 200, 20
CELL, GENE = "cell-plot-A", "gene-plot-A"

OBS = lambda key: {"type": "obs", "key": key, "column": ""}   # noqa: E731
VAR = lambda key: {"type": "var", "key": key, "column": ""}   # noqa: E731
UMAP = lambda column: {"type": "obsm", "key": "X_umap", "column": column}   # noqa: E731

CATEGORICAL, STRING, NUMERIC = "cell_type", "label", "total_counts"


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _store(path):
    shutil.copytree(os.path.join(DATA_DIR, "fixture_small.zarr"), path)
    g = zarr.open_group(str(path), mode="r+")
    obs, var = g["obs"], g["var"]
    label = obs.create_array("label", shape=(N_OBS,), dtype=var["gene_name"].dtype)
    label[:] = np.array([f"L{i % 7}" for i in range(N_OBS)], dtype=object)
    label.attrs.update({"encoding-type": "string-array", "encoding-version": "0.2.0"})
    score = obs.create_array("score", shape=(N_OBS,), dtype="float64")
    score[:] = np.linspace(-3, 3, N_OBS)
    score.attrs.update({"encoding-type": "array", "encoding-version": "0.2.0"})
    obs.attrs["column-order"] = list(obs.attrs["column-order"]) + ["label", "score"]
    ids = var.create_array("ensembl_id", shape=(N_GENES,), dtype=var["gene_name"].dtype)
    ids[:] = np.array([f"ENSG{i:011d}" for i in range(N_GENES)], dtype=object)
    ids.attrs.update({"encoding-type": "string-array", "encoding-version": "0.2.0"})
    mean = var.create_array("mean", shape=(N_GENES,), dtype="float64")
    mean[:] = np.linspace(0, 3, N_GENES)
    mean.attrs.update({"encoding-type": "array", "encoding-version": "0.2.0"})
    var.attrs["column-order"] = ["gene_name", "ensembl_id", "mean"]
    zarr.consolidate_metadata(str(path))


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    data = tmp_path_factory.mktemp("data")
    _store(data / "axes.zarr")
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
    yield root, str(data / "axes.zarr")
    proc.terminate()
    proc.wait(10)


def _link(root, store, tile, **fields):
    cfg = {"id": tile, "title": "t", "z": None, "pointSize": 8, "pointOpacity": 1,
           "color": {"type": "none"}}
    cfg.update(fields)
    view = {"v": 1, "constants": {}, "layout": {"v": 1, "hierarchy": [
        {"type": "tile", "id": tile, "controlsVisible": True}],
        "controlState": {tile: True}, "panelConfigs": {tile: cfg}}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}"


def _state_js(tile):
    return """() => {
  const gd = document.querySelector('.tile[data-tile-id="%s"] .js-plotly-plot');
  const busy = [...document.querySelectorAll('.loading-overlay, .spinner-border')].filter(e => e.offsetParent !== null).length;
  if (!gd || !gd.data || !gd.data.length || !gd._fullLayout) return {busy: busy || 1};
  const t = gd.data.find(t => t.hoverinfo !== 'skip' && Array.isArray(t.x) && t.x.length) || gd.data[0];
  const three = t.type === 'scatter3d';
  const fl = three ? gd._fullLayout.scene : gd._fullLayout;
  const ax = {};
  for (const a of ['x', 'y', 'z']) {
    const full = fl[a + 'axis'];
    ax[a] = {type: full ? full.type : null, first: Array.isArray(t[a]) || ArrayBuffer.isView(t[a]) ? typeof t[a][0] : null};
  }
  const named = gd.data.filter(t => t.name && t.hoverinfo !== 'skip').length;
  const colours = gd.data.filter(t => t.marker && (Array.isArray(t.marker.color) || ArrayBuffer.isView(t.marker.color)));
  return {busy, three, ax, traces: gd.data.length, named,
          numericColour: colours.some(t => typeof t.marker.color[0] === 'number' && t.marker.showscale !== false && !!t.marker.colorscale)};
}""" % tile


def _settle(page, tile, timeout=60):
    end = time.time() + timeout
    s = None
    while time.time() < end:
        s = page.evaluate(_state_js(tile))
        if not s["busy"] and s.get("ax"):
            page.wait_for_timeout(1500)       # a switch redraws after its data arrives
            s = page.evaluate(_state_js(tile))
            if not s["busy"]:
                return s
        page.wait_for_timeout(200)
    pytest.fail(f"plot never settled; last state {s}")


def _open(pw, root, store, tile, **fields):
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": 1400, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(_link(root, store, tile, **fields))
    page.wait_for_selector(f'.tile[data-tile-id="{tile}"] .js-plotly-plot', timeout=60_000)
    return browser, page, errors


def _pick(page, tile, axis, field):
    """Choose a field in the axis's type, key and column selects, as a user does."""
    base = f'.tile[data-tile-id="{tile}"] '
    page.select_option(base + f'.axis-type-select[data-axis="{axis}"]', field["type"])
    key = base + f'.axis-key-select[data-axis="{axis}"]'
    page.wait_for_function("([sel, v]) => [...document.querySelector(sel).options].some(o => o.value === v)",
                           arg=[key, field["key"]], timeout=15000)
    page.select_option(key, field["key"])
    if field["column"]:
        col = base + f'.axis-column-select[data-axis="{axis}"]'
        page.wait_for_function("([sel, v]) => [...document.querySelector(sel).options].some(o => o.value === v)",
                               arg=[col, field["column"]], timeout=15000)
        page.select_option(col, field["column"])
    page.wait_for_timeout(300)


TEXT_KINDS = ("category", "string")
SWITCHES = [
    pytest.param(CATEGORICAL, NUMERIC, id="categorical-to-numeric"),
    pytest.param(STRING, NUMERIC, id="string-to-numeric"),
    pytest.param(NUMERIC, CATEGORICAL, id="numeric-to-categorical"),
    pytest.param(NUMERIC, STRING, id="numeric-to-string"),
]


def _is_text(key):
    return key in (CATEGORICAL, STRING)


def _expect(s, axis, key, where):
    got = s["ax"][axis]
    if _is_text(key):
        assert got["type"] == "category", (where, "axis type", got)
        assert got["first"] == "string", (where, "values", got)
    else:
        assert got["type"] == "linear", (where, "axis type", got)
        assert got["first"] == "number", (where, "values", got)


@pytest.mark.parametrize("axis", ["x", "y"])
@pytest.mark.parametrize("before,after", SWITCHES)
def test_cell_plot_2d_axis_follows_the_field(server, axis, before, after):
    root, store = server
    fields = {"x": UMAP("0"), "y": UMAP("1")}
    fields[axis] = OBS(before)
    with playwright.sync_playwright() as pw:
        browser, page, errors = _open(pw, root, store, CELL, **fields)
        try:
            s = _settle(page, CELL)
            _expect(s, axis, before, "before the switch")
            _pick(page, CELL, axis, OBS(after))
            s = _settle(page, CELL)
            _expect(s, axis, after, "after the switch")
            other = "y" if axis == "x" else "x"
            assert s["ax"][other]["type"] == "linear"
            assert not errors, errors
        finally:
            browser.close()


@pytest.mark.parametrize("axis", ["x", "y", "z"])
@pytest.mark.parametrize("before,after", SWITCHES)
def test_cell_plot_3d_axis_follows_the_field(server, axis, before, after):
    root, store = server
    fields = {"x": UMAP("0"), "y": UMAP("1"), "z": OBS("score")}
    fields[axis] = OBS(before)
    with playwright.sync_playwright() as pw:
        browser, page, errors = _open(pw, root, store, CELL, **fields)
        try:
            s = _settle(page, CELL)
            assert s["three"]
            _expect(s, axis, before, "before the switch")
            _pick(page, CELL, axis, OBS(after))
            s = _settle(page, CELL)
            _expect(s, axis, after, "after the switch")
            assert not errors, errors
        finally:
            browser.close()


def test_a_text_axis_can_go_back_and_forth(server):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser, page, errors = _open(pw, root, store, CELL, x=OBS(CATEGORICAL), y=UMAP("1"))
        try:
            for key in (NUMERIC, STRING, NUMERIC, CATEGORICAL, "score"):
                _pick(page, CELL, "x", OBS(key))
                _expect(_settle(page, CELL), "x", key, f"switched to {key}")
            assert not errors, errors
        finally:
            browser.close()


@pytest.mark.parametrize("before,after", [("cell_type", "total_counts"), ("total_counts", "cell_type")],
                         ids=["categorical-to-numeric", "numeric-to-categorical"])
def test_cell_plot_colour_follows_the_field(server, before, after):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser, page, errors = _open(pw, root, store, CELL, x=UMAP("0"), y=UMAP("1"), color=OBS(before))
        try:
            s = _settle(page, CELL)
            _pick(page, CELL, "color", OBS(after))
            s = _settle(page, CELL)
            if after == "total_counts":
                assert s["numericColour"] and s["named"] <= 1, s
            else:
                assert s["named"] > 1 and not s["numericColour"], s
            assert not errors, errors
        finally:
            browser.close()


GENE_SWITCHES = [pytest.param("ensembl_id", "mean", id="string-to-numeric"),
                 pytest.param("mean", "ensembl_id", id="numeric-to-string")]


@pytest.mark.parametrize("axis", ["x", "y"])
@pytest.mark.parametrize("before,after", GENE_SWITCHES)
def test_gene_plot_axis_follows_the_field(server, axis, before, after):
    root, store = server
    fields = {"x": VAR("mean"), "y": VAR("mean")}
    fields[axis] = VAR(before)
    with playwright.sync_playwright() as pw:
        browser, page, errors = _open(pw, root, store, GENE, **fields)
        try:
            kind = lambda key: CATEGORICAL if key == "ensembl_id" else NUMERIC   # noqa: E731
            s = _settle(page, GENE)
            _expect(s, axis, kind(before), "before the switch")
            _pick(page, GENE, axis, VAR(after))
            s = _settle(page, GENE)
            _expect(s, axis, kind(after), "after the switch")
            assert not errors, errors
        finally:
            browser.close()


def test_a_zoom_is_not_kept_on_another_field(server):
    """Zoomed on one numeric field, switching to another shows the other's values,
    not the old range; the same field redrawn keeps the zoom."""
    root, store = server
    gd = f'document.querySelector(\'.tile[data-tile-id="{CELL}"] .js-plotly-plot\')'
    with playwright.sync_playwright() as pw:
        browser, page, errors = _open(pw, root, store, CELL, x=OBS(NUMERIC), y=UMAP("1"))
        try:
            _settle(page, CELL)
            page.evaluate(f"Plotly.relayout({gd}, {{'xaxis.range': [1, 2]}})")
            page.wait_for_timeout(800)
            _pick(page, CELL, "x", OBS("score"))       # -3 .. 3
            _settle(page, CELL)
            lo, hi = page.evaluate(f"{gd}._fullLayout.xaxis.range")
            assert lo <= -2.9 and hi >= 2.9, (lo, hi)
            assert not errors, errors
        finally:
            browser.close()


# --- large-plot mode (above ui.defaults.large_plot_points) -----------------------------
# Its axis pickers offer obs columns, categorical ones too: those are drawn as their codes,
# numbers on a linear axis, never as text (large-plot.js loadSeries). So the type cannot stick,
# but the range kept for the old field can.

@pytest.fixture(scope="module")
def large_server(tmp_path_factory):
    data = tmp_path_factory.mktemp("data")
    _store(data / "axes.zarr")
    home = tmp_path_factory.mktemp("home")
    cfg = home / "large.yaml"
    cfg.write_text("ui:\n  defaults:\n    large_plot_points: 100\n")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--config", str(cfg),
                             "--host", "127.0.0.1", "--port", str(port), "--data-dir", str(data),
                             "--no-browser", "--auth-disabled"],
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
    yield root, str(data / "axes.zarr")
    proc.terminate()
    proc.wait(10)


LARGE_RANGE = """() => {
  const gd = document.querySelector('.tile[data-tile-id="%s"] .js-plotly-plot');
  const large = !!document.querySelector('.tile[data-tile-id="%s"] .plot-status .ps-tag[data-tag="large"]');
  return {large, type: gd._fullLayout.xaxis.type, range: gd._fullLayout.xaxis.range};
}""" % (CELL, CELL)


@pytest.mark.parametrize("zoom", [False, True], ids=["fitted", "zoomed"])
def test_large_plot_axis_shows_the_new_field_in_full(large_server, zoom):
    root, store = large_server
    with playwright.sync_playwright() as pw:
        browser, page, errors = _open(pw, root, store, CELL, x=OBS(NUMERIC), y=UMAP("1"))
        try:
            _settle(page, CELL)
            assert page.evaluate(LARGE_RANGE)["large"], "the panel is in large-plot mode"
            if zoom:
                page.evaluate("Plotly.relayout(document.querySelector('.tile[data-tile-id=\"%s\"] .js-plotly-plot'), "
                              "{'xaxis.range': [0.4, 0.6]})" % CELL)
                page.wait_for_timeout(800)
            _pick(page, CELL, "x", OBS("score"))
            _settle(page, CELL)
            s = page.evaluate(LARGE_RANGE)
            assert s["large"] and s["type"] == "linear", s
            lo, hi = s["range"]
            assert lo <= -2.9 and hi >= 2.9, ("the axis does not cover the new field (score, -3 to 3)", s)
            assert not errors, errors
        finally:
            browser.close()


def test_large_plot_says_why_a_categorical_axis_cannot_be_drawn_and_recovers(large_server):
    """The picker offers categorical obs columns; their codes are not an axis. The panel used to
    fail with 'Cannot read properties of undefined'."""
    root, store = large_server
    tile = f'.tile[data-tile-id="{CELL}"]'
    with playwright.sync_playwright() as pw:
        browser, page, errors = _open(pw, root, store, CELL, x=OBS(NUMERIC), y=UMAP("1"))
        try:
            _settle(page, CELL)
            _pick(page, CELL, "x", OBS(CATEGORICAL))
            page.wait_for_function("(t) => document.querySelector(t).innerText.includes('categorical column')",
                                   arg=tile, timeout=30000)
            text = page.evaluate(f"document.querySelector('{tile}').innerText")
            assert "Cannot read properties" not in text and "turn on a subset" in text, text
            _pick(page, CELL, "x", OBS("score"))
            s = _settle(page, CELL)
            assert s["ax"]["x"]["type"] == "linear", s
            lo, hi = page.evaluate(LARGE_RANGE)["range"]
            assert lo <= -2.9 and hi >= 2.9, (lo, hi)
        finally:
            browser.close()
