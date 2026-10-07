"""A table's text search sits on its own row below the SearchBuilder.

v0.4.1 operator report: the search box clipped the advanced search builder.
The two sat side by side (DataTables dom columns sized by the VIEWPORT), so a
table in a split panel squeezed both and the search box and its label ran onto
the builder. Now the builder has a full-width row and the search a slim
full-width row directly below it, with the table header right under that.

Checked at a panel half the window wide (split) and a narrow window, with the
builder empty and with two conditions, in a cell and a gene table: the search
row and the builder do not overlap, the search row is below the builder,
typing still filters, and a saved searchText comes back in the box.

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

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
N_CELLS, N_GENES = 200, 20


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    home = tmp_path_factory.mktemp("home")
    data = tmp_path_factory.mktemp("data")
    store = str(data / "fixture_small.zarr")
    shutil.copytree(os.path.join(DATA_DIR, "fixture_small.zarr"), store)
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


TWO_CONDITIONS = {
    "cell-table-C": {"logic": "AND", "criteria": [
        {"data": "cell_type", "origData": "obs_cell_type_main", "condition": "!=", "type": "string",
         "value": ["Kupffer"]},
        {"data": "total_counts", "origData": "obs_total_counts_main", "condition": ">", "type": "num",
         "value": ["0"]}]},
    "gene-table-G": {"logic": "AND", "criteria": [
        {"data": "gene_name", "origData": "var_gene_name_main", "condition": "!null", "type": "string",
         "value": []},
        {"data": "gene_name", "origData": "var_gene_name_main", "condition": "starts", "type": "string",
         "value": ["G"]}]},
}


def _link(root, store, conditions, search_text):
    configs = {
        "cell-table-C": {"id": "cell-table-C", "title": "cells",
                         "columns": [{"type": "obs", "key": "cell_type", "column": ""},
                                     {"type": "obs", "key": "total_counts", "column": ""}]},
        "gene-table-G": {"id": "gene-table-G", "title": "genes",
                         "columns": [{"type": "var", "key": "gene_name", "column": ""}]},
    }
    for tid, cfg in configs.items():
        if conditions:
            cfg["searchBuilderConfig"] = TWO_CONDITIONS[tid]
        if search_text:
            cfg["searchText"] = search_text[tid]
    tiles = [{"type": "tile", "id": tid, "controlsVisible": False} for tid in configs]
    hierarchy = [{"type": "split", "direction": "horizontal",
                  "panes": [{"percentage": 50}, {"percentage": 50}], "children": tiles}]
    view = {"v": 1, "layout": {"v": 1, "hierarchy": hierarchy,
                               "controlState": {t["id"]: False for t in tiles}, "panelConfigs": configs}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={store}#view={enc}"


GEOM = """(tab) => {
  const t = document.querySelector(`.tile[data-tile-id="${tab}"]`);
  const box = e => { const b = e.getBoundingClientRect(); return {l: b.left, t: b.top, r: b.right, b: b.bottom}; };
  const builder = box(t.querySelector('.dtsb-searchBuilder'));
  const row = box(t.querySelector('.dt-search-container'));
  const searchRow = box(t.querySelector('.az-search-row'));
  const header = box(t.querySelector('.dataTables_scrollHead'));
  const parts = [...t.querySelectorAll('.dt-search-container label, .dt-search-container input, .dt-search-option')]
      .map(box);
  const tile = box(t);
  const dt = jQuery(t.querySelector('table[id^=DataTables_Table]')).DataTable();
  return { builder, row, searchRow, header, parts, tile, rows: dt.rows({search: 'applied'}).count(),
           total: dt.rows().count(), value: t.querySelector('.dataTables_filter input').value };
}"""


def _overlap(a, b):
    return not (a["r"] <= b["l"] or b["r"] <= a["l"] or a["b"] <= b["t"] or b["b"] <= a["t"])


@pytest.mark.parametrize("width", [1400, 560], ids=["split", "narrow"])
@pytest.mark.parametrize("conditions", [False, True], ids=["empty-builder", "two-conditions"])
def test_search_row_is_below_the_builder_and_filters(server, width, conditions):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": width, "height": 1600})
        try:
            page.goto(_link(root, store, conditions, None))
            for tab, n in (("cell-table-C", N_CELLS), ("gene-table-G", N_GENES)):
                sel = f'.tile[data-tile-id="{tab}"]'
                page.wait_for_selector(f"{sel} .dataTables_scrollBody tbody tr", timeout=60000)
                g = page.evaluate(GEOM, tab)
                assert not _overlap(g["builder"], g["row"]), g
                assert g["row"]["t"] >= g["builder"]["b"] - 1, g
                for part in g["parts"]:
                    assert not _overlap(g["builder"], part), (part, g)
                    assert part["r"] <= g["tile"]["r"] + 1, ("search row runs out of the panel", part, g)
                assert g["row"]["b"] - g["row"]["t"] <= 40, ("the search row is one slim line", g)
                # the header follows the search row: no band between them (a
                # flex rule meant for the table row stretched the search row)
                assert g["searchRow"]["b"] - g["searchRow"]["t"] <= 40, ("the search row holds no band", g)
                assert g["header"]["t"] - g["row"]["b"] < 16, ("gap above the table header", g)
                before = g["rows"]
                if conditions:
                    assert before < n if tab == "cell-table-C" else before == n
                # typing filters, on top of the builder
                name = "cell_0007" if tab == "cell-table-C" else "GENE007"
                page.fill(f"{sel} .dataTables_filter input", name)
                page.wait_for_function(
                    f"() => jQuery(document.querySelector('{sel} table[id^=DataTables_Table]'))"
                    f".DataTable().rows({{search: 'applied'}}).count() <= 1", timeout=20000)
                page.fill(f"{sel} .dataTables_filter input", "")
                page.wait_for_function(
                    f"n => jQuery(document.querySelector('{sel} table[id^=DataTables_Table]'))"
                    f".DataTable().rows({{search: 'applied'}}).count() === n", arg=before, timeout=20000)
                if os.environ.get("AZ_SHOT_DIR"):
                    page.query_selector(sel).screenshot(path=os.path.join(
                        os.environ["AZ_SHOT_DIR"], f"test_{width}_{int(conditions)}_{tab}.png"))
        finally:
            browser.close()


def test_saved_search_text_comes_back_in_the_row(server):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 1400, "height": 1600})
        try:
            page.goto(_link(root, store, True, {"cell-table-C": "cell_01", "gene-table-G": "GENE01"}))
            for tab, text, want in (("cell-table-C", "cell_01", None), ("gene-table-G", "GENE01", 10)):
                sel = f'.tile[data-tile-id="{tab}"]'
                page.wait_for_selector(f"{sel} .dataTables_scrollBody tbody tr", timeout=60000)
                g = page.evaluate(GEOM, tab)
                assert g["value"] == text
                assert 0 < g["rows"] < g["total"]
                if want is not None:
                    assert g["rows"] == want
                assert g["row"]["t"] >= g["builder"]["b"] - 1, g
        finally:
            browser.close()
