"""A Cell Table filter and the Cell Plot it filters, at scale, counted.

Reported on 0.5.0: a share link with two Cell Plots coloured by a gene and a
Cell Table filtered to one Leiden cluster (484,125 cells), one plot filtered
by the table. Changing that plot's X to another embedding froze the page for
96 s (Chrome's "Page Unresponsive"); landing on the link held the page for
two stretches of over 6 s each while the table filtered its rows.

1. Landing: the table's filter runs over the rows once (it ran twice: the
   filter was rebuilt from itself after the table was made), reads the
   table's settings once per condition (it read them five times per row),
   and keeps the rows SearchBuilder's own row test keeps.
2. X changed on the plot the table filters (a continuous colour, drawn as
   in-table and not-in-table traces): no search of the list of cell names per
   point (one per point on 0.5.0, fixed in 0.5.1), one redraw, the new X.

Counts, not times: they do not depend on the machine.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import base64
import json
import os
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
N_CELLS, N_CLUSTERS, CLUSTER = 60_000, 20, 11
PLOT, TABLE = "cell-plot-1", "cell-table-1"

EMB = lambda key, column: {"type": "obsm", "key": key, "column": column}   # noqa: E731
STRING = {"encoding-type": "string-array", "encoding-version": "0.2.0"}
ARRAY = {"encoding-type": "array", "encoding-version": "0.2.0"}


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _store(path):
    """Barcode-like names, a Leiden cluster (11 about 5 %), one gene, two embeddings."""
    rng = np.random.default_rng(0)
    g = zarr.open_group(str(path), mode="w")
    g.attrs.update({"encoding-type": "anndata", "encoding-version": "0.1.0"})
    obs = g.create_group("obs")
    obs.attrs.update({"_index": "_index", "column-order": ["leiden_cluster"],
                      "encoding-type": "dataframe", "encoding-version": "0.2.0"})
    bases = np.array(list("ACGT"))
    names = ["".join(b) + f"-1_s{i % 7}" for i, b in enumerate(bases[rng.integers(0, 4, (N_CELLS, 16))])]
    index = obs.create_array("_index", shape=(N_CELLS,), dtype=str)
    index[:] = np.array(names, dtype=object)
    index.attrs.update(STRING)
    p = np.full(N_CLUSTERS, 0.95 / (N_CLUSTERS - 1))
    p[CLUSTER] = 0.05
    codes = rng.choice(N_CLUSTERS, N_CELLS, p=p).astype("int8")
    cat = obs.create_group("leiden_cluster")
    cat.attrs.update({"ordered": False, "encoding-type": "categorical", "encoding-version": "0.2.0"})
    cats = cat.create_array("categories", shape=(N_CLUSTERS,), dtype=str)
    cats[:] = np.array([str(i) for i in range(N_CLUSTERS)], dtype=object)
    cats.attrs.update(STRING)
    c = cat.create_array("codes", shape=(N_CELLS,), dtype="int8")
    c[:] = codes
    c.attrs.update(ARRAY)
    var = g.create_group("var")
    var.attrs.update({"_index": "_index", "column-order": [], "encoding-type": "dataframe",
                      "encoding-version": "0.2.0"})
    vi = var.create_array("_index", shape=(1,), dtype=str)
    vi[:] = np.array(["POSTN"], dtype=object)
    vi.attrs.update(STRING)
    x = g.create_group("X")
    x.attrs.update({"shape": [N_CELLS, 1], "encoding-type": "csr_matrix", "encoding-version": "0.1.0"})
    nz = np.flatnonzero(rng.random(N_CELLS) < 0.3)
    indptr = np.zeros(N_CELLS + 1, dtype="int64")
    indptr[nz + 1] = 1
    for name, arr in (("data", rng.gamma(2.0, 1.0, nz.size).astype("float32")),
                      ("indices", np.zeros(nz.size, dtype="int32")), ("indptr", np.cumsum(indptr))):
        x.create_array(name, shape=arr.shape, dtype=arr.dtype)[:] = arr
    obsm = g.create_group("obsm")
    obsm.attrs.update({"encoding-type": "dict", "encoding-version": "0.1.0"})
    umap = (rng.normal(0, 8, (N_CLUSTERS, 2))[codes] + rng.normal(0, 1, (N_CELLS, 2))).astype("float32")
    for key, values in (("X_umap", umap), ("X_spatial", rng.uniform(0, 20000, (N_CELLS, 2)).astype("float32"))):
        a = obsm.create_array(key, shape=values.shape, dtype="float32")
        a[:] = values
        a.attrs.update(ARRAY)
    for name in ("layers", "obsp", "uns", "varm", "varp"):
        g.create_group(name).attrs.update({"encoding-type": "dict", "encoding-version": "0.1.0"})
    zarr.consolidate_metadata(str(path))
    return int((codes == CLUSTER).sum())


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    data = tmp_path_factory.mktemp("data")
    in_cluster = _store(data / "clusters.zarr")
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
    yield root, str(data / "clusters.zarr"), in_cluster
    proc.terminate()
    proc.wait(10)


def _link(root, store):
    """The reported view: a gene colour, the plot filtered by a table of one cluster, every cell."""
    plot = {"id": PLOT, "title": "POSTN", "x": EMB("X_umap", "0"), "y": EMB("X_umap", "1"), "z": None,
            "color": {"type": "layer", "key": "X", "column": "POSTN"}, "equalAspect": True,
            "hoverInfo": [{"type": "obs", "key": "_index"}, {"type": "obs", "key": "leiden_cluster"}],
            "highlightFocusedCell": True, "tableFilter": TABLE,
            "viewport2D": {"axes": "obsm.X_umap.0|obsm.X_umap.1|-", "xrange": [-6, 8], "yrange": [-5, 7]}}
    table = {"id": TABLE, "title": "Cells in Leiden cluster 11",
             "columns": [{"type": "obs", "key": "leiden_cluster", "column": ""}],
             "searchBuilderConfig": {"logic": "AND", "criteria": [
                 {"condition": "=", "data": "leiden_cluster", "origData": "obs_leiden_cluster_main",
                  "type": "num", "value": [str(CLUSTER)]}]}}
    view = {"v": 1, "subset": None, "constants": {"focusedGene": "POSTN"},
            "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": PLOT, "controlsVisible": True},
                                             {"type": "tile", "id": TABLE, "controlsVisible": True}],
                       "controlState": {PLOT: True, TABLE: True}, "panelConfigs": {PLOT: plot, TABLE: table}}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}"


# Counted from the first table on: SearchBuilder rebuilds, row tests, and the
# table settings() calls made inside a row test (each builds an API object).
COUNT = """
document.addEventListener('DOMContentLoaded', () => {
  const c = window.__azTable = {rebuild: 0, rows: 0, settings: 0};
  const dt = $.fn.dataTable;
  const rebuild = dt.SearchBuilder.prototype.rebuild;
  dt.SearchBuilder.prototype.rebuild = function(...a) { c.rebuild++; return rebuild.apply(this, a); };
  $(document).on('preInit.dt', () => {
    const search = dt.Criteria.prototype.search;
    if (search.azCounted) return;
    const counted = function(...a) {
      c.rows++;
      const api = this.s.dt, own = api.settings;
      api.settings = function(...b) { c.settings++; return own.apply(this, b); };
      try { return search.apply(this, a); } finally { api.settings = own; }
    };
    counted.azCounted = true;
    counted.azOriginal = search.azOriginal;
    dt.Criteria.prototype.search = counted;
  });
});
"""

GD = f'document.querySelector(\'.tile[data-tile-id="{PLOT}"] .js-plotly-plot\')'
INFO = f'.tile[data-tile-id="{TABLE}"] .dataTables_info'

STATE = """() => {
  const gd = %s;
  const busy = [...document.querySelectorAll('.loading-overlay, .spinner-border')].filter(e => e.offsetParent !== null).length;
  if (!gd || !gd.data || !gd.data.length || !gd._fullLayout || !gd._fullLayout.xaxis) return {busy: busy || 1};
  let n = 0;
  for (const t of gd.data) if (t.hoverinfo !== 'skip' && t.x && t.x.length > 1) n += t.x.length;
  return {busy, n, traces: gd.data.length, title: gd._fullLayout.xaxis.title.text};
}""" % GD


def _settle(page, title, timeout=180):
    end = time.time() + timeout
    s = None
    while time.time() < end:
        s = page.evaluate(STATE)
        if not s["busy"] and s.get("n") and s["title"] == title:
            page.wait_for_timeout(1500)
            s = page.evaluate(STATE)
            if not s["busy"]:
                return s
        page.wait_for_timeout(200)
    pytest.fail(f"plot never settled on {title}; last state {s}")


def _land(page, root, store, in_cluster):
    page.add_init_script(COUNT)
    page.goto(_link(root, store))
    page.wait_for_selector(INFO, timeout=120_000)
    s = _settle(page, "obsm.X_umap.0")
    page.wait_for_function("([sel, n]) => document.querySelector(sel).textContent.includes(n)",
                           arg=[INFO, f"{in_cluster:,} entries"], timeout=60_000)
    page.wait_for_timeout(1000)
    return s


def test_landing_filters_the_rows_once(server):
    root, store, in_cluster = server
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 1400, "height": 1000})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        try:
            _land(page, root, store, in_cluster)
            info = page.eval_on_selector(INFO, "e => e.textContent")
            assert f"of {in_cluster:,} entries (filtered from {N_CELLS:,} total" in info, info
            c = page.evaluate("window.__azTable")
            assert c["rows"] == N_CELLS, f"the filter ran over {c['rows'] / N_CELLS:g} times the rows: {c}"
            assert c["rebuild"] <= 1, c
            assert c["settings"] <= 1, f"{c['settings']} settings() calls in {c['rows']} row tests"
            # every row kept or dropped as SearchBuilder's own row test does
            same = page.evaluate("""() => {
              const api = $('.tile[data-tile-id="%s"] .dataTables_scrollBody table').DataTable();
              const sb = api.settings()[0]._searchBuilder;
              const crit = sb.s.topGroup.s.criteria.map(c => c.criteria);
              const theirs = $.fn.dataTable.Criteria.prototype.search.azOriginal;
              const rows = api.rows().indexes().toArray();
              const data = api.settings()[0].aoData;
              let differ = 0, kept = 0;
              for (const i of rows) for (const c of crit) {
                const row = data[i]._aFilterData;
                const ours = c.search(row, i), base = theirs.call(c, row, i);
                if (ours !== base) differ++;
                if (base) kept++;
              }
              return {crit: crit.length, rows: rows.length, differ, kept};
            }""" % TABLE)
            assert same == {"crit": 1, "rows": N_CELLS, "differ": 0, "kept": in_cluster}, same
            assert not errors, errors
        finally:
            browser.close()


# The cell-name list of N_CELLS names: searches of it (Array or PackedNames) counted.
NAME_SEARCHES = """async (n) => {
  const { PackedNames } = await import('/static/js/utils/packed-names.js');
  window.__azSearches = 0;
  for (const proto of [Array.prototype, PackedNames.prototype]) {
    const own = proto.indexOf;
    proto.indexOf = function(...a) { if (this.length === n) window.__azSearches++; return own.apply(this, a); };
  }
  window.__azCalls = {};
  for (const fn of ['react', 'newPlot', 'relayout', 'restyle']) {
    const o = Plotly[fn];
    Plotly[fn] = function(...args) { window.__azCalls[fn] = (window.__azCalls[fn] || 0) + 1; return o.apply(this, args); };
  }
}"""


def test_x_changed_on_a_table_filtered_plot(server):
    root, store, in_cluster = server
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 1400, "height": 1000})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        try:
            before = _land(page, root, store, in_cluster)
            assert before["traces"] > 1, f"the table filter draws in-table and other cells apart: {before}"
            page.evaluate(NAME_SEARCHES, N_CELLS)
            base = f'.tile[data-tile-id="{PLOT}"] '
            page.select_option(base + '.axis-key-select[data-axis="x"]', "X_spatial")
            col = base + '.axis-column-select[data-axis="x"]'
            page.wait_for_function("(sel) => [...document.querySelector(sel).options].some(o => o.value === '0')",
                                   arg=col, timeout=15000)
            if page.eval_on_selector(col, "e => e.value") != "0":
                page.select_option(col, "0")
            s = _settle(page, "obsm.X_spatial.0")
            assert s["n"] == N_CELLS, s
            searches = page.evaluate("window.__azSearches")
            assert searches < 100, f"{searches} searches of the {N_CELLS:,} cell names for one axis change"
            calls = page.evaluate("window.__azCalls")
            assert calls.get("react", 0) == 1 and not calls.get("newPlot"), calls
            assert not errors, errors
        finally:
            browser.close()
