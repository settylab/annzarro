"""Numeric table columns keep the number filters, in a real browser.

v0.4.1 report: in the bm_aging gene table (16,285 genes) the column "layer
kompot_de_Old_smoothed" for the focused cell offered only string conditions
("Contains", ...), no "Greater Than". The values were fine floats; every
column with more distinct values than utils/categories.js VALUE_LIST_MAX
(10,000) was given the text-only SearchBuilder type, numeric or not.

The store here has 40 cells and 10,050 genes, so a gene-table column of one
cell's layer row, or of one gene's varp row, holds 10,050 distinct floats; the
cell-table obsp and layer columns hold 40. Each must offer "Greater Than", and
"Greater Than t" must keep exactly the rows above t.

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

N_CELLS, N_GENES = 40, 10050          # N_GENES > VALUE_LIST_MAX (10,000)
CELLS = [f"c{i:02d}" for i in range(N_CELLS)]
GENES = [f"g{i:05d}" for i in range(N_GENES)]
FOCUS_CELL, FOCUS_GENE = CELLS[3], GENES[7]

rng = np.random.default_rng(41)
LAYER = rng.random((N_CELLS, N_GENES), dtype=np.float32)
OBSP = rng.random((N_CELLS, N_CELLS), dtype=np.float32)
VARP_ROW = rng.random(N_GENES, dtype=np.float32)


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _encode(node, kind, version="0.2.0"):
    node.attrs.update({"encoding-type": kind, "encoding-version": version})
    return node


def _dataframe(root, name, index):
    g = _encode(open_group(os.path.join(root, name), mode="w"), "dataframe")
    g.attrs.update({"_index": "_index", "column-order": []})
    _encode(write_strings(g, "_index", index), "string-array")


def _make_store(path):
    root = _encode(open_group(path, mode="w"), "anndata", "0.1.0")
    _dataframe(path, "obs", CELLS)
    _dataframe(path, "var", GENES)
    _encode(write_array(root, "X", LAYER), "array")
    layers = _encode(root.create_group("layers"), "dict", "0.1.0")
    _encode(write_array(layers, "smooth", LAYER), "array")
    obsp = _encode(root.create_group("obsp"), "dict", "0.1.0")
    _encode(write_array(obsp, "conn", OBSP), "array")
    # varp: sparse, only the focused gene's row filled (a dense 10,050^2 matrix is 400 MB)
    varp = _encode(root.create_group("varp"), "dict", "0.1.0")
    corr = _encode(varp.create_group("corr"), "csr_matrix", "0.1.0")
    corr.attrs["shape"] = [N_GENES, N_GENES]
    row = GENES.index(FOCUS_GENE)
    indptr = np.zeros(N_GENES + 1, dtype=np.int64)
    indptr[row + 1:] = N_GENES
    write_array(corr, "indptr", indptr)
    write_array(corr, "indices", np.arange(N_GENES, dtype=np.int32))
    write_array(corr, "data", VARP_ROW)
    obsm = _encode(root.create_group("obsm"), "dict", "0.1.0")
    _encode(write_array(obsm, "X_umap", rng.random((N_CELLS, 2), dtype=np.float32)), "array")
    _encode(root.create_group("uns"), "dict", "0.1.0")
    zarr.consolidate_metadata(path)


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    home = tmp_path_factory.mktemp("home")
    data = tmp_path_factory.mktemp("data")
    store = str(data / "numeric.zarr")
    _make_store(store)
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


GENE_TABLE = [{"type": "layer", "key": "smooth", "column": FOCUS_CELL},
              {"type": "varp", "key": "corr", "column": FOCUS_GENE}]
CELL_TABLE = [{"type": "layer", "key": "smooth", "column": FOCUS_GENE},
              {"type": "obsp", "key": "conn", "column": FOCUS_CELL}]


def _link(root, store):
    configs = {"gene-table-G": {"id": "gene-table-G", "title": "genes", "columns": GENE_TABLE},
               "cell-table-C": {"id": "cell-table-C", "title": "cells", "columns": CELL_TABLE}}
    tiles = [{"type": "tile", "id": tid, "controlsVisible": False} for tid in configs]
    view = {"v": 1, "constants": {"focusedCell": FOCUS_CELL, "focusedGene": FOCUS_GENE},
            "layout": {"v": 1, "hierarchy": tiles, "controlState": {t["id"]: False for t in tiles},
                       "panelConfigs": configs}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={store}#view={enc}"


def _expected(tile, column):
    if tile == "gene-table-G":
        values = LAYER[CELLS.index(FOCUS_CELL)] if column["type"] == "layer" else VARP_ROW
    else:
        values = LAYER[:, GENES.index(FOCUS_GENE)] if column["type"] == "layer" \
            else OBSP[CELLS.index(FOCUS_CELL)]
    return values.astype(np.float64)


CASES = [("gene-table-G", c) for c in GENE_TABLE] + [("cell-table-C", c) for c in CELL_TABLE]


@pytest.mark.parametrize("tile,column", CASES, ids=[f"{t}-{c['type']}" for t, c in CASES])
def test_numeric_column_offers_greater_than_and_filters(server, tile, column):
    root, store = server
    tab = f'.tile[data-tile-id="{tile}"]'
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 1500, "height": 1400})
        try:
            page.goto(_link(root, store))
            page.wait_for_function(
                f"() => {{ const t = document.querySelector('{tab} table[id^=DataTables_Table]');"
                f" return t && jQuery(t).DataTable().columns().count() === 3"
                f" && jQuery(t).DataTable().column(2).data().length > 0; }}", timeout=90000)
            title = f"{column['key']}: {column['column']}"
            page.click(f"{tab} .dtsb-add")
            page.select_option(f"{tab} select.dtsb-data", label=title)
            conditions = page.eval_on_selector(f"{tab} select.dtsb-condition",
                                               "s => [...s.options].map(o => o.value)")
            assert ">" in conditions and "between" in conditions, conditions
            assert "contains" not in conditions, conditions

            values = _expected(tile, column)
            threshold = float(np.round(np.median(values), 3))
            page.select_option(f"{tab} select.dtsb-condition", value=">")
            # SearchBuilder replaces the value box after the condition change;
            # type into the box it ends up with
            details = (f"() => jQuery(document.querySelector('{tab} table[id^=DataTables_Table]'))"
                       f".DataTable().searchBuilder.getDetails()")
            for _ in range(50):
                page.wait_for_selector(f"{tab} input.dtsb-value", state="visible")
                page.fill(f"{tab} input.dtsb-value", str(threshold))
                if (page.evaluate(details).get("criteria") or [{}])[0].get("value") == [str(threshold)]:
                    break
                time.sleep(0.2)
            want = int((values > threshold).sum())
            assert 0 < want < len(values)
            count = (f"() => jQuery(document.querySelector('{tab} table[id^=DataTables_Table]'))"
                     f".DataTable().rows({{search: 'applied'}}).count()")
            t0 = time.time()
            got = None
            while time.time() - t0 < 30:
                got = page.evaluate(count)
                if got == want:
                    break
                time.sleep(0.2)
            details = page.evaluate(f"() => jQuery(document.querySelector('{tab} table[id^=DataTables_Table]'))"
                                    f".DataTable().searchBuilder.getDetails()")
            assert got == want, json.dumps([got, want, threshold, details])
            if os.environ.get("AZ_SHOT_DIR"):
                page.screenshot(path=os.path.join(os.environ["AZ_SHOT_DIR"],
                                                  f"{tile}-{column['type']}.png"))
        finally:
            browser.close()
