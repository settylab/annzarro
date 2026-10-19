"""The table's line-selection tool, end to end (static/js/panels/table-utilities/line-select-ui.js).

A cell table and two cell plots: A draws the UMAP (two numerical axes), B has a
categorical x axis. Armed from the table's Line button:

  - B says why it cannot take a line when the mouse is over it, before any click;
  - a line dragged on A previews the side to be filtered out, and on release adds
    the two axes' columns, a derived column and ONE condition on it to the table,
    and selects the table in A's table filter; every row the table drops is on the
    right of the line AS DRAWN (checked on the screen, also with a reversed axis);
  - Shift snaps to 45 degrees: a horizontal line puts the condition on the y column
    itself, with no derived column;
  - Escape stops it: the release after Escape changes nothing;
  - a second line joins the first by an outer AND; under an outer OR the filter is
    wrapped in a group;
  - the table's settings (columns with the derived one, the filter) survive being
    written to a link and opened again.

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

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "..", "data")
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
N_CELLS = 200
TABLE, PLOT_A, PLOT_B = "cell-table-T", "cell-plot-A", "cell-plot-B"
UMAP = lambda column: {"type": "obsm", "key": "X_umap", "column": column}   # noqa: E731
OBS = lambda key: {"type": "obs", "key": key, "column": ""}   # noqa: E731


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _serve(tmp_path_factory, config=""):
    data = tmp_path_factory.mktemp("data")
    store = str(data / "fixture_small.zarr")
    shutil.copytree(os.path.join(DATA_DIR, "fixture_small.zarr"), store)
    home = tmp_path_factory.mktemp("home")
    (home / "c.yaml").write_text(config or "ui: {}\n")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--config", str(home / "c.yaml"),
                             "--host", "127.0.0.1", "--port", str(port), "--data-dir", str(data),
                             "--no-browser", "--auth-disabled"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for _ in range(120):
        try:
            urllib.request.urlopen(root + "/api/v1/config", timeout=1)
            break
        except OSError:
            time.sleep(min(0.5, 0.1 * (_ + 1)))
    else:
        proc.kill()
        pytest.fail("server did not start")
    return root, store, proc


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    root, store, proc = _serve(tmp_path_factory)
    yield root, store
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def large_server(tmp_path_factory):
    """The same store with every plot of more than 100 cells drawn in large-plot mode."""
    root, store, proc = _serve(tmp_path_factory, "ui:\n  defaults:\n    large_plot_points: 100\n")
    yield root, store
    proc.terminate()
    proc.wait(10)


def _link(root, store, table_cfg=None, color=None, extra=None):
    plot = {"title": "plot", "z": None, "pointSize": 8, "pointOpacity": 1, "color": {"type": "none"},
            "tableFilter": "none"}
    configs = {
        TABLE: {"id": TABLE, "title": "cells",
                "columns": [OBS("cell_type")], **(table_cfg or {})},
        PLOT_A: {**plot, "id": PLOT_A, "x": UMAP("0"), "y": UMAP("1"), **({"color": color} if color else {})},
        PLOT_B: {**plot, "id": PLOT_B, "x": OBS("cell_type"), "y": OBS("total_counts")},
    }
    configs.update(extra or {})
    tiles = {t: {"type": "tile", "id": t, "controlsVisible": False} for t in configs}
    def pair(a, b):      # a split holds two children
        return {"type": "split", "direction": "vertical", "panes": [{"percentage": 50}, {"percentage": 50}],
                "children": [a, b]}
    right = pair(tiles[PLOT_A], tiles[PLOT_B])
    if extra:
        more = [tiles[t] for t in extra]
        right = pair(right, pair(more[0], more[1]) if len(more) > 1 else more[0])
    hierarchy = [{"type": "split", "direction": "horizontal", "panes": [{"percentage": 40}, {"percentage": 60}],
                  "children": [tiles[TABLE], right]}]
    view = {"v": 1, "constants": {}, "layout": {"v": 1, "hierarchy": hierarchy,
                                                "controlState": {t["id"]: t["controlsVisible"] for t in tiles.values()},
                                                "panelConfigs": configs}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}"


def _open(pw, root, store, table_cfg=None, width=1800, color=None, extra=None, height=1500):
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": width, "height": height})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(_link(root, store, table_cfg, color, extra))
    _settle(page)
    return browser, page, errors


def _settle(page, rows=None):
    page.wait_for_selector(f'.tile[data-tile-id="{TABLE}"] .dataTables_scrollBody tbody tr', timeout=60_000)
    for plot in (PLOT_A, PLOT_B):
        page.wait_for_function(
            "id => { const g = document.getElementById('plot-container-' + id);"
            " return g && g._fullLayout && g._fullLayout.xaxis && g.data && g.data.length; }",
            arg=plot, timeout=60_000)
    if rows is not None:
        page.wait_for_function(f"() => {_ROWS_JS}() === {rows}", timeout=30_000)
    page.wait_for_timeout(800)


_DT = "jQuery(document.querySelector('.tile[data-tile-id=\"%s\"] table[id^=DataTables_Table]')).DataTable()" % TABLE
_ROWS_JS = "(() => %s.rows({search: 'applied'}).count())" % _DT


def _rows(page):
    return page.evaluate(f"{_ROWS_JS}()")


def _details(page):
    return page.evaluate(f"() => {_DT}.searchBuilder.getDetails()")


def _arm(page):
    page.click(f'.tile[data-tile-id="{TABLE}"] .az-line-select-btn')
    page.wait_for_selector(f'.az-line-overlay[data-plot="{PLOT_A}"]')


def _area(page, plot=PLOT_A):
    """The plot area of a plot in page pixels."""
    return page.evaluate("""id => { const g = document.getElementById('plot-container-' + id);
        const r = g.getBoundingClientRect(), fl = g._fullLayout;
        return {left: r.left + fl.xaxis._offset, top: r.top + fl.yaxis._offset,
                w: fl.xaxis._length, h: fl.yaxis._length}; }""", plot)


_RECORD_JS = """id => { window.__azPts = {};
    window.addEventListener('pointerdown', e => {
        const g = document.getElementById('plot-container-' + id), r = g.getBoundingClientRect(), fl = g._fullLayout;
        window.__azPts.geo = {left: r.left, top: r.top, xo: fl.xaxis._offset, yo: fl.yaxis._offset,
                              xr: fl.xaxis.range.slice(), yr: fl.yaxis.range.slice(),
                              xl: fl.xaxis._length, yl: fl.yaxis._length};
    }, true);
    for (const t of ['pointerdown', 'pointerup']) window.addEventListener(t,
        e => { window.__azPts[t] = [e.clientX, e.clientY]; }, true); }"""


def _record(page):
    """Note the mouse down and release as the page sees them (the browser rounds the positions),
    and plot A's axes when the line starts: the plot is redrawn once the table filters it."""
    page.evaluate(_RECORD_JS, PLOT_A)


def _seen(page):
    seen = page.evaluate("window.__azPts")
    return tuple(seen["pointerdown"]), tuple(seen["pointerup"])


def _still(page):
    """Wait until plot A has stopped moving (a table above it growing or shrinking)."""
    last = None
    for _ in range(40):
        now = page.evaluate(f"JSON.stringify(document.getElementById('plot-container-{PLOT_A}').getBoundingClientRect())")
        if now == last:
            return
        last = now
        page.wait_for_timeout(300)


def _drag(page, a, b, shift=False, steps=8, release=True):
    """Drag across plot A from fractions `a` to `b` of its area. Returns the points the page
    saw (the browser rounds mouse positions): mouse down, mouse release."""
    _still(page)
    area = _area(page)
    ax, ay = area["left"] + area["w"] * a[0], area["top"] + area["h"] * a[1]
    bx, by = area["left"] + area["w"] * b[0], area["top"] + area["h"] * b[1]
    _record(page)
    page.mouse.move(ax, ay)
    page.mouse.down()
    if shift:
        page.keyboard.down("Shift")
    page.mouse.move(bx, by, steps=steps)
    if release:
        page.mouse.up()
        if shift:
            page.keyboard.up("Shift")
        return _seen(page)
    return (ax, ay), (bx, by)


def _wait_filtered(page, before):
    page.wait_for_function(f"b => {_ROWS_JS}() !== b", arg=before, timeout=30_000)
    page.wait_for_timeout(800)


# Every row of the table (the filter is not applied to `data()`), put on the screen of plot A,
# and which side of the mouse line it is on; with whether the table keeps it.
SIDES = """([p1, p2]) => {
  const dt = %s, geo = window.__azPts.geo;
  const px = (v, range, length, vertical) => { const [r0, r1] = range; return vertical
      ? (1 - (v - r0) / (r1 - r0)) * length : ((v - r0) / (r1 - r0)) * length; };
  const kept = new Set(dt.rows({search: 'applied'}).indexes().toArray());
  const out = {rightKept: 0, rightDropped: 0, leftKept: 0, leftDropped: 0, near: 0};
  dt.rows().every(function () {
    const d = this.data(), i = this.index();
    const sx = geo.left + geo.xo + px(d['obsm_X_umap_0'], geo.xr, geo.xl, false);
    const sy = geo.top + geo.yo + px(d['obsm_X_umap_1'], geo.yr, geo.yl, true);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const cross = ((p2[0] - p1[0]) * (sy - p1[1]) - (p2[1] - p1[1]) * (sx - p1[0])) / len;
    if (Math.abs(cross) < 0.05) { out.near++; return; }
    const right = cross > 0, isKept = kept.has(i);
    out[(right ? 'right' : 'left') + (isKept ? 'Kept' : 'Dropped')]++;
  });
  return out;
}""" % _DT


def _sides(page, p1, p2):
    return page.evaluate(SIDES, [list(p1), list(p2)])


def _assert_right_is_dropped(s):
    assert s["rightKept"] == 0, s
    assert s["leftDropped"] == 0, s
    assert s["rightDropped"] > 0 and s["leftKept"] > 0, ("the line splits the cells", s)


def test_line_drawn_on_a_plot_filters_the_right_side(server):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser, page, errors = _open(pw, root, store)
        try:
            assert _rows(page) == N_CELLS
            _arm(page)
            # a slanted line from the left to the upper right of the plot
            area = _area(page)
            a = (area["left"] + area["w"] * 0.1, area["top"] + area["h"] * 0.85)
            _record(page)
            page.mouse.move(*a)
            page.mouse.down()
            page.mouse.move(area["left"] + area["w"] * 0.9, area["top"] + area["h"] * 0.2, steps=6)
            # while drawing: the line and the shaded side are there
            shade = page.evaluate(f"""() => {{ const s = document.querySelector(
                '.az-line-overlay[data-plot="{PLOT_A}"] .az-line-shade');
                return {{shown: s.style.display !== 'none', points: s.getAttribute('points')}}; }}""")
            assert shade["shown"] and len(shade["points"].split()) >= 3, shade
            page.mouse.up()
            a, b = _seen(page)
            _wait_filtered(page, N_CELLS)

            details = _details(page)
            assert details["logic"] == "AND" and len(details["criteria"]) == 1, details
            crit = details["criteria"][0]
            assert crit["condition"] in ("<=", ">="), crit
            assert "X_umap:1" in crit["data"] and "X_umap:0" in crit["data"], crit
            # the columns: both axes and the derived one
            cols = page.evaluate(f"""() => PanelManager.getPanel('{TABLE}').getConfig().columns""")
            assert {"type": "obsm", "key": "X_umap", "column": "0"} in cols
            assert {"type": "obsm", "key": "X_umap", "column": "1"} in cols
            derived = [c for c in cols if c["type"] == "derived"]
            assert len(derived) == 1 and derived[0]["key"] == crit["data"], (cols, crit)
            # the right of the line (as drawn) is gone, the left is kept
            _assert_right_is_dropped(_sides(page, a, b))
            # the plot is filtered by the table now
            assert page.evaluate(f"document.querySelector('#table-filter-{PLOT_A}').value") == TABLE
            # the tool stays armed for the next line; the chooser lists the derived column
            assert page.evaluate("document.querySelector('.az-line-select-btn').classList.contains('active')")
            assert page.locator(f'.tile[data-tile-id="{TABLE}"] .derived-column').count() == 1
            assert not errors, errors
        finally:
            browser.close()


def test_a_reversed_axis_still_filters_the_side_the_user_sees(server):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser, page, errors = _open(pw, root, store)
        try:
            # reverse x and y, as a user does with the axis range
            page.evaluate(f"""async () => {{ const g = document.getElementById('plot-container-{PLOT_A}');
                const fl = g._fullLayout, x = fl.xaxis.range, y = fl.yaxis.range;
                await Plotly.relayout(g, {{'xaxis.range': [x[1], x[0]], 'yaxis.range': [y[1], y[0]]}}); }}""")
            page.wait_for_timeout(500)
            _arm(page)
            a, b = _drag(page, (0.15, 0.3), (0.85, 0.75))
            _wait_filtered(page, N_CELLS)
            _assert_right_is_dropped(_sides(page, a, b))
            # and the other way round: the other side goes (a second table state)
            assert not errors, errors
        finally:
            browser.close()


def test_the_other_direction_filters_the_other_side(server):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser, page, errors = _open(pw, root, store)
        try:
            _arm(page)
            a, b = _drag(page, (0.85, 0.8), (0.15, 0.2))
            _wait_filtered(page, N_CELLS)
            _assert_right_is_dropped(_sides(page, a, b))
            assert not errors, errors
        finally:
            browser.close()


def test_shift_snaps_and_an_axis_parallel_line_needs_no_derived_column(server):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser, page, errors = _open(pw, root, store)
        try:
            _arm(page)
            # nearly horizontal, snapped by Shift
            a, b = _drag(page, (0.1, 0.5), (0.9, 0.56), shift=True)
            _wait_filtered(page, N_CELLS)
            details = _details(page)
            crit = details["criteria"][0]
            assert crit["data"] == "X_umap:1", crit
            cols = page.evaluate(f"""() => PanelManager.getPanel('{TABLE}').getConfig().columns""")
            assert not [c for c in cols if c["type"] == "derived"], cols
            # horizontal, left to right: the right (below on the screen) is dropped
            value = float(crit["value"][0])
            assert crit["condition"] == ">="
            ys = page.evaluate(f"""() => {{ const dt = {_DT}, kept = new Set(dt.rows({{search: 'applied'}}).indexes().toArray());
                return dt.rows().indexes().toArray().map(i => [dt.row(i).data()['obsm_X_umap_1'], kept.has(i)]); }}""")
            assert all(k == (y >= value) for y, k in ys), "rows below the line are dropped, the rest kept"
            assert any(k for _, k in ys) and not all(k for _, k in ys)
            assert not errors, errors
        finally:
            browser.close()


def test_escape_stops_the_tool_and_the_release_does_nothing(server):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser, page, errors = _open(pw, root, store)
        try:
            _arm(page)
            _drag(page, (0.1, 0.8), (0.9, 0.3), release=False)
            page.keyboard.press("Escape")
            page.mouse.up()
            page.wait_for_timeout(1000)
            assert _rows(page) == N_CELLS
            assert _details(page) == {}
            assert page.locator(".az-line-overlay").count() == 0
            assert not page.evaluate("document.querySelector('.az-line-select-btn').classList.contains('active')")
            cols = page.evaluate(f"""() => PanelManager.getPanel('{TABLE}').getConfig().columns""")
            assert cols == [OBS("cell_type")], cols
            # the same with Escape while only armed
            _arm(page)
            page.keyboard.press("Escape")
            assert page.locator(".az-line-overlay").count() == 0
            assert not errors, errors
        finally:
            browser.close()


def test_a_plot_with_a_text_axis_gets_a_light_tooltip_and_no_layer(server):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser, page, errors = _open(pw, root, store)
        try:
            _arm(page)
            # no layer over it: the mouse is its own there
            assert page.locator(f'.az-line-overlay[data-plot="{PLOT_B}"]').count() == 0
            assert page.locator(".az-line-overlay").count() == 1
            box = page.evaluate(f"(() => {{ const r = document.getElementById('plot-container-{PLOT_B}').getBoundingClientRect();"
                                " return {x: r.left + r.width / 2, y: r.top + r.height / 2}; })()")
            page.mouse.move(box["x"], box["y"])
            page.wait_for_selector("#line-select-tip", timeout=5000)
            tip = page.inner_text("#line-select-tip")
            assert tip.startswith("This plot's x axis (cell_type) is not numeric"), tip
            t = page.evaluate("(() => { const r = document.getElementById('line-select-tip').getBoundingClientRect();"
                              " return {l: r.left, t: r.top}; })()")
            assert abs(t["l"] - box["x"]) < 60 and 0 < t["t"] - box["y"] < 60, (t, box)
            # it blocks nothing: the plot under it gets the pointer (hover shows its own label)
            hit = page.evaluate(f"document.elementFromPoint({box['x']}, {box['y']}).closest('#plot-container-{PLOT_B}') !== null")
            assert hit
            before = _rows(page)
            page.mouse.click(box["x"], box["y"])
            page.wait_for_timeout(500)
            assert _rows(page) == before
            # off the plot: the tip goes
            page.mouse.move(5, 5)
            page.wait_for_function("() => !document.getElementById('line-select-tip')", timeout=5000)
            page.keyboard.press("Escape")
            assert page.locator("#line-select-tip").count() == 0
            assert not errors, errors
            if os.environ.get("AZ_SHOT_DIR"):
                _arm(page)
                page.mouse.move(box["x"], box["y"])
                page.wait_for_selector("#line-select-tip")
                page.screenshot(path=os.path.join(os.environ["AZ_SHOT_DIR"], "line-select-tip.png"))
        finally:
            browser.close()


PLOT_3D, PLOT_GENE = "cell-plot-3D", "gene-plot-G"
_PLOT = {"title": "plot", "pointSize": 8, "pointOpacity": 1, "color": {"type": "none"}, "tableFilter": "none"}
EXTRA_PLOTS = {
    PLOT_3D: {**_PLOT, "id": PLOT_3D, "x": UMAP("0"), "y": UMAP("1"), "z": OBS("total_counts")},
    PLOT_GENE: {**_PLOT, "id": PLOT_GENE, "z": None, "x": {"type": "layer", "key": "X", "column": "GENE001"},
                "y": {"type": "layer", "key": "X", "column": "GENE002"}},
}


def test_armed_leaves_a_3d_plot_and_a_gene_plot_alone(server):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser, page, errors = _open(pw, root, store, extra=EXTRA_PLOTS, height=2200)
        try:
            for pid in (PLOT_3D, PLOT_GENE):
                page.wait_for_function(f"id => document.getElementById('plot-container-' + id)?.data?.length", arg=pid, timeout=60_000)
            page.wait_for_timeout(1500)
            _arm(page)
            page.wait_for_timeout(800)
            # a layer over the cell plot that takes a line, none over the 3D plot, none over the gene plot
            assert page.locator(f'.az-line-overlay[data-plot="{PLOT_A}"]').count() == 1
            assert page.locator(f'.az-line-overlay[data-plot="{PLOT_3D}"]').count() == 0
            assert page.locator(f'.az-line-overlay[data-plot="{PLOT_GENE}"]').count() == 0
            assert page.locator("#line-select-tip").count() == 0
            before = _rows(page)
            for pid in (PLOT_3D, PLOT_GENE):
                box = page.evaluate(f"(() => {{ const r = document.getElementById('plot-container-{pid}').getBoundingClientRect();"
                                    " return {x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height}; })()")
                # the pointer reaches the plot itself, not a layer
                assert page.evaluate(f"document.elementFromPoint({box['x']}, {box['y']}).closest('#plot-container-{pid}') !== null")
                page.mouse.move(box["x"], box["y"])
                page.wait_for_timeout(300)
                assert page.locator("#line-select-tip").count() == 0
                page.mouse.down()
                page.mouse.move(box["x"] + box["w"] * 0.3, box["y"] + box["h"] * 0.2, steps=8)      # a rotate / a zoom box
                page.mouse.up()
                page.wait_for_timeout(500)
                assert _rows(page) == before
                assert _details(page) == {}
            if os.environ.get("AZ_SHOT_DIR"):
                page.screenshot(path=os.path.join(os.environ["AZ_SHOT_DIR"], "line-select-3d.png"))
            # the 3D plot really rotated: its camera moved under that drag
            cam = page.evaluate(f"JSON.stringify(document.getElementById('plot-container-{PLOT_3D}')._fullLayout.scene.camera.eye)")
            assert cam != '{"x":1.25,"y":1.25,"z":1.25}', cam
            assert not errors, errors
        finally:
            browser.close()


def test_second_line_joins_by_an_outer_and_or_wraps_an_or(server):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser, page, errors = _open(pw, root, store)
        try:
            _arm(page)
            _drag(page, (0.1, 0.8), (0.9, 0.3))
            _wait_filtered(page, N_CELLS)
            first = _rows(page)
            # a vertical line (Shift): a second condition under the same outer AND
            _drag(page, (0.3, 0.9), (0.3, 0.1), shift=True)
            _wait_filtered(page, first)
            d = _details(page)
            assert d["logic"] == "AND" and len(d["criteria"]) == 2, d
            assert d["criteria"][1]["data"] == "X_umap:0", d
            # switch the outer AND to OR in the builder: the table shows more
            second = _rows(page)
            page.click(f'.tile[data-tile-id="{TABLE}"] .dtsb-group > .dtsb-logicContainer button')
            page.wait_for_function(f"s => {_ROWS_JS}() > s", arg=second, timeout=30_000)
            assert _details(page)["logic"] == "OR"
            or_rows = _rows(page)
            # a third line wraps the OR in a group and joins by an outer AND
            _arm_again = page.evaluate("document.querySelector('.az-line-select-btn').classList.contains('active')")
            if not _arm_again:
                _arm(page)
            _drag(page, (0.9, 0.1), (0.1, 0.1), shift=True)
            _wait_filtered(page, or_rows)
            d = _details(page)
            assert d["logic"] == "AND" and len(d["criteria"]) == 2, d
            group = d["criteria"][0]
            assert group["logic"] == "OR" and len(group["criteria"]) == 2, d
            assert not errors, errors
        finally:
            browser.close()


def test_the_derived_column_and_filter_come_back_from_a_link(server):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser, page, errors = _open(pw, root, store)
        try:
            _arm(page)
            _drag(page, (0.1, 0.8), (0.9, 0.3))
            _wait_filtered(page, N_CELLS)
            kept = _rows(page)
            cfg = page.evaluate(f"""() => {{ const c = PanelManager.getPanel('{TABLE}').getConfig();
                return {{columns: c.columns, searchBuilderConfig: c.searchBuilderConfig}}; }}""")
        finally:
            browser.close()
        # the same, written to a link and opened in a new page
        browser, page, errors = _open(pw, root, store, table_cfg=cfg)
        try:
            page.wait_for_function(f"() => {_ROWS_JS}() === {kept}", timeout=30_000)
            assert _details(page) == cfg["searchBuilderConfig"]
            heads = page.evaluate(f"() => {_DT}.columns().header().toArray().map(h => h.textContent)")
            assert any("−" in h or "+" in h for h in heads), heads
            assert not errors, errors
        finally:
            browser.close()


def test_in_large_plot_mode_there_is_no_table_to_arm_from(large_server):
    """A plot of this size has no table: a cell table cannot list the cells, and says so."""
    root, store = large_server
    with playwright.sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_page(viewport={"width": 1800, "height": 1500})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        try:
            page.goto(_link(root, store))
            page.wait_for_function(
                f"() => document.getElementById('plot-container-{PLOT_A}')?.__isLarge === true", timeout=60_000)
            page.wait_for_function(
                f"() => /large-plot mode/.test(document.querySelector('.tile[data-tile-id=\"{TABLE}\"]').innerText)",
                timeout=30_000)
            assert page.locator(f'.tile[data-tile-id="{TABLE}"] .az-line-select-btn').count() == 0
            assert not errors, errors
        finally:
            browser.close()


def test_a_relayout_during_a_drag_drops_the_line(server):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser, page, errors = _open(pw, root, store)
        try:
            _arm(page)
            _drag(page, (0.1, 0.8), (0.9, 0.3), release=False)
            # the axes move under the line (a zoom made elsewhere, a redraw)
            page.evaluate(f"""() => {{ const g = document.getElementById('plot-container-{PLOT_A}');
                const r = g._fullLayout.xaxis.range; return Plotly.relayout(g, {{'xaxis.range': [r[0] + 1, r[1]]}}); }}""")
            page.mouse.up()
            page.wait_for_timeout(1000)
            assert _rows(page) == N_CELLS
            assert _details(page) == {}
            # the tool is still armed and takes the next line
            _drag(page, (0.1, 0.8), (0.9, 0.3))
            _wait_filtered(page, N_CELLS)
            assert not errors, errors
        finally:
            browser.close()


def test_the_line_button_comes_before_the_search_box_and_is_labelled(server):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser, page, errors = _open(pw, root, store)
        try:
            g = page.evaluate(f"""() => {{ const t = document.querySelector('.tile[data-tile-id="{TABLE}"]');
                const b = t.querySelector('.az-line-select-btn').getBoundingClientRect();
                const i = t.querySelector('.dataTables_filter input').getBoundingClientRect();
                return {{bRight: b.right, iLeft: i.left, text: t.querySelector('.az-line-select-text').innerText,
                         shown: t.querySelector('.az-line-select-text').offsetParent !== null}}; }}""")
            assert g["bRight"] <= g["iLeft"] and g["text"] == "Line filter" and g["shown"], g
            # a narrow tile drops the label but keeps the button
            page.set_viewport_size({"width": 520, "height": 1500})
            page.wait_for_timeout(1500)
            n = page.evaluate(f"""() => {{ const t = document.querySelector('.tile[data-tile-id="{TABLE}"]');
                const c = t.querySelector('.dt-search-container').getBoundingClientRect().width;
                const b = t.querySelector('.az-line-select-btn');
                return {{c, label: t.querySelector('.az-line-select-text').offsetParent !== null,
                         btn: b.offsetParent !== null, title: b.title}}; }}""")
            assert n["btn"] and "Line filter" in n["title"], n
            if n["c"] <= 380:
                assert not n["label"], n
            assert not errors, errors
        finally:
            browser.close()


# Plot A coloured by a category and by a number: a table filter that matches nothing was drawn wrong
# in the numeric case (the cells that had just left the table vanished instead of turning grey)
COLOURS = [OBS("cell_type"), OBS("total_counts")]

# What plot A draws: the points of the "Not in table" trace are grey, the others in colour.
_DRAWN_JS = """() => { const g = document.getElementById('plot-container-%s'); let n = 0, grey = 0, color = 0;
  for (const t of g._fullData) { if (!t.x || t.hoverinfo === 'skip' || t.name === 'Focused Cell') continue;
    n += t.x.length; if (t.name === 'Not in table') grey += t.x.length; else color += t.x.length; }
  return {n, grey, color}; }""" % PLOT_A


def _plot_state(page):
    return page.evaluate(_DRAWN_JS)


def _wait_plot(page, pred, what):
    for _ in range(80):
        s = _plot_state(page)
        if pred(s):
            return s
        page.wait_for_timeout(250)
    pytest.fail(f"plot never showed {what}; last state {_plot_state(page)}")


def _link_plot(page):
    page.evaluate(f"""() => {{ const s = document.querySelector('#table-filter-{PLOT_A}');
        s.value = '{TABLE}'; jQuery(s).trigger('change'); }}""")
    page.wait_for_timeout(1500)


@pytest.mark.parametrize("color", COLOURS, ids=["categorical", "numeric"])
def test_an_empty_hand_made_filter_greys_every_cell_and_removing_it_restores_them(server, color):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser, page, errors = _open(pw, root, store, color=color)
        try:
            _link_plot(page)
            full = _plot_state(page)
            assert full["color"] > 0 and full["grey"] == 0, full
            page.evaluate(f"""() => {{ const dt = {_DT}; const sb = dt.searchBuilder;
                sb.rebuild({{logic: 'AND', criteria: [{{condition: 'starts', data: 'cell_type', origData: 'obs_cell_type_main',
                type: 'string', value: ['zzz']}}]}}); }}""")
            page.wait_for_function(f"() => {_ROWS_JS}() === 0", timeout=20_000)
            s = _wait_plot(page, lambda s: s["color"] == 0 and s["n"] > 0, "every cell grey")
            assert s["grey"] == s["n"], s
            page.evaluate(f"() => {_DT}.searchBuilder.rebuild({{}})")
            page.wait_for_function(f"() => {_ROWS_JS}() === {N_CELLS}", timeout=20_000)
            s = _wait_plot(page, lambda s: s["grey"] == 0 and s["color"] > 0, "the colours back")
            assert not errors, errors
        finally:
            browser.close()


@pytest.mark.parametrize("color", COLOURS, ids=["categorical", "numeric"])
def test_a_line_that_leaves_no_cell_greys_every_cell_and_deleting_it_restores_them(server, color):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser, page, errors = _open(pw, root, store, color=color)
        try:
            _arm(page)
            _drag(page, (0.1, 0.3), (0.9, 0.3), shift=True)       # keep what is above the line
            _wait_filtered(page, N_CELLS)
            page.wait_for_function(f"() => {_ROWS_JS}() > 0")
            some = _wait_plot(page, lambda s: s["grey"] > 0 and s["color"] > 0, "a part in colour")
            n = _rows(page)
            _drag(page, (0.9, 0.7), (0.1, 0.7), shift=True)       # keep what is below a lower line: nothing
            _wait_filtered(page, n)
            assert _rows(page) == 0
            s = _wait_plot(page, lambda s: s["color"] == 0 and s["n"] > 0, "every cell grey")
            assert s["grey"] == s["n"] == some["n"], (s, some)
            # delete the last condition in the builder: the cells come back in colour
            page.click(f'.tile[data-tile-id="{TABLE}"] .dtsb-criteria .dtsb-delete >> nth=-1')
            page.wait_for_function(f"() => {_ROWS_JS}() > 0", timeout=20_000)
            _wait_plot(page, lambda s: s["color"] > 0 and s["grey"] > 0, "the colours back")
            assert not errors, errors
        finally:
            browser.close()


def _armed_chrome(page):
    return page.evaluate(f"""() => {{ const b = document.getElementById('line-select-badge');
        const t = document.querySelector('.tile[data-tile-id="{TABLE}"]');
        return {{badge: !!b, text: b ? b.innerText.replace(/\\s+/g, ' ') : '', title: b ? b.title : '',
                 inBar: !!(b && b.closest('#dataset-stats')),
                 frame: !!(t && t.classList.contains('az-line-armed')),
                 frames: document.querySelectorAll('.az-line-armed').length,
                 overlays: document.querySelectorAll('.az-line-overlay').length,
                 btn: !!document.querySelector('.az-line-select-btn.active')}}; }}""")


def _is_off(page):
    page.wait_for_function("() => !document.getElementById('line-select-badge') && "
                           "!document.querySelector('.az-line-armed') && "
                           "!document.querySelector('.az-line-overlay')", timeout=10_000)


def test_armed_shows_a_badge_and_a_frame_and_a_click_on_the_badge_stops(server):
    root, store = server
    with playwright.sync_playwright() as pw:
        browser, page, errors = _open(pw, root, store)
        try:
            assert _armed_chrome(page)["badge"] is False
            _arm(page)
            a = _armed_chrome(page)
            assert a["badge"] and a["inBar"] and a["frame"] and a["frames"] == 1 and a["btn"], a
            assert a["text"].startswith("Line filter on: cells"), a
            assert "right" in a["title"] and "Esc" in a["title"] and "Drag on a plot of cells to draw a line" in a["title"], a
            page.click("#line-select-badge")
            _is_off(page)
            assert not page.evaluate("!!document.querySelector('.az-line-select-btn.active')")
            # the hint on a plot is short
            _arm(page)
            hint = page.evaluate(f"document.querySelector('.az-line-overlay[data-plot=\"{PLOT_A}\"] .az-line-msg').textContent")
            assert len(hint) < 80, hint
            page.keyboard.press("Escape")
            _is_off(page)
            assert not errors, errors
        finally:
            browser.close()


def test_the_tool_stops_when_its_table_goes_away(server):
    root, store = server
    with playwright.sync_playwright() as pw:
        # the table is closed
        browser, page, errors = _open(pw, root, store)
        try:
            _arm(page)
            _drag(page, (0.1, 0.8), (0.9, 0.3), release=False)         # even in the middle of a line
            page.evaluate(f"PanelManager.closePanel('{TABLE}')")
            _is_off(page)
            page.mouse.up()
            page.wait_for_timeout(500)
            assert not errors, errors
        finally:
            browser.close()
        # Close all (through its own confirmation)
        browser, page, errors = _open(pw, root, store)
        try:
            _arm(page)
            page.evaluate("document.getElementById('btn-close-all').click()")
            page.locator("#notification-container button", has_text="Close all").first.click()
            _is_off(page)
            assert not errors, errors
        finally:
            browser.close()
        # a panel set or a link rebuilds every panel
        browser, page, errors = _open(pw, root, store)
        try:
            _arm(page)
            page.evaluate("""async () => { const layout = PanelManager.saveLayout();
                await PanelManager.restoreLayout(typeof layout === 'string' ? JSON.parse(layout) : layout); }""")
            _is_off(page)
            assert not errors, errors
        finally:
            browser.close()
