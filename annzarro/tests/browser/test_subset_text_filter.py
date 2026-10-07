"""A cell table's text filter, copied into the subset dialog, in a real browser.

v0.4.1 report: "drug contains ..." in a Cell Table was refused by the subset
dialog ("Not copied ... text conditions other than = and !="). The subset now
applies SearchBuilder's text conditions (contains, starts with, ends with,
their negations, empty, not empty; case-insensitive) and OR / nested groups
to every cell on the server.

One Cell Table holds all 200 cells, so its filtered count IS the number of
cells the filter keeps. For a categorical column ("drug") and a plain string
column ("drug_free"), with the same values:

1. the filter "contains <text>" is typed in the table's SearchBuilder, "Use"
   copies it, nothing is refused, and the dialog's preview names exactly the
   table's count; after Apply the badge and the server's reply agree;
2. a nested filter (an OR of a text condition and an AND with "is empty"),
   set on the table, copies whole, with the same count.

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

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(os.path.dirname(HERE), "data")
N = 200
DRUGS = ["Cisplatin", "carboplatin", "Nivolumab", "PEMBROLIZUMAB", "Paclitaxel", "taxol-X", ""]
ROWS = [DRUGS[(i * 7 + i // 3) % len(DRUGS)] for i in range(N)]


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    home = tmp_path_factory.mktemp("home")
    data = tmp_path_factory.mktemp("data")
    store = str(data / "drugs.zarr")
    shutil.copytree(os.path.join(DATA_DIR, "fixture_small.zarr"), store)
    obs = open_group(os.path.join(store, "obs"), mode="a")
    g = obs.create_group("drug")
    g.attrs.update({"encoding-type": "categorical", "encoding-version": "0.2.0", "ordered": False})
    write_array(g, "codes", np.array([DRUGS.index(d) for d in ROWS], dtype=np.int8))
    write_strings(g, "categories", DRUGS)
    write_strings(obs, "drug_free", ROWS)
    free = obs["drug_free"]
    free.attrs.update({"encoding-type": "string-array", "encoding-version": "0.2.0"})
    order = list(obs.attrs.get("column-order", []))
    obs.attrs["column-order"] = order + ["drug", "drug_free"]
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


def _link(root, store):
    cfg = {"id": "cell-table-T", "title": "cells",
           "columns": [{"type": "obs", "key": c, "column": ""} for c in ("drug", "drug_free")]}
    tiles = [{"type": "tile", "id": "cell-table-T", "controlsVisible": True}]
    view = {"v": 1, "subset": None,
            "layout": {"v": 1, "hierarchy": tiles, "controlState": {"cell-table-T": True},
                       "panelConfigs": {"cell-table-T": cfg}}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={store}#view={enc}"


TABLE = "jQuery(document.querySelector('.tile[data-tile-id=\"cell-table-T\"] table[id^=DataTables_Table]')).DataTable()"


def _wait_count(page, want, timeout=30):
    t0, got = time.time(), None
    while time.time() - t0 < timeout:
        got = page.evaluate(f"() => {TABLE}.rows({{search: 'applied'}}).count()")
        if got == want:
            return
        time.sleep(0.2)
    pytest.fail(f"the table keeps {got} rows, expected {want}")


def _open_table(browser, root, store):
    page = browser.new_page(viewport={"width": 1500, "height": 1000})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(_link(root, store))
    page.wait_for_function(f"() => {{ try {{ return {TABLE}.rows().count() === {N}; }} catch (e) {{ return false; }} }}",
                           timeout=60000)
    return page, errors


def _use_in_dialog(page):
    """Open the subset dialog, copy the table's filter; the dialog's preview text."""
    page.click("#subset-button")
    page.wait_for_selector("#subset-modal", state="visible")
    if not page.is_checked("#subset-enabled"):
        page.check("#subset-enabled")
    if not page.is_checked("#subset-n-all"):
        page.check("#subset-n-all")
    page.click("#subset-import")
    page.wait_for_function("() => /cells will be shown|Not copied|no filter/.test("
                           "document.getElementById('subset-preview').textContent)", timeout=30000)
    return page.inner_text("#subset-preview")


def _shot(page, name):
    if os.environ.get("AZ_SHOT_DIR"):
        page.screenshot(path=os.path.join(os.environ["AZ_SHOT_DIR"], name))


@pytest.mark.parametrize("column", ["drug", "drug_free"])
@pytest.mark.parametrize("text,keep", [("PLATIN", lambda d: "platin" in d.lower()),
                                       ("mab", lambda d: "mab" in d.lower())])
def test_contains_filter_is_copied_and_keeps_the_tables_cells(server, column, text, keep):
    root, store = server
    want = sum(1 for d in ROWS if keep(d))
    assert 0 < want < N
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            page, errors = _open_table(browser, root, store)
            page.click(".tile[data-tile-id='cell-table-T'] .dtsb-add")
            page.select_option(".tile[data-tile-id='cell-table-T'] select.dtsb-data", label=column)
            page.select_option(".tile[data-tile-id='cell-table-T'] select.dtsb-condition", value="contains")
            details = f"() => {TABLE}.searchBuilder.getDetails()"
            for _ in range(50):
                page.wait_for_selector(".tile[data-tile-id='cell-table-T'] input.dtsb-value", state="visible")
                page.fill(".tile[data-tile-id='cell-table-T'] input.dtsb-value", text)
                if (page.evaluate(details).get("criteria") or [{}])[0].get("value") == [text]:
                    break
                time.sleep(0.2)
            _wait_count(page, want)

            preview = _use_in_dialog(page)
            assert "Not copied" not in preview, preview
            assert preview.startswith(f"{want} of {N} cells will be shown"), preview
            conds = page.locator("#subset-conditions .subset-condition")
            assert conds.count() == 1
            assert conds.first.locator(".subset-col").input_value() == column
            assert conds.first.locator(".subset-op").input_value() == "contains"
            assert conds.first.locator(".subset-string").input_value() == text
            _shot(page, f"subset-contains-{column}.png")

            page.wait_for_function("() => !document.getElementById('subset-apply').disabled")
            page.click("#subset-apply")
            page.wait_for_selector("#subset-modal", state="hidden")
            page.wait_for_function(f"() => document.getElementById('cell-count').textContent.includes('{want}')",
                                   timeout=30000)
            body = page.evaluate("""async () => {
                const s = new URLSearchParams(location.search).get('dataset_path');
                const sp = JSON.stringify({n: null, seed: 0, where: [%s]});
                return (await fetch('/api/v1/data/subset?' + new URLSearchParams({dataset_path: s, subset: sp}))).json();
            }""" % json.dumps({"col": column, "op": "contains", "value": text}))
            assert body["n"] == want and body["n_eligible"] == want
            assert not errors, errors
        finally:
            browser.close()


@pytest.mark.parametrize("column", ["drug", "drug_free"])
def test_nested_or_and_empty_is_copied_whole(server, column):
    root, store = server
    low = [d.lower() for d in ROWS]
    # contains "taxol"  OR  (is empty AND does not end with "x")
    want = sum(1 for d in low if "taxol" in d or (d == "" and not d.endswith("x")))
    assert 0 < want < N
    crit = {"logic": "OR", "criteria": [
        {"condition": "contains", "data": column, "origData": f"obs_{column}_main", "type": "string", "value": ["Taxol"]},
        {"logic": "AND", "criteria": [
            {"condition": "null", "data": column, "origData": f"obs_{column}_main", "type": "string", "value": []},
            {"condition": "!ends", "data": column, "origData": f"obs_{column}_main", "type": "string", "value": ["X"]}]}]}
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            page, errors = _open_table(browser, root, store)
            page.evaluate(f"(d) => {TABLE}.searchBuilder.rebuild(d)", crit)
            _wait_count(page, want)
            preview = _use_in_dialog(page)
            assert "Not copied" not in preview, preview
            assert preview.startswith(f"{want} of {N} cells will be shown"), preview
            assert page.locator("#subset-conditions .subset-group").count() == 1
            _shot(page, f"subset-nested-{column}.png")
            assert not errors, errors
        finally:
            browser.close()
