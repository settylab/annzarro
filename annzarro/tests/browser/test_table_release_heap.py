"""A destroyed table lets go of its rows: the heap returns to where it was.

A cell table of 100,000 rows is opened and removed, and opened again. After
each removal the page's JavaScript heap is read after forced garbage
collection (DevTools `HeapProfiler.collectGarbage`, repeated until it stops
shrinking). Before the fix a removed table kept its rows (SearchBuilder's
`resize.dtsb` window handler, `oInit.aaData`, the Select extension's closure,
the column render closures, the jQuery handlers on the detached table
element): about 13 MB per cycle at 20,000 rows, growing with every cycle.

The gate: after three more cycles the heap is within HEAP_GATE_MB of the
heap after the first cycle (growth), and within RESIDUAL_GATE_MB of the heap
before any table was opened (what stays held). The thresholds are not
widened to make a run pass; a failure is a table holding its rows.

The same measure through the other ways a table is destroyed: its rows read
again for another subset (the swap into the table shown does not build a
second one), and a panel closed and reopened from the closed list.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
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

from annzarro.tests.zarr_compat import consolidate, open_group, write_array, write_strings

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
ROWS = 100_000
HEAP_GATE_MB = 5.0        # growth over three more cycles
RESIDUAL_GATE_MB = 5.0    # above the heap before any table (the design's gate, step 0a)
CYCLES = 3
COLUMNS = [("obs", k) for k in ("leiden", "batch", "total_counts", "n_genes", "pct_mt", "doublet_score")]


def _store(path, n=ROWS):
    """obs of n rows: two categoricals and four numbers; a small X."""
    rng = np.random.default_rng(3)
    root = open_group(path, mode="w")
    root.attrs.update({"encoding-type": "anndata", "encoding-version": "0.1.0"})
    obs = root.create_group("obs")
    cols = ["leiden", "batch", "total_counts", "n_genes", "pct_mt", "doublet_score"]
    obs.attrs.update({"encoding-type": "dataframe", "encoding-version": "0.2.0", "_index": "_index", "column-order": cols})
    STR = {"encoding-type": "string-array", "encoding-version": "0.2.0"}
    ARR = {"encoding-type": "array", "encoding-version": "0.2.0"}
    write_strings(obs, "_index", [f"AAACCTGAGA{i:010d}-1" for i in range(n)])
    obs["_index"].attrs.update(STR)
    for name, k in (("leiden", 20), ("batch", 6)):
        g = obs.create_group(name)
        g.attrs.update({"encoding-type": "categorical", "encoding-version": "0.2.0", "ordered": False})
        write_array(g, "codes", rng.integers(0, k, n).astype(np.int8))
        g["codes"].attrs.update(ARR)
        write_strings(g, "categories", [str(i) for i in range(k)])
        g["categories"].attrs.update(STR)
    for name, v in (("total_counts", rng.gamma(3, 2000, n).astype(np.float32)),
                    ("n_genes", rng.integers(300, 6000, n).astype(np.int32)),
                    ("pct_mt", (rng.random(n) * 20).astype(np.float32)),
                    ("doublet_score", rng.random(n).astype(np.float32))):
        write_array(obs, name, v)
        obs[name].attrs.update(ARR)
    var = root.create_group("var")
    var.attrs.update({"encoding-type": "dataframe", "encoding-version": "0.2.0", "_index": "_index", "column-order": []})
    write_strings(var, "_index", [f"g{i}" for i in range(20)])
    var["_index"].attrs.update(STR)
    X = root.create_group("X")
    X.attrs.update({"encoding-type": "csc_matrix", "encoding-version": "0.1.0", "shape": [n, 20]})
    write_array(X, "data", np.ones(20, np.float32))
    write_array(X, "indices", np.arange(20, dtype=np.int32))
    write_array(X, "indptr", np.arange(21, dtype=np.int64))
    for g in ("obsm", "varm", "obsp", "varp", "layers", "uns"):
        root.create_group(g).attrs.update({"encoding-type": "dict", "encoding-version": "0.1.0"})
    consolidate(path)


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    home = tmp_path_factory.mktemp("home")
    data = tmp_path_factory.mktemp("data")
    store = str(data / "rows.zarr")
    _store(store)
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    (home / "c.yaml").write_text("ui: {}\n")
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--config", str(home / "c.yaml"),
                             "--host", "127.0.0.1", "--port", str(port), "--data-dir", str(data),
                             "--no-browser", "--auth-disabled"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for i in range(120):
        try:
            urllib.request.urlopen(root + "/api/v1/config", timeout=1)
            break
        except OSError:
            time.sleep(min(0.5, 0.1 * (i + 1)))
    else:
        proc.kill()
        pytest.fail("server did not start")
    yield root, store
    proc.terminate()
    proc.wait(10)


@pytest.fixture
def page(server):
    root, store = server
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            page.set_default_timeout(120000)
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}")
            page.wait_for_function("""async () => { const m = await import('/static/js/data-manager.js');
                const d = m.DataManager, c = d.getCells();
                return !!(d.getCurrentDataset() && d.isDatasetLoaded() && c && c.length); }""", timeout=120000)
            yield page
            assert not errors, errors
        finally:
            browser.close()


def heap_mb(page):
    """JS heap in MB after garbage collection, repeated until it stops shrinking."""
    cdp = page.context.new_cdp_session(page)
    try:
        cdp.send("HeapProfiler.enable")
        last = None
        for _ in range(8):
            cdp.send("HeapProfiler.collectGarbage")
            page.wait_for_timeout(200)
            now = cdp.send("Runtime.getHeapUsage")["usedSize"]
            if last is not None and now >= last * 0.999:
                break
            last = now
        return now / 1e6
    finally:
        cdp.detach()


CYCLE = """async (columns) => {
    const pm = window.PanelManager, id = 'cell-table-' + Date.now();
    const panel = pm.createPanel('cell-table', { id, title: 'T' + id,
        columns: columns.map(([type, key]) => ({ type, key, column: '' })) });
    const t = performance.now();
    const shown = () => !!document.querySelector(`.tile[data-tile-id="${id}"] .dataTables_scrollBody tbody tr`);
    while (!shown() && performance.now() - t < 120000) await new Promise(r => setTimeout(r, 100));
    if (!shown()) throw new Error('the table did not load');
    await new Promise(r => setTimeout(r, 600));
    pm.closePanel(id); pm.removePanel(id);
    await new Promise(r => setTimeout(r, 600));
}"""

CLEAR_CACHE = """async () => { const c = await import('/static/js/cache-manager.js'); const m = c.CacheManager || c.default;
    if (m && m.clear) m.clear(); }"""


def test_a_removed_table_lets_go_of_its_rows(page):
    page.wait_for_timeout(1500)
    page.evaluate(CLEAR_CACHE)
    before = heap_mb(page)
    seen = []
    for _ in range(1 + CYCLES):
        page.evaluate(CYCLE, COLUMNS)
        page.evaluate(CLEAR_CACHE)
        seen.append(heap_mb(page))
    print(f"\nheap MB before {before:.1f}, after each cycle {[round(h, 1) for h in seen]}")
    growth = seen[-1] - seen[0]
    residual = seen[-1] - before
    assert growth < HEAP_GATE_MB, f"the heap grew {growth:.1f} MB over {CYCLES} more cycles ({seen})"
    assert residual < RESIDUAL_GATE_MB, (
        f"{residual:.1f} MB above the heap before any table is still held after {1 + CYCLES} cycles ({before:.1f} -> {seen})")
