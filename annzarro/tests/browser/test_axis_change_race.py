"""Two axes changed in quick succession: the page stays responsive and draws both.

Reported: on a dataset of about a million cells, with a subset of 100,000 shown
in the Cell Plot (Equal aspect on, Highlight Focused Cell on, a categorical
colour with many categories), changing X and then Y while X was still loading
froze the page (Chrome's "Page Unresponsive").

The store has 1,063,971 cells, two embeddings (X_umap and X_umap_allcells, on
other scales) and a categorical colour with 60 categories. Every embedding reply
is held back for a while in the page, so the second change is made while the first
is loading. A heartbeat in the page measures the longest stretch the main thread
was busy.

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
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
N_CELLS, N_GENES, N_TYPES, SUBSET = 1_063_971, 5, 60, 100_000
CELL = "cell-plot-A"
CHUNK = 1 << 18
HOLD_MS = 2500          # how long each embedding reply is held back

EMB = lambda key, column: {"type": "obsm", "key": key, "column": column}   # noqa: E731
STRING = {"encoding-type": "string-array", "encoding-version": "0.2.0"}
ARRAY = {"encoding-type": "array", "encoding-version": "0.2.0"}


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _store(path):
    g = zarr.open_group(str(path), mode="w")
    g.attrs.update({"encoding-type": "anndata", "encoding-version": "0.1.0"})
    rng = np.random.default_rng(0)
    obs = g.create_group("obs")
    obs.attrs.update({"_index": "_index", "column-order": ["L3_cell_subtype"],
                      "encoding-type": "dataframe", "encoding-version": "0.2.0"})
    index = obs.create_array("_index", shape=(N_CELLS,), chunks=(CHUNK,), dtype=str)
    for lo in range(0, N_CELLS, CHUNK):
        hi = min(lo + CHUNK, N_CELLS)
        index[lo:hi] = np.array([f"c{i}" for i in range(lo, hi)], dtype=object)
    index.attrs.update(STRING)
    cat = obs.create_group("L3_cell_subtype")
    cat.attrs.update({"ordered": False, "encoding-type": "categorical", "encoding-version": "0.2.0"})
    cats = cat.create_array("categories", shape=(N_TYPES,), dtype=str)
    cats[:] = np.array([f"subtype_{i:02d}" for i in range(N_TYPES)], dtype=object)
    cats.attrs.update(STRING)
    codes = cat.create_array("codes", shape=(N_CELLS,), chunks=(CHUNK,), dtype="int8")
    codes[:] = rng.integers(0, N_TYPES, N_CELLS).astype("int8")
    codes.attrs.update(ARRAY)
    var = g.create_group("var")
    var.attrs.update({"_index": "_index", "column-order": [], "encoding-type": "dataframe",
                      "encoding-version": "0.2.0"})
    vi = var.create_array("_index", shape=(N_GENES,), dtype=str)
    vi[:] = np.array([f"g{i}" for i in range(N_GENES)], dtype=object)
    vi.attrs.update(STRING)
    x = g.create_group("X")
    x.attrs.update({"shape": [N_CELLS, N_GENES], "encoding-type": "csc_matrix", "encoding-version": "0.1.0"})
    x.create_array("data", shape=(0,), dtype="float64")
    x.create_array("indices", shape=(0,), dtype="int32")
    x.create_array("indptr", shape=(N_GENES + 1,), dtype="int32")[:] = 0
    obsm = g.create_group("obsm")
    obsm.attrs.update({"encoding-type": "dict", "encoding-version": "0.1.0"})
    umap = rng.normal(0, 4, (N_CELLS, 2)).astype("float32")
    for key, values in (("X_umap", umap), ("X_umap_allcells", umap * 3 + 20)):
        a = obsm.create_array(key, shape=values.shape, chunks=(CHUNK, 2), dtype="float32")
        a[:] = values
        a.attrs.update(ARRAY)
    for name in ("layers", "obsp", "uns", "varm", "varp"):
        g.create_group(name).attrs.update({"encoding-type": "dict", "encoding-version": "0.1.0"})
    zarr.consolidate_metadata(str(path))


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    data = tmp_path_factory.mktemp("data")
    _store(data / "million.zarr")
    home = tmp_path_factory.mktemp("home")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", str(data), "--no-browser", "--auth-disabled"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for _ in range(240):
        try:
            urllib.request.urlopen(root + "/api/v1/config", timeout=1)
            break
        except OSError:
            time.sleep(0.25)
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield root, str(data / "million.zarr")
    proc.terminate()
    proc.wait(10)


def _link(root, store, equal):
    cfg = {"id": CELL, "title": "t", "z": None, "x": EMB("X_umap", "0"), "y": EMB("X_umap", "1"),
           "color": {"type": "obs", "key": "L3_cell_subtype", "column": ""},
           "equalAspect": equal, "highlightFocusedCell": True}
    view = {"v": 1, "subset": {"n": SUBSET, "seed": 1, "part": 0},
            "constants": {"focusedCell": "c5"},
            "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": CELL, "controlsVisible": True}],
                       "controlState": {CELL: True}, "panelConfigs": {CELL: cfg}}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}"


# Embedding replies held back once armed, and a heartbeat: the longest gap
# between two ticks of a 50 ms timer is the longest the main thread was busy.
INIT = """
(() => {
  const realFetch = window.fetch.bind(window);
  window.__azHold = 0;
  window.fetch = async (...args) => {
    const url = String(args[0] && args[0].url || args[0]);
    const reply = await realFetch(...args);
    if (window.__azHold && url.includes('/data/obsm/')) await new Promise(r => setTimeout(r, window.__azHold));
    return reply;
  };
  window.__azGap = 0;
  let last = performance.now();
  setInterval(() => { const now = performance.now(); window.__azGap = Math.max(window.__azGap, now - last); last = now; }, 50);
})();
"""

# Counted from here on: the Plotly calls that draw, and the long tasks (over 50 ms).
WATCH = """() => {
  window.__azCalls = {}; window.__azLong = [];
  for (const fn of ['react', 'newPlot', 'relayout', 'restyle', 'update', 'addTraces', 'deleteTraces', 'redraw']) {
    const o = Plotly[fn];
    if (typeof o !== 'function') continue;
    Plotly[fn] = function(...args) { window.__azCalls[fn] = (window.__azCalls[fn] || 0) + 1; return o.apply(this, args); };
  }
  new PerformanceObserver(list => { for (const e of list.getEntries()) window.__azLong.push(e.duration); })
    .observe({entryTypes: ['longtask']});
  window.__azGap = 0;
}"""

GD = f'document.querySelector(\'.tile[data-tile-id="{CELL}"] .js-plotly-plot\')'

STATE = """() => {
  const gd = %s;
  const busy = [...document.querySelectorAll('.loading-overlay, .spinner-border')].filter(e => e.offsetParent !== null).length;
  if (!gd || !gd.data || !gd.data.length || !gd._fullLayout || !gd._fullLayout.xaxis) return {busy: busy || 1};
  const pts = gd.data.filter(t => t.hoverinfo !== 'skip' && t.x && t.x.length > 1);
  let n = 0, xlo = Infinity, xhi = -Infinity, ylo = Infinity, yhi = -Infinity;
  for (const t of pts) for (let i = 0; i < t.x.length; i++) {
    n++; const x = t.x[i], y = t.y[i];
    if (x < xlo) xlo = x; if (x > xhi) xhi = x; if (y < ylo) ylo = y; if (y > yhi) yhi = y;
  }
  const fl = gd._fullLayout;
  return {busy, n, xdata: [xlo, xhi], ydata: [ylo, yhi], xrange: fl.xaxis.range, yrange: fl.yaxis.range,
          title: [fl.xaxis.title.text, fl.yaxis.title.text]};
}""" % GD


def _settle(page, timeout=180):
    end = time.time() + timeout
    s = None
    while time.time() < end:
        s = page.evaluate(STATE)
        if not s["busy"] and s.get("n"):
            page.wait_for_timeout(2000)
            s = page.evaluate(STATE)
            if not s["busy"]:
                return s
        page.wait_for_timeout(300)
    pytest.fail(f"plot never settled; last state {s}")


def _choose(page, axis, field):
    """The key, then the column, as a user picks them; does not wait for the data."""
    base = f'.tile[data-tile-id="{CELL}"] '
    page.select_option(base + f'.axis-key-select[data-axis="{axis}"]', field["key"])
    col = base + f'.axis-column-select[data-axis="{axis}"]'
    page.wait_for_function("([sel, v]) => [...document.querySelector(sel).options].some(o => o.value === v)",
                           arg=[col, field["column"]], timeout=15000)
    page.select_option(col, field["column"])


def _no_stall(page):
    gap, tasks = page.evaluate("[window.__azGap, window.__azLong]")
    assert gap < 2000, f"the main thread was busy for {gap:.0f} ms"
    assert max(tasks, default=0) < 1000, f"long tasks {[round(t) for t in tasks]} ms"


@pytest.mark.parametrize("equal", [True, False], ids=["equal-aspect", "free-aspect"])
@pytest.mark.parametrize("first", ["x", "y"])
def test_two_axes_changed_while_loading(server, equal, first):
    root, store = server
    second = "y" if first == "x" else "x"
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 1400, "height": 1000})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.add_init_script(INIT)
        try:
            page.goto(_link(root, store, equal))
            page.wait_for_selector(f'.tile[data-tile-id="{CELL}"] .js-plotly-plot', timeout=120_000)
            s = _settle(page)
            assert s["n"] == SUBSET, s
            page.evaluate(WATCH)
            page.evaluate(f"() => {{ window.__azHold = {HOLD_MS}; }}")
            _choose(page, first, EMB("X_umap_allcells", "0" if first == "x" else "1"))
            page.wait_for_timeout(300)
            assert page.evaluate(STATE)["busy"], "the first axis is still loading"
            _choose(page, second, EMB("X_umap_allcells", "0" if second == "x" else "1"))
            s = _settle(page)
            _no_stall(page)
            calls = page.evaluate("window.__azCalls")
            # one redraw per axis, and nothing drawn over again (no relayout rounds)
            assert calls.get("react", 0) <= 2 and not calls.get("newPlot") and calls.get("relayout", 0) <= 1, calls
            assert s["title"] == ["obsm.X_umap_allcells.0", "obsm.X_umap_allcells.1"], s
            assert s["n"] == SUBSET, s
            for axis in ("x", "y"):       # the new embedding (about 20 +- 40), in view
                lo, hi = s[f"{axis}data"]
                assert lo > -60 and hi < 100 and hi - lo > 40, (axis, s)
                r = s[f"{axis}range"]
                assert min(r) <= lo and max(r) >= hi, (axis, s)
            assert not errors, errors
        finally:
            browser.close()


def test_a_superseded_load_draws_nothing(server):
    """X changed twice while loading: only the newer field is drawn, once."""
    root, store = server
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 1400, "height": 1000})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.add_init_script(INIT)
        try:
            page.goto(_link(root, store, True))
            page.wait_for_selector(f'.tile[data-tile-id="{CELL}"] .js-plotly-plot', timeout=120_000)
            _settle(page)
            page.evaluate(WATCH)
            page.evaluate(f"() => {{ window.__azHold = {HOLD_MS}; }}")
            _choose(page, "x", EMB("X_umap_allcells", "0"))
            page.wait_for_timeout(300)
            assert page.evaluate(STATE)["busy"], "the first load is still on its way"
            page.select_option(f'.tile[data-tile-id="{CELL}"] .axis-column-select[data-axis="x"]', "1")
            s = _settle(page)
            _no_stall(page)
            assert s["title"][0] == "obsm.X_umap_allcells.1", s
            calls = page.evaluate("window.__azCalls")
            assert calls.get("react", 0) == 1 and not calls.get("newPlot"), calls
            assert not errors, errors
        finally:
            browser.close()
