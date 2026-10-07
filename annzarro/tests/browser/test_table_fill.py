"""A table panel's scroll body fills the panel; the pager stays at its bottom.

v0.4.1 operator report: a table showed 25 entries per page in a body fixed at
350 px (about ten rows). The rest sat out of reach once the pager was beyond
the last entry, and a tall panel showed empty space between rows and pager.
Now the header, the body (flexing to fill) and the info/pager row stack to the
panel's height.

Checked in a cell and a gene table, with real bounding boxes:
- a panel tall enough for the page: every row shows, no inner scrollbar, the
  pager's bottom is at the panel's content bottom, and no band above the pager;
- a short panel: the body scrolls, the last row can be reached, the pager stays
  visible at the bottom;
- a narrow panel: the same, and the header columns line up with the body's;
- the layout split moved: the body follows the new height;
- the wheel at the body's end hands over to the page.

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
CELLS, GENES = "cell-table-C", "gene-table-G"


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


def _link(root, store, percentages=(50, 50), direction="horizontal", height=None):
    configs = {
        CELLS: {"id": CELLS, "title": "cells",
                "columns": [{"type": "obs", "key": "cell_type", "column": ""},
                            {"type": "obs", "key": "total_counts", "column": ""}]},
        GENES: {"id": GENES, "title": "genes",
                "columns": [{"type": "var", "key": "gene_name", "column": ""}]},
    }
    tiles = [{"type": "tile", "id": tid, "controlsVisible": False} for tid in configs]
    hierarchy = [{"type": "split", "direction": direction,
                  "panes": [{"percentage": p} for p in percentages], "children": tiles}]
    if height:
        hierarchy[0]["height"] = height
    view = {"v": 1, "layout": {"v": 1, "hierarchy": hierarchy,
                               "controlState": {t["id"]: False for t in tiles}, "panelConfigs": configs}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={store}#view={enc}"


GEOM = """(tid) => {
  const t = document.querySelector(`.tile[data-tile-id="${tid}"]`);
  const box = e => { const b = e.getBoundingClientRect(); return {l: b.left, t: b.top, r: b.right, b: b.bottom}; };
  const body = t.querySelector('.dataTables_scrollBody');
  const pager = t.querySelector('.dataTables_paginate').closest('.row');
  const rows = [...body.querySelectorAll('tbody tr')];
  const last = rows[rows.length - 1].getBoundingClientRect();
  const bodyBox = body.getBoundingClientRect();
  const cont = t.querySelector('.table-container');
  const headBox = t.querySelector('.dataTables_scrollHead th').getBoundingClientRect();
  const ths = [...t.querySelectorAll('.dataTables_scrollHead th')].map(e => e.getBoundingClientRect());
  const tds = [...body.querySelectorAll('tbody tr:first-child td')].map(e => e.getBoundingClientRect());
  return { body: box(body), pager: box(pager), cont: box(cont), tile: box(t), nrows: rows.length,
           lastB: last.bottom, lastT: last.top, bodyScrolls: body.scrollHeight - body.clientHeight > 1,
           scrollTop: body.scrollTop, maxTop: body.scrollHeight - body.clientHeight,
           headL: ths.map(r => [r.left, r.width]), bodyL: tds.map(r => [r.left, r.width]),
           headScroll: headBox.height, headB: headBox.bottom,
           firstT: body.querySelector('tbody tr:first-child td').getBoundingClientRect().top,
           headBox: t.querySelector('.dataTables_scrollHead').getBoundingClientRect().bottom };
}"""


def _open(page, root, store, **kw):
    page.goto(_link(root, store, **kw))
    for tid in (CELLS, GENES):
        page.wait_for_selector(f'.tile[data-tile-id="{tid}"] .dataTables_scrollBody tbody tr', timeout=60000)
    page.wait_for_timeout(400)


def _shot(page, name):
    d = os.environ.get("AZ_SHOT_DIR")
    if d:
        os.makedirs(d, exist_ok=True)
        page.screenshot(path=os.path.join(d, name + ".png"), full_page=True)


def _aligned(g):
    assert len(g["headL"]) == len(g["bodyL"]) > 0, g
    for (hl, hw), (bl, bw) in zip(g["headL"], g["bodyL"]):
        assert abs(hl - bl) <= 2 and abs(hw - bw) <= 2, ("header over body columns", g)


def _no_band_under_header(g):
    assert g["firstT"] - g["headB"] < 4 and g["firstT"] - g["headBox"] < 4, ("blank band between the header and the first row", g)


def _pager_at_bottom(g):
    assert g["pager"]["b"] <= g["cont"]["b"] + 1, ("pager below the panel content", g)
    assert g["cont"]["b"] - g["pager"]["b"] <= 8, ("pager not at the panel bottom", g)
    assert g["pager"]["t"] >= g["body"]["b"] - 1, ("pager overlaps the body", g)


@pytest.mark.parametrize("tid", [CELLS, GENES], ids=["cells", "genes"])
def test_tall_panel_shows_all_rows_pager_at_bottom(server, tid):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 1400, "height": 2000})
        try:
            _open(page, root, store, height=1500)
            g = page.evaluate(GEOM, tid)
            assert g["nrows"] == (25 if tid == CELLS else 20), g
            assert not g["bodyScrolls"], ("a panel that fits its page scrolls inside", g)
            assert g["lastB"] <= g["body"]["b"] + 1, g
            _pager_at_bottom(g)
            _aligned(g)
            _no_band_under_header(g)
            _shot(page, f"tall_{tid}")
            # the body fills the space: no band between the last row and the pager
            # when the panel is just tall enough. Make it so by sizing the tile.
            need = g["lastB"] - g["tile"]["t"] + (g["pager"]["b"] - g["body"]["b"]) + 2
            page.evaluate("h => { document.querySelector('.panel-wrapper').style.setProperty('--panel-height', h + 'px'); }", int(need))
            page.wait_for_timeout(500)
            g = page.evaluate(GEOM, tid)
            assert not g["bodyScrolls"], g
            assert g["pager"]["t"] - g["lastB"] <= 16, ("band between last row and pager", g)
            _pager_at_bottom(g)
        finally:
            browser.close()


@pytest.mark.parametrize("tid", [CELLS, GENES], ids=["cells", "genes"])
@pytest.mark.parametrize("width", [1400, 520], ids=["wide", "narrow"])
def test_short_panel_scrolls_body_last_row_reachable(server, tid, width):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": width, "height": 1000})
        try:
            _open(page, root, store, height=700)
            g = page.evaluate(GEOM, tid)
            assert g["bodyScrolls"], g
            assert g["body"]["b"] - g["body"]["t"] >= 150, ("a small panel keeps about five rows", g)
            _pager_at_bottom(g)
            assert g["pager"]["b"] <= g["tile"]["b"] + 1, ("pager out of the tile", g)
            _aligned(g)
            _no_band_under_header(g)
            _shot(page, f"short_{width}_{tid}")
            sel = f'.tile[data-tile-id="{tid}"] .dataTables_scrollBody'
            page.eval_on_selector(sel, "e => { e.scrollTop = e.scrollHeight; }")
            g = page.evaluate(GEOM, tid)
            assert g["lastB"] <= g["body"]["b"] + 1 and g["lastT"] >= g["body"]["t"], ("last row unreachable", g)
            _pager_at_bottom(g)
            _aligned(g)
            _shot(page, f"short_{width}_{tid}_end")
        finally:
            browser.close()


def test_body_follows_the_layout_split(server):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 1400, "height": 2400})
        try:
            # the layout's height is the row's minimum: tall enough that 30 % of it holds a
            # table's controls, or the pane grows past its share (tile-grow)
            _open(page, root, store, percentages=(30, 70), direction="vertical", height=2200)
            small, big = page.evaluate(GEOM, CELLS), page.evaluate(GEOM, GENES)
            hb = lambda g: g["body"]["b"] - g["body"]["t"]
            assert hb(small) < hb(big), (small, big)
            # drag the gutter: the upper table's body takes the new height
            gutter = page.query_selector(".split-container .split-handle:not([data-panel-handle])")
            if gutter is None:
                pytest.skip("no gutter to drag")
            b = gutter.bounding_box()
            page.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
            page.mouse.down()
            page.mouse.move(b["x"] + b["width"] / 2, b["y"] + 350, steps=8)
            page.mouse.up()
            page.wait_for_timeout(600)
            moved = page.evaluate(GEOM, CELLS)
            assert hb(moved) > hb(small) + 100, (small, moved)
            _pager_at_bottom(moved)
            _aligned(moved)
            _shot(page, "resized_split")
        finally:
            browser.close()


def test_wheel_at_body_end_goes_to_the_page(server):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 1400, "height": 700})
        try:
            _open(page, root, store, percentages=(50, 50), direction="horizontal")
            sel = f'.tile[data-tile-id="{CELLS}"] .dataTables_scrollBody'
            page.eval_on_selector(sel, "e => { e.scrollTop = e.scrollHeight; }")
            page_scroller = page.evaluate("""() => { const c = document.getElementById('tile-container');
                return c ? c.scrollHeight - c.clientHeight : -1; }""")
            if page_scroller <= 1:
                pytest.skip("the page does not scroll at this size")
            b = page.query_selector(sel).bounding_box()
            page.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
            for _ in range(6):
                page.mouse.wheel(0, 100)
                page.wait_for_timeout(60)
            page.wait_for_timeout(500)
            top = page.evaluate("document.getElementById('tile-container').scrollTop")
            assert top > 50, ("the page did not take the wheel at the body's end", top)
        finally:
            browser.close()
