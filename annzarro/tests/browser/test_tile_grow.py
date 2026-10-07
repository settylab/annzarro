"""A panel body never scrolls: its tile grows, and the page scrolls instead.

``.tile-content`` once scrolled inside whenever a panel's controls plus content
exceeded the tile (narrow or short panels, where controls wrap). Now a panel
row (``.panel-wrapper``) is at least as tall as the layout gives it
(``--panel-height``) and grows with its content; side-by-side tiles stretch to
the row's height; a plot fills what the tile leaves after its controls and does
not feed back into the tile's height. Table rows, Plotly legends, the gene-set
sections and multi-select lists keep their own scrollers.

One headless Chromium session per case, on the committed 200-cell fixture:
plot, table and gene-set panels at several window widths, a row of two plots
and one of a plot and a table, and a vertical split. Checks:

* ``.tile-content`` has scrollHeight <= clientHeight + 1 (no inner scrollbar);
* tiles in a split share a height (+- 2 px) and the row's height;
* a plot stays inside its tile, and its size is the same a second later (no
  ResizeObserver growth loop);
* a row is never shorter than its saved height;
* the gene-set sections and the table body still scroll inside, and dragging
  the row's handle still sets the height.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import base64
import json
import os
import urllib.parse

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_memory_guard import STORE, _serve  # noqa: E402

SHOTS = os.environ.get("TILE_GROW_SHOTS")

X = {"type": "obsm", "key": "X_umap", "column": "0"}
Y = {"type": "obsm", "key": "X_umap", "column": "1"}
CELL_TYPE = {"type": "obs", "key": "cell_type", "column": ""}
Z = {"type": "obs", "key": "total_counts", "column": ""}


def _plot(pid, z=None):
    return {"id": pid, "title": pid, "x": X, "y": Y, "z": z, "color": CELL_TYPE}


CFG = {
    "cell-plot-P": _plot("cell-plot-P"),
    "cell-plot-Q": _plot("cell-plot-Q"),
    "cell-plot-3": _plot("cell-plot-3", Z),
    "cell-table-T": {"id": "cell-table-T", "title": "Table",
                     "columns": [{"type": "obs", "key": "cell_type", "column": ""},
                                 {"type": "obs", "key": "total_counts", "column": ""}]},
    "gene-table-A": {"id": "gene-table-A", "title": "Gene Table 1", "searchText": "GENE00",
                     "columns": [{"type": "var", "key": "gene_name", "column": ""}]},
    "gene-set-G": {"id": "gene-set-G", "title": "Gene Set Analysis 1", "tableFilter": "gene-table-A"},
}


def tile(i):
    return {"type": "tile", "id": i, "controlsVisible": True}


def split(direction, a, b, height=None, pa=50):
    node = {"type": "split", "direction": direction, "panes": [{"percentage": pa}, {"percentage": 100 - pa}],
            "children": [a, b]}
    if height:
        node["height"] = height
    return node


def link(root, hierarchy):
    ids = set()

    def walk(n):
        if n["type"] == "tile":
            ids.add(n["id"])
        for c in n.get("children", []):
            walk(c)
    for n in hierarchy:
        walk(n)
    view = {"v": 1, "constants": {"focusedGene": "GENE003", "taxonomyId": "9606"},
            "layout": {"v": 1, "hierarchy": hierarchy, "controlState": {i: True for i in ids},
                       "panelConfigs": {i: CFG[i] for i in ids}}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={enc}"


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    root, proc = _serve(tmp_path_factory)
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


MEASURE = """() => {
  const r = e => e.getBoundingClientRect();
  const out = {contents: [], rows: [], plots: [], wrappers: []};
  for (const c of document.querySelectorAll('.tile-content')) {
    out.contents.push({tile: c.closest('.tile').dataset.tileId, sh: c.scrollHeight, ch: c.clientHeight,
                       ov: getComputedStyle(c).overflowY});
  }
  for (const w of document.querySelectorAll('.tile-container > .panel-wrapper')) {
    out.wrappers.push({h: r(w).height, min: parseFloat(w.style.getPropertyValue('--panel-height'))});
  }
  for (const s of document.querySelectorAll('.split-container')) {
    const panes = [...s.children].filter(c => c.classList.contains('split-pane'));
    const tiles = panes.map(p => p.querySelector(':scope > .tile, :scope > .split-container, :scope > .tile-selector'));
    out.rows.push({dir: s.dataset.splitDirection, split: r(s).height,
                   panes: panes.map(p => r(p).height), tiles: tiles.map(t => t ? r(t).height : null)});
  }
  for (const t of document.querySelectorAll('.tile[data-tile-id]')) {
    const g = t.querySelector('.plot-panel > .plot-container');
    if (!g) continue;
    out.plots.push({tile: t.dataset.tileId, plotH: r(g).height, plotW: r(g).width, plotTop: r(g).top,
                    plotBottom: r(g).bottom, tileBottom: r(t).bottom, tileRight: r(t).right, plotRight: r(g).right,
                    tileH: r(t).height, drawn: !!(g._fullLayout), fullH: g._fullLayout ? g._fullLayout.height : null});
  }
  return out;
}"""


def settle(page, ready_js, timeout=40):
    page.wait_for_function(ready_js, timeout=timeout * 1000)
    page.wait_for_timeout(1500)


def measure(page):
    m = page.evaluate(MEASURE)
    page.wait_for_timeout(1200)
    m2 = page.evaluate(MEASURE)
    return m, m2


PLOTS_READY = "() => { const g = [...document.querySelectorAll('.plot-panel > .plot-container')]; return g.length > 0 && g.every(e => e._fullLayout && e.querySelector('.main-svg, .gl-container')); }"
TABLE_READY = "() => !!document.querySelector('.tile[data-tile-id=\"cell-table-T\"] .dataTables_scrollBody tbody tr')"
GENESET_READY = "() => !!document.querySelector('.tile[data-tile-id=\"gene-table-A\"] .dataTables_scrollBody tbody tr') && !!document.querySelector('.gs-panel')"


def shot(page, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        # the page scrolls inside .tile-container: the window shot is what a user sees first,
        # the full shot is the same page in a window tall enough for every row
        page.evaluate("() => { const c = document.querySelector('.tile-container'); if (c) c.scrollTop = 0; }")
        page.screenshot(path=os.path.join(SHOTS, name + "-window.png"), full_page=False)
        vp = page.viewport_size
        extra = page.evaluate("() => { const c = document.querySelector('.tile-container'); return c.scrollHeight - c.clientHeight; }")
        if extra > 0:
            page.set_viewport_size({"width": vp["width"], "height": vp["height"] + extra})
            page.wait_for_timeout(600)
        page.screenshot(path=os.path.join(SHOTS, name + ".png"), full_page=False)
        if extra > 0:
            page.set_viewport_size(vp)
            page.wait_for_timeout(600)


def check(m, m2, saved=None):
    for c in m2["contents"]:
        assert c["sh"] <= c["ch"] + 1, f".tile-content scrolls: {c}"
        assert c["ov"] != "auto" and c["ov"] != "scroll", c
    for r in m2["rows"]:
        for h in r["tiles"]:
            if h is not None:
                if r["dir"] == "horizontal":
                    assert abs(h - r["split"]) <= 2, f"tile not as tall as its row: {r}"
                    assert max(r["tiles"]) - min(r["tiles"]) <= 2, f"neighbours differ: {r}"
    for p in m2["plots"]:
        assert p["plotBottom"] <= p["tileBottom"] + 1 and p["plotRight"] <= p["tileRight"] + 1, f"plot outside tile: {p}"
        assert p["plotH"] >= 250, f"plot too small: {p}"
    for a, b in zip(m["plots"], m2["plots"]):
        assert abs(a["plotH"] - b["plotH"]) <= 1 and abs(a["tileH"] - b["tileH"]) <= 1, f"size still changing: {a} {b}"
    if saved:
        for w, s in zip(m2["wrappers"], saved):
            assert w["h"] >= s - 1, f"row shorter than its saved height: {w} {s}"


@pytest.fixture
def mkpage(browser, server):
    pages = []

    def make(width, height=900):
        ctx = browser.new_context(viewport={"width": width, "height": height})
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        pages.append((ctx, errors))
        return page
    yield make
    for ctx, errors in pages:
        ctx.close()
        assert not errors, errors


@pytest.mark.parametrize("width", [360, 520, 800, 1400])
def test_a_plot_panel_grows_with_wrapped_controls_and_never_scrolls(server, mkpage, width):
    page = mkpage(width)
    page.goto(link(server, [dict(tile("cell-plot-P"), height=420)]))
    settle(page, PLOTS_READY)
    m, m2 = measure(page)
    check(m, m2, saved=[420])
    shot(page, f"plot-narrow-{width}")
    if width <= 520:
        # the controls wrap, so the row is taller than its layout height
        assert m2["wrappers"][0]["h"] > 420, m2["wrappers"]
        # the page scrolls instead
        assert page.evaluate("() => { const c = document.querySelector('.tile-container'); return c.scrollHeight > c.clientHeight + 1 || document.documentElement.scrollHeight > innerHeight; }")


def test_a_short_panel_keeps_its_room_and_a_plot_is_drawable(server, mkpage):
    page = mkpage(900, 700)
    page.goto(link(server, [dict(tile("cell-plot-P"), height=150)]))
    settle(page, PLOTS_READY)
    m, m2 = measure(page)
    check(m, m2)
    shot(page, "plot-short")
    assert m2["plots"][0]["plotH"] >= 260


def test_a_row_of_two_plots_is_one_height_when_one_grows(server, mkpage):
    page = mkpage(1000)
    page.goto(link(server, [split("horizontal", tile("cell-plot-P"), tile("cell-plot-Q"), height=420, pa=20)]))
    settle(page, PLOTS_READY)
    m, m2 = measure(page)
    check(m, m2, saved=[420])
    shot(page, "row-two-plots")
    r = m2["rows"][0]
    assert r["tiles"][0] > 0 and abs(r["tiles"][0] - r["tiles"][1]) <= 2, r
    assert r["tiles"][0] > 420, f"the narrow pane's wrapped controls should have grown the row: {r}"


def test_plot_next_to_a_table_and_a_vertical_split_nest(server, mkpage):
    page = mkpage(1100)
    h = [split("horizontal", split("vertical", tile("cell-plot-P"), tile("cell-plot-Q"), pa=50), tile("cell-table-T"), height=900, pa=30)]
    page.goto(link(server, h))
    settle(page, PLOTS_READY)
    page.wait_for_selector('.tile[data-tile-id="cell-table-T"] .dataTables_scrollBody tbody tr', timeout=30000)
    m, m2 = measure(page)
    check(m, m2, saved=[900])
    shot(page, "nested")
    outer = [r for r in m2["rows"] if r["dir"] == "horizontal"][0]
    assert abs(outer["tiles"][1] - outer["split"]) <= 2, outer


@pytest.mark.parametrize("width", [420, 800, 1300])
def test_a_table_panel_never_scrolls_inside_but_its_body_does(server, mkpage, width):
    page = mkpage(width)
    page.goto(link(server, [dict(tile("cell-table-T"), height=500)]))
    settle(page, TABLE_READY)
    m, m2 = measure(page)
    check(m, m2, saved=[500])
    shot(page, f"table-{width}")
    body = page.evaluate("""() => { const b = document.querySelector('.tile[data-tile-id="cell-table-T"] .dataTables_scrollBody');
        return {sh: b.scrollHeight, ch: b.clientHeight, ov: getComputedStyle(b).overflowY}; }""")
    assert body["ov"] in ("auto", "scroll"), body
    assert body["ch"] >= 100, body
    print("TABLE BODY", width, body)
    # the pager is inside the tile
    inside = page.evaluate("""() => { const t = document.querySelector('.tile[data-tile-id="cell-table-T"]');
        const p = t.querySelector('.dataTables_paginate, .dataTables_info'); return !p || p.getBoundingClientRect().bottom <= t.getBoundingClientRect().bottom + 1; }""")
    assert inside


@pytest.mark.parametrize("width", [520, 900, 1400])
def test_a_gene_set_panel_never_scrolls_inside_but_its_sections_do(server, mkpage, width):
    page = mkpage(width)
    h = [split("horizontal", tile("gene-table-A"), tile("gene-set-G"), height=600, pa=40)]
    page.goto(link(server, h))
    settle(page, GENESET_READY)
    m, m2 = measure(page)
    check(m, m2, saved=[600])
    shot(page, f"geneset-{width}")
    s = page.evaluate("""() => { const s = document.querySelector('.gs-sections');
        return s ? {ov: getComputedStyle(s).overflowY, ch: s.clientHeight} : null; }""")
    assert s and s["ov"] == "auto" and s["ch"] >= 150, s
    # the panel fills its (stretched) tile: the sections take the room under the controls
    gap = page.evaluate("""() => { const t = document.querySelector('.tile[data-tile-id="gene-set-G"]');
        return t.getBoundingClientRect().bottom - t.querySelector('.gs-sections').getBoundingClientRect().bottom; }""")
    assert gap <= 40, gap


def test_a_3d_plot_fills_its_tile_without_growing(server, mkpage):
    page = mkpage(900)
    page.goto(link(server, [dict(tile("cell-plot-3"), height=600)]))
    settle(page, "() => { const g = document.querySelector('.plot-panel > .plot-container'); return g && g._fullLayout && g._fullLayout.scene && g.querySelector('.gl-container'); }")
    m, m2 = measure(page)
    check(m, m2, saved=[600])
    shot(page, "plot-3d")


def test_dragging_the_row_handle_and_a_split_handle_still_resize(server, mkpage):
    page = mkpage(1300)
    page.goto(link(server, [split("horizontal", tile("cell-plot-P"), tile("cell-plot-Q"), height=600, pa=50)]))
    settle(page, PLOTS_READY)
    before = page.evaluate(MEASURE)
    # split handle: 200 px to the right
    hb = page.locator(".split-container > .split-handle").first.bounding_box()
    page.mouse.move(hb["x"] + hb["width"] / 2, hb["y"] + 100)
    page.mouse.down()
    page.mouse.move(hb["x"] + 250, hb["y"] + 100, steps=8)
    page.mouse.up()
    page.wait_for_timeout(1500)
    widths = page.evaluate("() => [...document.querySelectorAll('.split-pane')].map(p => p.getBoundingClientRect().width)")
    assert widths[0] > widths[1] + 100, widths
    shot(page, "split-dragged")
    # row handle: 150 px down
    hb = page.locator(".tile-container > .split-handle.horizontal").first.bounding_box()
    h0 = page.evaluate(MEASURE)["wrappers"][0]["h"]
    page.mouse.move(hb["x"] + hb["width"] / 2, hb["y"] + 2)
    page.mouse.down()
    page.mouse.move(hb["x"] + hb["width"] / 2, hb["y"] + 152, steps=8)
    page.mouse.up()
    page.wait_for_timeout(1500)
    after = page.evaluate(MEASURE)
    assert abs(after["wrappers"][0]["h"] - (h0 + 150)) <= 3, (h0, after["wrappers"])
    assert after["wrappers"][0]["min"] >= h0 + 147
    m, m2 = measure(page)
    check(m, m2)
    shot(page, "row-dragged")
    # dragging back up below the content shrinks to the content, not past it
    hb = page.locator(".tile-container > .split-handle.horizontal").first.bounding_box()
    page.mouse.move(hb["x"] + 100, hb["y"] + 2)
    page.mouse.down()
    page.mouse.move(hb["x"] + 100, hb["y"] - 400, steps=8)
    page.mouse.up()
    page.wait_for_timeout(1500)
    m, m2 = measure(page)
    check(m, m2)
