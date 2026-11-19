"""A table filter that no cell passes draws no cell as if it passed.

Reported on a live change of a filtering table from 117 passing rows to 0
on a 2,700-cell dataset: the plot kept drawing its points in the "in table"
colour (2,583 of them), the strip said "2,700 cells" with the excluded cells
greyed and "0 of 2,700 cells shown" with them removed, while the points
stayed. A fresh draw with 0 passing was not tested.

A filter that resolves to no cells is its own state, not "Filter not applied":

* excluded cells greyed: every cell is drawn grey (never the colour of the
  cells that pass; a hand-made filter that nothing passes always did this,
  test_table_line_select.py), and the strip carries the tag "No cells pass";
  its text is "No cells pass 'Table 1'." with Open table and Stop filtering;
* excluded cells removed: no point at all, a placeholder that says
  "No cells pass 'Table 1'." ("0 of 200 cells shown") with Open table (when the
  table is closed) and Stop filtering.
When the table passes cells again the plot redraws by itself.

The committed 200-cell fixture, a cell plot filtered by a cell table, three
colourings (none, a category, a number), each as a live change (the table's
search goes from 100 rows to 0, and back: recovery), as a fresh draw (a link
whose table search already passes nothing) and with the removal toggled while
nothing passes. Each case asserts the points in the graph's traces. Large-plot
mode (above 100 points here) does not apply table filters (large-plot.js):
with nothing passing it draws every cell under its "Large plot" tag, never a
placeholder.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import base64
import json
import os
import urllib.parse

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402  (required: fail, do not skip)
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_memory_guard import STORE, _serve, until  # noqa: E402

N = 200
P, T = "cell-plot-Z", "cell-table-Z"
PLOT = f'.tile[data-tile-id="{P}"]'
SEARCH = f'.tile[data-tile-id="{T}"] input[type="search"]'
NONE = "zzzzqq"             # matches no cell
SOME = "cell_01"            # matches cell_0100 to cell_0199: 100 cells
SAY = "No cells pass 'Table 1'."
COLOURS = {
    "none": {"type": "none", "key": "", "column": ""},
    "category": {"type": "obs", "key": "cell_type", "column": ""},
    "number": {"type": "obs", "key": "total_counts", "column": ""},
}

# what the plot draws: points in the table's colour, grey points, the placeholder, the tag
STATE = """() => {
    const tile = document.querySelector('%s');
    const gd = tile && tile.querySelector('.js-plotly-plot');
    const traces = gd && gd.data ? gd.data.filter(t => t.meta !== 'az-legend' && t.meta !== 'az-colorbar'
        && !/^focused/i.test(t.name || '') && t.x) : [];
    const count = ts => ts.reduce((s, t) => s + t.x.length + 0, 0);
    // the grey trace is drawn grey (R, G and B alike), never in the colour of the points that pass
    const rgb = c => { const x = document.createElement('canvas').getContext('2d'); x.fillStyle = '#000'; x.fillStyle = String(c);
        const m = x.fillStyle.match(/^#(..)(..)(..)/); return m ? [1, 2, 3].map(i => parseInt(m[i], 16)) : [0, 0, 255]; };
    const neutral = c => { const v = rgb(c); return Math.max(...v) - Math.min(...v) <= 8; };
    const greyOk = traces.filter(t => t.name === 'Not in table').every(t => neutral(t.marker && t.marker.color));
    const text = sel => { const e = tile && tile.querySelector(sel); return e ? e.textContent.trim() : null; };
    return { greyOk,
             inTable: count(traces.filter(t => t.name !== 'Not in table')),
             grey: count(traces.filter(t => t.name === 'Not in table')),
             placeholder: text('.coverage-placeholder__headline'),
             tag: text('.ps-tag[data-tag="table-empty"]'),
             actions: [...(tile ? tile.querySelectorAll('.coverage-placeholder [data-ps-action]') : [])].map(b => b.textContent.trim()) };
}""" % PLOT


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    root, proc = _serve(tmp_path_factory)
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def large_server(tmp_path_factory):
    root, proc = _serve(tmp_path_factory, "ui:\n  defaults:\n    large_plot_points: 100\n")
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture
def page():
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1500, "height": 950})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            yield page
            assert not errors, errors
        finally:
            browser.close()


def _link(root, colour, remove, search=SOME, linked=True):
    x = {"type": "obsm", "key": "X_umap", "column": "0"}
    y = {"type": "obsm", "key": "X_umap", "column": "1"}
    cfgs = {P: {"id": P, "x": x, "y": y, "z": None, "tableFilter": T if linked else "none", "removeNonTableEntries": remove,
                "color": COLOURS[colour]},
            T: {"id": T, "title": "Table 1", "searchText": search,
                "columns": [{"type": "obs", "key": "cell_type", "column": ""}]}}
    tiles = [{"type": "tile", "id": P, "controlsVisible": True}, {"type": "tile", "id": T, "controlsVisible": True}]
    hierarchy = [{"type": "split", "direction": "horizontal", "panes": [{"percentage": 60}, {"percentage": 40}],
                  "children": tiles}]
    view = {"v": 1, "subset": None, "layout": {"v": 1, "hierarchy": hierarchy,
            "controlState": {P: True, T: True}, "panelConfigs": cfgs}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={enc}"


def _wait(page, want, step):
    """The plot reaches `want` (a dict of STATE keys) and stays there."""
    got = None
    for _ in range(300):
        got = page.evaluate(STATE)
        if all(got[k] == v for k, v in want.items()):
            page.wait_for_timeout(400)
            got = page.evaluate(STATE)
            if all(got[k] == v for k, v in want.items()):
                return got
        page.wait_for_timeout(100)
    raise AssertionError(f"{step}: wanted {want}, the plot shows {got}")


def _open(page, url, colour=None):
    page.goto(url)
    page.wait_for_selector(f'.tile[data-tile-id="{T}"] .dataTables_scrollBody tbody tr', timeout=30000)
    if colour == "none":
        # a link without a colour column gets the dataset's default colouring: pick "none" in the panel
        page.select_option(f"{PLOT} select.axis-type-select[data-axis='color']", "none")
        page.wait_for_function("(sel) => { const g = document.querySelector(sel + ' .js-plotly-plot');"
                               " return !!g && g.data.filter(t => t.x && t.x.length > 1 && !/^focused/i.test(t.name || '')).length === 1"
                               " && g.data.every(t => t.meta !== 'az-legend'); }", arg=PLOT, timeout=30000)


def _expect_empty(remove=None):
    """What a filter that no cell passes looks like."""
    if remove:
        return {"inTable": 0, "grey": 0, "placeholder": SAY}
    return {"inTable": 0, "grey": N, "greyOk": True, "tag": "No cells pass"}


@pytest.mark.parametrize("remove", [False, True], ids=["greyed", "removed"])
@pytest.mark.parametrize("colour", list(COLOURS))
def test_live_change_to_no_passing_cell(page, server, colour, remove):
    _open(page, _link(server, colour, remove), colour)
    _wait(page, {"inTable": N // 2}, "40 rows pass")
    page.fill(SEARCH, NONE)
    got = _wait(page, _expect_empty(remove), "search passes nothing")
    if remove:
        assert "Stop filtering" in got["actions"], got
    # and back: the cells come back, no state of "no cell passes" is left
    page.fill(SEARCH, SOME)
    _wait(page, {"inTable": N // 2, "placeholder": None, "tag": None}, "search passes cells again")


POINT_COLOURS = """() => { const gd = document.querySelector('%s .js-plotly-plot');
    const out = []; if (!gd || !gd.data) return out;
    for (const t of gd.data) if (t.x && t.x.length > 1 && !/^focused/i.test(t.name || '') && t.meta !== 'az-legend')
        out.push({ name: t.name, n: t.x.length, colour: typeof t.marker.color === 'string' ? t.marker.color : null }); return out; }""" % PLOT


@pytest.mark.parametrize("remove", [False, True], ids=["greyed", "removed"])
def test_no_point_keeps_the_colour_of_cells_that_pass(page, server, remove):
    """The reported defect itself: after a live change to 0 passing rows (constant colour), the
    excluded cells were drawn in the colour of the cells that pass (2,583 points in #1f77b4)."""
    # the reviewer's route: the table already searched, the plot linked to it from its Table control
    _open(page, _link(server, "none", remove, linked=False), "none")
    page.select_option(f"#table-filter-{P}", T)
    _wait(page, {"inTable": N // 2}, "100 rows pass")
    in_table = [t["colour"] for t in page.evaluate(POINT_COLOURS) if t["name"] != "Not in table"]
    assert in_table and None not in in_table, in_table
    page.fill(SEARCH, NONE)
    page.wait_for_function("(sel) => document.querySelector(sel + ' .dataTables_info').textContent.includes('0 to 0 of 0')"
                           " || document.querySelector(sel + ' .dataTables_empty')", arg=f'.tile[data-tile-id="{T}"]')
    page.wait_for_timeout(3000)
    drawn = page.evaluate(POINT_COLOURS)
    assert not [t for t in drawn if t["colour"] in in_table], (in_table, drawn)
    assert sum(t["n"] for t in drawn) == (0 if remove else N), drawn


@pytest.mark.parametrize("remove", [False, True], ids=["greyed", "removed"])
@pytest.mark.parametrize("colour", list(COLOURS))
def test_fresh_draw_with_no_passing_cell(page, server, colour, remove):
    _open(page, _link(server, colour, remove, search=NONE))
    got = _wait(page, _expect_empty(remove), "fresh draw")
    if remove:
        assert "Stop filtering" in got["actions"], got
    page.fill(SEARCH, SOME)
    _wait(page, {"inTable": N // 2, "placeholder": None, "tag": None}, "search passes cells")


@pytest.mark.parametrize("start", [True, False], ids=["removed-first", "greyed-first"])
def test_toggling_removal_while_no_cell_passes(page, server, start):
    """Greyed and removed swap while the filter passes nothing: each shows its own state."""
    _open(page, _link(server, "category", start, search=NONE))
    _wait(page, _expect_empty(start), "fresh draw")
    page.click(f"#remove-non-table-entries-{P}")
    _wait(page, _expect_empty(not start), "toggled once")
    page.click(f"#remove-non-table-entries-{P}")
    _wait(page, _expect_empty(start), "toggled twice")


def test_stop_filtering_draws_every_cell(page, server):
    _open(page, _link(server, "category", True, search=NONE))
    _wait(page, _expect_empty(True), "fresh draw")
    page.click(f"{PLOT} [data-ps-action='table-filter-off']")
    _wait(page, {"inTable": N, "placeholder": None}, "after Stop filtering")


@pytest.mark.parametrize("colour", ["none", "category"])
def test_large_plot_with_no_passing_cell_draws_its_own_colour(page, large_server, colour):
    """Table filters are not applied in large-plot mode: every cell, never the table colour of a filter."""
    page.goto(_link(large_server, colour, False, search=NONE))   # the table cannot list this many cells
    page.wait_for_function("(sel) => { const g = document.querySelector(sel + ' .js-plotly-plot'); return !!(g && g.__isLarge); }",
                           arg=PLOT, timeout=30000)
    until(page, """(sel) => { const g = document.querySelector(sel + ' .js-plotly-plot');
        return g.data.filter(t => t.meta === 'az-points').reduce((s, t) => s + t.x.length, 0) === %d; }""" % N, PLOT)
    got = page.evaluate("""(sel) => { const g = document.querySelector(sel + ' .js-plotly-plot');
        return { greyed: g.data.some(t => t.name === 'Not in table'),
                 tag: [...document.querySelectorAll(sel + ' .ps-tag')].map(e => e.textContent.trim()) }; }""", PLOT)
    assert not got["greyed"], got
    assert "Large plot" in got["tag"], got
