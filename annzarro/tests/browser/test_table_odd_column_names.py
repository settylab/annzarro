"""Tables show columns whose names DataTables would read as a path or a call.

Reported: adding an obs column named ``orig.ident`` to the Cell Table gave
"DataTables warning: Requested unknown parameter 'obs_orig.ident_main' for row 0, column 1".
DataTables reads a column's ``data`` string as nested-object notation: "." nests, a trailing
"[...]" indexes an array and a trailing "()" calls a function.

The store has obs and var columns named ``orig.ident`` (strings), ``a[0]``, ``f(x)``,
``with space``, ``x.y.z``, ``überλ``, ``a,b`` and ``50%``. Both tables are given all of them, and each is checked
for: its values rendered, sorting, the text search, a SearchBuilder condition, hiding and
showing the column, the CSV export, and a panel set saved and loaded in a fresh page.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import base64
import csv
import io
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
N_OBS, N_VAR = 200, 20
# no slash: zarr and h5ad would make "a/b" a nested group, so no store has such a column
NAMES = ["orig.ident", "a[0]", "f(x)", "with space", "x.y.z", "überλ", "a,b", "50%"]
STRING_COLUMN = "orig.ident"      # S0, S1, S2 ...; every other column is the row number plus one, times its position
TILES = {"cells": ("cell-table-D", "obs"), "genes": ("gene-table-D", "var")}


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _number(i, j):
    return float((i + 1) * (j + 1))


def _store(path):
    shutil.copytree(os.path.join(DATA_DIR, "fixture_small.zarr"), path)
    g = zarr.open_group(str(path), mode="r+")
    for slot, n in (("obs", N_OBS), ("var", N_VAR)):
        group = g[slot]
        order = list(group.attrs["column-order"])
        for j, name in enumerate(NAMES):
            if name == STRING_COLUMN:
                arr = group.create_array(name, shape=(n,), dtype=g["var"]["gene_name"].dtype)
                arr[:] = np.array([f"S{i % 3}" for i in range(n)], dtype=object)
                arr.attrs.update({"encoding-type": "string-array", "encoding-version": "0.2.0"})
            else:
                arr = group.create_array(name, shape=(n,), dtype="float64")
                arr[:] = [_number(i, j) for i in range(n)]
                arr.attrs.update({"encoding-type": "array", "encoding-version": "0.2.0"})
            order.append(name)
        group.attrs["column-order"] = order
    zarr.consolidate_metadata(str(path))


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    data = tmp_path_factory.mktemp("data")
    _store(data / "odd.zarr")
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
    yield root, str(data / "odd.zarr")
    proc.terminate()
    proc.wait(10)


def _config(kind, names=NAMES, **extra):
    if kind == "plot":      # a page with a plot only: the panel set is loaded into it
        return "cell-plot-D", {"id": "cell-plot-D", "title": "plot",
                               "x": {"type": "obsm", "key": "X_umap", "column": "0"},
                               "y": {"type": "obsm", "key": "X_umap", "column": "1"}}
    tile, slot = TILES[kind]
    cfg = {"id": tile, "title": kind, "columns": [{"type": slot, "key": n, "column": ""} for n in names]}
    cfg.update(extra)
    return tile, cfg


def _link(root, store, kind, **extra):
    tile, cfg = _config(kind, **extra)
    view = {"v": 1, "constants": {}, "layout": {"v": 1, "hierarchy": [
        {"type": "tile", "id": tile, "controlsVisible": False}],
        "controlState": {tile: False}, "panelConfigs": {tile: cfg}}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}"


def _table_js(tile):
    return f"jQuery(document.querySelector('.tile[data-tile-id=\"{tile}\"] table[id^=DataTables_Table]')).DataTable()"


def _open(pw, root, store, kind, **extra):
    browser = pw.chromium.launch(args=["--allow-file-access-from-files"])
    context = browser.new_context(viewport={"width": 1600, "height": 1000}, accept_downloads=True)
    page = context.new_page()
    problems = []
    page.on("pageerror", lambda e: problems.append(str(e)))
    page.on("dialog", lambda d: (problems.append("dialog: " + d.message), d.dismiss()))
    page.on("console", lambda m: problems.append(m.text) if "DataTables warning" in m.text else None)
    page.goto(_link(root, store, kind, **extra))
    _wait_rows(page, TILES[kind][0])
    return browser, page, problems


def _wait_rows(page, tile, n=None, timeout=60):
    end = time.time() + timeout
    last = None
    while time.time() < end:
        last = page.evaluate(f"""() => {{
            const t = document.querySelector('.tile[data-tile-id="{tile}"] table[id^=DataTables_Table]');
            if (!t || !jQuery.fn.DataTable.isDataTable(t)) return null;
            return jQuery(t).DataTable().rows().count();
        }}""")
        if last and (n is None or last == n):
            page.wait_for_timeout(400)
            return
        page.wait_for_timeout(200)
    pytest.fail(f"table {tile} never had its rows: {last}")


def _titles(page, tile):
    return page.evaluate(f"{_table_js(tile)}.columns().header().toArray().map(h => h.textContent.trim())")


def _at(page, tile):
    """{name: column index} as the table has them (it orders them itself)."""
    return {t: i for i, t in enumerate(_titles(page, tile))}


def _body_row(page, tile, index=0):
    return page.evaluate(f"""() => {{
        const rows = document.querySelectorAll('.tile[data-tile-id="{tile}"] .dataTables_scrollBody tbody tr');
        return [...rows[{index}].children].map(td => td.textContent.trim());
    }}""")


def _shown(value):
    return f"{value:g}"


def _first_row_by_name():
    return {n: (_shown(_number(0, j)) if n != STRING_COLUMN else "S0") for j, n in enumerate(NAMES)}


def _row_by_name(page, tile, index=0):
    at = _at(page, tile)
    row = _body_row(page, tile, index)
    return {n: row[at[n]] for n in NAMES}


@pytest.mark.parametrize("kind", ["cells", "genes"])
def test_every_odd_name_renders_its_values(server, kind):
    root, store = server
    tile, _ = TILES[kind]
    with playwright.sync_playwright() as pw:
        browser, page, problems = _open(pw, root, store, kind)
        try:
            assert sorted(_titles(page, tile)[1:]) == sorted(NAMES)
            page.evaluate(f"{_table_js(tile)}.order([0, 'asc']).draw()")
            assert _row_by_name(page, tile) == _first_row_by_name()
            assert not problems, problems
        finally:
            browser.close()


@pytest.mark.parametrize("kind", ["cells", "genes"])
def test_sorting_by_each_odd_name(server, kind):
    root, store = server
    tile, _ = TILES[kind]
    n = N_OBS if kind == "cells" else N_VAR
    with playwright.sync_playwright() as pw:
        browser, page, problems = _open(pw, root, store, kind)
        try:
            for j, name in enumerate(NAMES):
                if name == STRING_COLUMN:
                    continue
                page.evaluate(f"{_table_js(tile)}.order([{_at(page, tile)[name]}, 'desc']).draw()")
                top = _row_by_name(page, tile)[name]
                assert top == _shown(_number(n - 1, j)), (name, top)
            assert not problems, problems
        finally:
            browser.close()


@pytest.mark.parametrize("kind", ["cells", "genes"])
def test_text_search_finds_values_of_the_odd_columns(server, kind):
    root, store = server
    tile, _ = TILES[kind]
    n = N_OBS if kind == "cells" else N_VAR
    with playwright.sync_playwright() as pw:
        browser, page, problems = _open(pw, root, store, kind)
        try:
            table = _table_js(tile)
            # the string column: S1 is on every third row
            page.evaluate(f"{table}.search('S1').draw()")
            assert page.evaluate(f"{table}.rows({{search: 'applied'}}).count()") == len([i for i in range(n) if i % 3 == 1])
            # a number only the last row of a named column has
            page.evaluate(f"{table}.search('').draw()")
            j = NAMES.index("x.y.z")
            page.evaluate(f"{table}.column({_at(page, tile)['x.y.z']}).search('^{_shown(_number(n - 1, j))}$', true, false).draw()")
            assert page.evaluate(f"{table}.rows({{search: 'applied'}}).count()") == 1
            assert not problems, problems
        finally:
            browser.close()


@pytest.mark.parametrize("kind", ["cells", "genes"])
def test_a_search_builder_condition_on_an_odd_name(server, kind):
    root, store = server
    tile, _ = TILES[kind]
    n = N_OBS if kind == "cells" else N_VAR
    with playwright.sync_playwright() as pw:
        browser, page, problems = _open(pw, root, store, kind)
        try:
            for name in ("orig.ident", "a[0]", "f(x)", "x.y.z"):
                page.evaluate(f"{_table_js(tile)}.searchBuilder.rebuild()")
                base = f'.tile[data-tile-id="{tile}"] '
                page.click(base + ".dtsb-add")
                page.select_option(base + "select.dtsb-data", label=name)
                if name == "orig.ident":
                    page.select_option(base + "select.dtsb-condition", value="=")
                    page.wait_for_selector(base + "select.dtsb-value", state="visible")
                    page.select_option(base + "select.dtsb-value", label="S2")
                    want = len([i for i in range(n) if i % 3 == 2])
                else:
                    page.select_option(base + "select.dtsb-condition", value=">")
                    page.wait_for_selector(base + "input.dtsb-value", state="visible")
                    j = NAMES.index(name)
                    page.fill(base + "input.dtsb-value", str(_number(n - 2, j)))
                    want = 1
                page.wait_for_timeout(800)
                assert page.evaluate(f"{_table_js(tile)}.rows({{search: 'applied'}}).count()") == want, name
            assert not problems, problems
        finally:
            browser.close()


@pytest.mark.parametrize("kind", ["cells", "genes"])
def test_hiding_and_showing_an_odd_column(server, kind):
    root, store = server
    tile, _ = TILES[kind]
    with playwright.sync_playwright() as pw:
        browser, page, problems = _open(pw, root, store, kind)
        try:
            table = _table_js(tile)
            at = _at(page, tile)
            for name in NAMES:
                page.evaluate(f"{table}.column({at[name]}).visible(false)")
                assert name not in _titles_visible(page, tile), name
                page.evaluate(f"{table}.column({at[name]}).visible(true)")
                assert name in _titles_visible(page, tile), name
            page.evaluate(f"{table}.order([0, 'asc']).draw()")
            assert _row_by_name(page, tile) == _first_row_by_name()
            assert not problems, problems
        finally:
            browser.close()


def _titles_visible(page, tile):
    return page.evaluate(f"""() => [...document.querySelectorAll('.tile[data-tile-id="{tile}"] .dataTables_scrollHead th')]
        .map(h => h.textContent.trim())""")


@pytest.mark.parametrize("kind", ["cells", "genes"])
def test_csv_export_has_the_odd_columns(server, kind):
    root, store = server
    tile, _ = TILES[kind]
    n = N_OBS if kind == "cells" else N_VAR
    with playwright.sync_playwright() as pw:
        browser, page, problems = _open(pw, root, store, kind)
        try:
            page.evaluate(f"{_table_js(tile)}.order([0, 'asc']).draw()")
            with page.expect_download(timeout=30000) as info:
                page.evaluate(f"{_table_js(tile)}.button('.buttons-csv').trigger()")
            with open(info.value.path(), encoding="utf-8") as fh:
                rows = list(csv.reader(io.StringIO(fh.read())))
            assert sorted(rows[0][1:]) == sorted(NAMES), rows[0]
            assert len(rows) == n + 1
            by_name = dict(zip(rows[0], rows[1]))
            assert {k: by_name[k] for k in NAMES} == _first_row_by_name(), rows[1]
            assert not problems, problems
        finally:
            browser.close()


@pytest.mark.parametrize("kind", ["cells", "genes"])
def test_a_saved_panel_set_comes_back_with_the_odd_columns(server, kind):
    root, store = server
    tile, _ = TILES[kind]
    name = f"odd_{kind}"
    with playwright.sync_playwright() as pw:
        browser, page, problems = _open(pw, root, store, kind)
        try:
            saved = page.evaluate("""async (name) => {
                const { SessionManager } = await import('./static/js/session-manager.js');
                return SessionManager.saveSession(name);
            }""", name)
            assert saved["status"] == "success", saved
        finally:
            browser.close()
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 1600, "height": 1000})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if "DataTables warning" in m.text else None)
        try:
            page.goto(_link(root, store, "plot"))
            page.wait_for_selector(".tile .js-plotly-plot", timeout=60000)
            page.wait_for_timeout(1500)
            loaded = page.evaluate("""async (name) => {
                const { SessionManager } = await import('./static/js/session-manager.js');
                return SessionManager.loadSession(name);
            }""", name)
            assert loaded["status"] == "success", loaded
            _wait_rows(page, tile)
            assert sorted(_titles(page, tile)[1:]) == sorted(NAMES)
            page.evaluate(f"{_table_js(tile)}.order([0, 'asc']).draw()")
            assert _row_by_name(page, tile) == _first_row_by_name()
            assert not errors, errors
        finally:
            browser.close()


@pytest.mark.parametrize("x,y", [("a,b", "50%"), ("orig.ident", "x.y.z"), ("a[0]", "f(x)")])
def test_a_plot_can_draw_odd_column_names_on_its_axes(server, x, y):
    """The axes read obs columns through the same /data/obs parameter as the tables."""
    root, store = server
    view = {"v": 1, "constants": {}, "layout": {"v": 1, "hierarchy": [
        {"type": "tile", "id": "cell-plot-D", "controlsVisible": False}],
        "controlState": {"cell-plot-D": False}, "panelConfigs": {"cell-plot-D": {
            "id": "cell-plot-D", "title": "p", "z": None, "color": {"type": "none"},
            "x": {"type": "obs", "key": x, "column": ""}, "y": {"type": "obs", "key": y, "column": ""}}}}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1200, "height": 900})
            failures = []
            page.on("response", lambda r: failures.append((r.status, r.url)) if r.status >= 400 else None)
            page.goto(f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}")
            page.wait_for_selector('.tile[data-tile-id="cell-plot-D"] .js-plotly-plot', timeout=60000)
            page.wait_for_timeout(2500)
            drawn = page.evaluate("""() => {
                const gd = document.querySelector('.tile[data-tile-id="cell-plot-D"] .js-plotly-plot');
                const ts = gd.data.filter(t => t.x && t.x.length && t.hoverinfo !== 'skip');
                return ts.length ? [ts.reduce((n, t) => n + t.x.length, 0), typeof ts[0].x[0], typeof ts[0].y[0]] : null;
            }""")
            assert drawn and drawn[0] == N_OBS, drawn
            assert not failures, failures
        finally:
            browser.close()
