"""A legend in columns is one Plotly legend per column, side by side; the legend title's gap is in real pixels.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.

Columns. The fixture's `lineage` column has 14 categories with 40-character labels. In 2 and 3 columns
the legends (`g.legend`, `g.legend2`, ...) are read from the DOM: side by side, in order, none over
another, none past the graph's edge, the title once above the first, every entry whole where the room
allows, cut with an ellipsis where it does not. Hide and isolate work from any column, an export of two
columns holds both whole, and one column is the legend it always was.

Title. At a gap of 0, 1 and 10 px the whole title lies inside its legend box, and the space between the
title and the first entry grows by the pixels asked.
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

from annzarro.tests.browser.test_many_categories import DATA_DIR, N, _categorical, _free_port
from annzarro.tests.zarr_compat import open_group

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

LINEAGES = 14
LABELS = [f"Haematopoietic lineage {i:02d} progenitor" for i in range(LINEAGES)]    # 40 characters
TILE = '.tile[data-tile-id="cell-plot-M"] .js-plotly-plot'


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    home = tmp_path_factory.mktemp("home")
    data = tmp_path_factory.mktemp("data")
    store = str(data / "fixture_columns.zarr")
    shutil.copytree(os.path.join(DATA_DIR, "fixture_small.zarr"), store)
    obs = open_group(os.path.join(store, "obs"), mode="a")
    _categorical(obs, "lineage", np.arange(N) % LINEAGES, LABELS)
    zarr.consolidate_metadata(store)
    (home / "c.yaml").write_text("ui: {}\n")
    exe = shutil.which("annzarro", path=os.path.dirname(sys.executable)) or shutil.which("annzarro")
    if not exe:
        (pytest.fail if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1" else pytest.skip)("annzarro console script not found")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1")
    proc = subprocess.Popen([exe, "start", "--config", str(home / "c.yaml"), "--host", "127.0.0.1", "--port", str(port),
                             "--data-dir", str(data), "--no-browser", "--auth-disabled"],
                            env=env, cwd=home, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
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
def page():
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1500, "height": 1000})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            yield page
            assert not errors, errors
        finally:
            browser.close()


def _link(root, store, **extra):
    cfg = {"id": "cell-plot-M", "title": "umap", "z": None,
           "x": {"type": "obsm", "key": "X_umap", "column": "0"}, "y": {"type": "obsm", "key": "X_umap", "column": "1"},
           "color": {"type": "obs", "key": "lineage", "column": ""}, **extra}
    view = {"v": 1, "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": "cell-plot-M", "controlsVisible": True}],
                               "controlState": {"cell-plot-M": True}, "panelConfigs": {"cell-plot-M": cfg}}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={store}#view={enc}"


def _open(page, server, columns=None, **extra):
    root, store = server
    if columns:
        extra["legendColumns"] = columns
    page.goto(_link(root, store, **extra))
    page.wait_for_function("(sel) => { const g = document.querySelector(sel); return !!g && !!g._fullLayout && g.querySelectorAll('g.legend g.traces, g.legend2 g.traces, g.legend3 g.traces').length >= %d; }" % LINEAGES,
                           arg=TILE, timeout=60000)
    if columns and columns > 1:
        _settled(page, columns)
    page.wait_for_timeout(800)


SETTLED = """([sel, k]) => { const g = document.querySelector(sel); const fl = g._fullLayout;
    for (let i = 1; i <= k; i++) { const lg = fl[i === 1 ? 'legend' : 'legend' + i]; if (!lg || !(lg._width > 0)) return false; }
    return (g.layout.meta || {}).azColPlaced === true && !fl['legend' + (k + 1)]; }"""


def _settled(page, k):
    """The columns are placed: every legend drawn and the placement recorded; then let the last relayout end."""
    page.wait_for_function(SETTLED, arg=[TILE, k], timeout=30000)
    page.wait_for_timeout(1200)


READ = """(sel) => { const gd = document.querySelector(sel);
    const root = gd.getBoundingClientRect();
    const boxes = [...gd.querySelectorAll('g.legend, g.legend2, g.legend3, g.legend4')].map(g => {
        const bg = g.querySelector('rect.bg').getBoundingClientRect();
        const items = [...g.querySelectorAll('g.traces')].map(t => t.getBoundingClientRect());
        const title = g.querySelector('text[class$="titletext"]');
        const tb = title ? [...title.querySelectorAll('tspan')].filter(n => n.textContent.trim()).map(n => n.getBoundingClientRect()) : [];
        return { id: g.getAttribute('class'), left: bg.left - root.left, right: bg.right - root.left, top: bg.top - root.top, bottom: bg.bottom - root.top,
                 items: items.length, firstTop: items.length ? Math.min(...items.map(r => r.top)) - root.top : null,
                 itemRight: items.length ? Math.max(...items.map(r => r.right)) - root.left : null,
                 texts: [...g.querySelectorAll('g.traces text')].map(n => n.textContent),
                 title: title ? title.textContent.replace(/\\u00a0/g, '').trim() : '',
                 titleTop: tb.length ? Math.min(...tb.map(r => r.top)) - root.top : null,
                 titleBottom: tb.length ? Math.max(...tb.map(r => r.bottom)) - root.top : null };
    });
    const fl = gd._fullLayout;
    return { boxes, width: root.width, height: root.height, plot: { left: fl._size.l, right: fl._size.l + fl._size.w, top: fl._size.t, bottom: fl._size.t + fl._size.h },
             hasLegend2: !!gd.layout.legend2, xref: gd.layout.legend.xref ?? null }; }"""


def _read(page):
    return page.evaluate(READ, TILE)


@pytest.mark.parametrize("columns", [2, 3])
def test_long_labels_give_side_by_side_columns(page, server, columns):
    _open(page, server, columns)
    r = _read(page)
    per = -(-LINEAGES // columns)
    used = -(-LINEAGES // per)
    boxes = sorted(r["boxes"], key=lambda b: b["left"])
    assert len(boxes) == used, r
    assert [b["items"] for b in boxes] == [min(per, LINEAGES - per * i) for i in range(used)], boxes
    for a, b in zip(boxes, boxes[1:]):
        assert a["right"] <= b["left"] + 0.5, ("columns overlap or wrap", a, b)
        assert abs(a["top"] - b["top"]) < 1 and abs(a["firstTop"] - b["firstTop"]) < 1, ("columns not aligned", a, b)
    assert boxes[0]["left"] >= r["plot"]["right"] - 1, ("the legend lies over the plot", boxes[0], r["plot"])
    assert boxes[-1]["right"] <= r["width"] + 0.5, ("a column past the graph's edge", boxes[-1], r["width"])
    assert r["plot"]["right"] - r["plot"]["left"] >= 0.3 * r["width"], ("the plot is crushed", r["plot"])
    # the entries read in order, down each column
    texts = [t for b in boxes for t in b["texts"]]
    assert len(texts) == LINEAGES
    assert all(t == LABELS[i] or (t.endswith("…") and LABELS[i].startswith(t[:-1])) for i, t in enumerate(texts)), texts
    if columns == 2:
        assert texts == LABELS, "two columns of 40 characters fit the graph whole"
    # the title once, above the first column; the others blank
    assert [bool(b["title"]) for b in boxes] == [True] + [False] * (used - 1), [b["title"] for b in boxes]
    assert boxes[0]["titleBottom"] <= boxes[0]["firstTop"] + 4


def test_one_column_is_the_legend_it_always_was(page, server):
    _open(page, server)
    r = _read(page)
    assert len(r["boxes"]) == 1 and r["boxes"][0]["items"] == LINEAGES and not r["hasLegend2"], r
    # 3 columns and back leaves the single legend, the margin and the position it had
    root, store = server
    before = page.evaluate("(sel) => { const g = document.querySelector(sel); return { x: g.layout.legend.x, y: g.layout.legend.y, xa: g.layout.legend.xanchor, r: g._fullLayout._size.r }; }", TILE)
    page.evaluate("(sel) => Plotly.relayout(document.querySelector(sel), { 'meta.azLegendColumns': 3 })", TILE)
    _settled(page, 3)
    assert len(_read(page)["boxes"]) == 3
    page.evaluate("(sel) => Plotly.relayout(document.querySelector(sel), { 'meta.azLegendColumns': 1 })", TILE)
    page.wait_for_function("(sel) => !document.querySelector(sel).layout.legend2 && document.querySelector(sel).layout.meta.azColPlaced === false", arg=TILE, timeout=30000)
    page.wait_for_timeout(1000)
    after = page.evaluate("(sel) => { const g = document.querySelector(sel); return { x: g.layout.legend.x, y: g.layout.legend.y, xa: g.layout.legend.xanchor, r: g._fullLayout._size.r }; }", TILE)
    assert after == before, (before, after)
    r = _read(page)
    assert len(r["boxes"]) == 1 and r["boxes"][0]["items"] == LINEAGES


@pytest.mark.parametrize("position", ["bottom", "top", "left"])
def test_columns_at_every_position_stay_side_by_side_inside_the_graph(page, server, position):
    _open(page, server, 2, legendPosition=position)
    r = _read(page)
    boxes = sorted(r["boxes"], key=lambda b: b["left"])
    assert len(boxes) == 2, r
    assert boxes[0]["right"] <= boxes[1]["left"] + 0.5, boxes
    assert boxes[0]["left"] >= -0.5 and boxes[1]["right"] <= r["width"] + 0.5, (boxes, r["width"])
    plot = r["plot"]
    for b in boxes:
        if position == "bottom":
            assert b["top"] >= plot["bottom"] - 1 and b["bottom"] <= r["height"] + 0.5, (b, plot)
        elif position == "top":
            assert b["bottom"] <= plot["top"] + 1 and b["top"] >= -0.5, (b, plot)
        else:
            assert b["right"] <= plot["left"] + 1, (b, plot)


def test_the_column_gap_is_in_pixels(page, server):
    gaps = {}
    for gap in (0, 24, 60):
        _open(page, server, 2, legendColumnGap=gap)
        boxes = sorted(_read(page)["boxes"], key=lambda b: b["left"])
        gaps[gap] = boxes[1]["left"] - boxes[0]["right"]
    assert abs(gaps[0]) < 1.5 and abs(gaps[24] - 24) < 1.5 and abs(gaps[60] - 60) < 1.5, gaps


def _items(page):
    return page.evaluate("""(sel) => [...document.querySelector(sel).querySelectorAll('g.legend g.traces, g.legend2 g.traces, g.legend3 g.traces')].map(g => {
        const r = g.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: g.textContent }; })""", TILE)


STATE = """(sel) => { const gd = document.querySelector(sel);
    const out = {};
    for (const t of gd.data) { const key = t.legendgroup; if (!key) continue; (out[key] = out[key] || []).push(t.visible === 'legendonly' ? 0 : 1); }
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.every(x => x === 1) ? 'shown' : v.every(x => x === 0) ? 'hidden' : 'mixed'])); }"""


def test_hide_and_isolate_work_from_any_column(page, server):
    _open(page, server, 3)
    items = _items(page)
    assert len(items) == LINEAGES
    last = items[-1]                                   # in the last column
    first = items[0]                                   # in the first
    assert last["x"] > first["x"] + 100
    state = page.evaluate(STATE, TILE)
    assert set(state.values()) == {"shown"} and len(state) >= LINEAGES, state
    # a click hides the category's entry and its points, in the column it is in
    page.mouse.click(last["x"], last["y"])
    page.wait_for_function("([sel, n]) => document.querySelector(sel).data.filter(t => t.visible === 'legendonly' && t.meta === 'az-points').length === n", arg=[TILE, 1], timeout=10000)
    state = page.evaluate(STATE, TILE)
    assert list(state.values()).count("hidden") == 1 and "mixed" not in state.values(), state
    page.mouse.click(last["x"], last["y"])
    page.wait_for_function("([sel]) => !document.querySelector(sel).data.some(t => t.visible === 'legendonly')", arg=[TILE], timeout=10000)
    # a double click isolates it among the categories of every column; another shows all again
    page.mouse.dblclick(last["x"], last["y"])
    page.wait_for_function("([sel, n]) => document.querySelector(sel).data.filter(t => t.visible === 'legendonly' && t.meta === 'az-points').length === n", arg=[TILE, LINEAGES - 1], timeout=10000)
    state = page.evaluate(STATE, TILE)
    assert list(state.values()).count("shown") == 1 and list(state.values()).count("hidden") == LINEAGES - 1, state
    page.mouse.dblclick(first["x"], first["y"])        # from another column: that one alone now
    page.wait_for_function("([sel]) => { const d = document.querySelector(sel).data; const shown = d.filter(t => t.meta === 'az-points' && t.visible !== 'legendonly'); return shown.length === 1 && shown[0].legendgroup === d.find(t => t.meta === 'az-legend').legendgroup; }", arg=[TILE], timeout=10000)
    page.mouse.dblclick(first["x"], first["y"])
    page.wait_for_function("([sel]) => !document.querySelector(sel).data.some(t => t.visible === 'legendonly')", arg=[TILE], timeout=10000)


EXPORT = """async ([sel, how, width, height]) => {
  const { exportImageData } = await import('/static/js/utils/plot-export.js');
  const gd = document.querySelector(sel);
  const svg = await exportImageData(gd, how, { format: 'svg', width, height, scale: 1 });
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  const W = parseFloat(root.getAttribute('width')), H = parseFloat(root.getAttribute('height'));
  const boxes = [...doc.querySelectorAll('g.legend, g.legend2, g.legend3')].map(g => {
    const m = /translate\\(([-\\d.]+)[ ,]+([-\\d.]+)\\)/.exec(g.getAttribute('transform'));
    const bg = g.querySelector('rect.bg');
    return { x: parseFloat(m[1]), y: parseFloat(m[2]), w: parseFloat(bg.getAttribute('width')), h: parseFloat(bg.getAttribute('height')),
             texts: [...g.querySelectorAll('g.traces text')].map(n => n.textContent), clipped: !!g.querySelector('.scrollbox[clip-path]') };
  });
  return { W, H, boxes };
}"""


@pytest.mark.parametrize("how,size", [("full", (1600, 700)), ("full", (700, 400)), ("shown", (700, 400)), ("full", (1600, 220))])
def test_an_export_of_two_columns_holds_both_whole(page, server, how, size):
    _open(page, server, 2)
    r = page.evaluate(EXPORT, [TILE, how, *size])
    boxes = sorted(r["boxes"], key=lambda b: b["x"])
    assert len(boxes) == 2, r
    assert boxes[0]["x"] + boxes[0]["w"] <= boxes[1]["x"] + 0.5, ("columns overlap", boxes)
    for b in boxes:
        assert b["x"] >= -0.5 and b["x"] + b["w"] <= r["W"] + 0.5, ("clipped at the side", b, r["W"])
        assert b["y"] >= -0.5 and b["y"] + b["h"] <= r["H"] + 0.5, ("clipped at the bottom", b, r["H"])
    texts = [t for b in boxes for t in b["texts"]]
    assert len(texts) == LINEAGES
    if how == "full" and size[0] >= 1600:
        assert texts == LABELS


TITLE = """(sel) => { const gd = document.querySelector(sel);
    const g = gd.querySelector('g.legend');
    const bg = g.querySelector('rect.bg').getBoundingClientRect();
    const text = g.querySelector('text[class$="titletext"]');
    // the rows of the title's glyphs: the text nodes with something to read in them
    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    const rects = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!/\\S/.test(n.textContent.replace(/\\u00a0/g, ''))) continue;
        const range = document.createRange(); range.selectNodeContents(n); rects.push(range.getBoundingClientRect());
    }
    const entry = Math.min(...[...g.querySelectorAll('g.traces')].map(n => n.getBoundingClientRect().top));
    const root = gd.getBoundingClientRect();
    const bottom = Math.max(...rects.map(r => r.bottom));
    return { top: Math.min(...rects.map(r => r.top)) - bg.top, entry, gap: entry - bottom, boxTop: bg.top - root.top,
             text: text.textContent.replace(/\\u00a0/g, '').trim() }; }"""


@pytest.mark.parametrize("columns", [None, 2])
def test_the_title_is_whole_at_every_gap(page, server, columns):
    gaps = {}
    for gap in (0, 1, 2, 5, 10, 25):
        _open(page, server, columns, legendTitleGap=gap, legendPosition="top")
        r = page.evaluate(TITLE, TILE)
        assert r["text"] == "lineage", r
        assert r["top"] >= -0.5, (gap, "the top of the title is above its legend", r)
        assert r["boxTop"] >= -0.5, (gap, "the legend is above the graph", r)
        gaps[gap] = r["gap"]
    # real pixels: each step moves the first entry by about the step (Plotly rounds a line to whole pixels)
    for a, b in ((0, 10), (10, 25), (1, 10), (5, 25)):
        assert abs((gaps[b] - gaps[a]) - (b - a)) <= 2.5, (a, b, gaps)
    assert gaps[0] <= gaps[1] <= gaps[2] + 1.5 <= gaps[5] + 3 <= gaps[10] + 6, gaps
