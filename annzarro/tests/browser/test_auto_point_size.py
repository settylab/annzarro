"""Automatic point size follows the points drawn, in every cell plot.

Two cell plots filtered by one cell table, on the 200-cell fixture, with the
rows the table hides removed from the plots, or only greyed out (then only
the points shown in full count; the grey ones, drawn behind, keep the style
of all 200 points). The shipped curve does not move
below a few thousand points, so the page gets a steep one (a route replaces
AUTO_CURVE's size constants): then 200, 100 and 60 points draw at different
sizes. The size of each plot must equal the curve's value for the points
that plot draws in its own plot area (the two plots differ in width),
after every way of changing them:

1. the table's search narrows its rows (the table path: plots filtered by a
   table, rows removed): both plots follow it;
2. a smaller subset from the subset dialog on top of that: both follow;
3. the search cleared and every cell back: both are back at the size for 200.

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

PLOTS = ("cell-plot-A", "cell-plot-B")
TABLE = "cell-table-T"
# size constants of AUTO_CURVE, and a steep curve in their place. Its nHalf
# is 100, not 10: these plots are small panes, whose plot area counts their
# points up to 8 times over (point-style.js AREA_RANGE), and with 10 the
# sizes for 200 and 100 points both fell to the same scattergl step.
STEEP = ("nHalf: 6000, exponent: 0.3", "nHalf: 100, exponent: 0.5")


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    root, proc = _serve(tmp_path_factory)
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture
def page(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1500, "height": 1000})

            def steep(route):
                body = route.fetch().text()
                assert STEEP[0] in body, "AUTO_CURVE size constants changed: update STEEP"
                route.fulfill(body=body.replace(*STEEP), content_type="text/javascript")

            page.route("**/utils/point-style.js*", steep)
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            yield page
            assert not errors, errors
        finally:
            browser.close()


def _link(root, remove=True):
    x = {"type": "obsm", "key": "X_umap", "column": "0"}
    y = {"type": "obsm", "key": "X_umap", "column": "1"}
    cfgs = {p: {"id": p, "x": x, "y": y, "z": None, "tableFilter": TABLE, "removeNonTableEntries": remove,
                "color": {"type": "obs", "key": "cell_type", "column": ""}} for p in PLOTS}
    cfgs[TABLE] = {"id": TABLE, "title": "Table",
                   "columns": [{"type": "obs", "key": "cell_type", "column": ""}]}
    tiles = [{"type": "tile", "id": i, "controlsVisible": True} for i in (*PLOTS, TABLE)]
    pair = {"type": "split", "direction": "horizontal", "panes": [{"percentage": 50}, {"percentage": 50}],
            "children": tiles[1:]}
    hierarchy = [{"type": "split", "direction": "horizontal", "panes": [{"percentage": 35}, {"percentage": 65}],
                  "children": [tiles[0], pair]}]
    view = {"v": 1, "subset": None, "layout": {"v": 1, "hierarchy": hierarchy,
            "controlState": {i["id"]: True for i in tiles}, "panelConfigs": cfgs}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={enc}"


STATE = """() => Object.fromEntries(%s.map(id => {
    const gd = document.querySelector(`.tile[data-tile-id="${id}"] .js-plotly-plot`);
    const pts = gd && gd.data ? gd.data.filter(t => t.meta !== 'az-legend' && t.meta !== 'az-colorbar'
        && !/^focused/i.test(t.name || '') && t.name !== 'Not in table' && t.x && t.x.length > 1) : [];
    const grey = gd && gd.data ? gd.data.filter(t => t.name === 'Not in table' && t.meta !== 'az-legend' && t.x) : [];
    return [id, { n: pts.reduce((s, t) => s + t.x.length, 0),
                  grey: grey.reduce((s, t) => s + t.x.length, 0),
                  greySizes: [...new Set(grey.map(t => t.marker && t.marker.size))],
                  sizes: [...new Set(pts.map(t => t.marker && t.marker.size))],
                  opacities: [...new Set(pts.map(t => t.marker && t.marker.opacity))] }];
}))""" % json.dumps(list(PLOTS))

# the automatic style for n points in each plot's own plot area
AUTO = """async ([n, ids]) => {
    const { autoPointStyle } = await import('/static/js/utils/point-style.js');
    const { plotArea } = await import('/static/js/utils/view-point-style.js');
    const { pointStyleBase } = await import('/static/js/panels/plot-utilities/plot-make.js');
    return Object.fromEntries(ids.map(id => [id, autoPointStyle(n, pointStyleBase(), false,
        plotArea(document.querySelector(`.tile[data-tile-id="${id}"] .js-plotly-plot`)))]));
}"""


def _settled(page, n):
    """Wait until both plots draw n points, then return their state."""
    end_state = {}

    def ready():
        s = page.evaluate(STATE)
        end_state.update(s)
        return all(v["n"] == n for v in s.values())
    for _ in range(300):
        if ready():
            break
        page.wait_for_timeout(100)
    else:
        raise AssertionError(f"plots do not draw {n} points: {end_state}")
    page.wait_for_timeout(600)   # the styling step runs with the draw; let it finish
    return page.evaluate(STATE)


def _check(page, n):
    s = _settled(page, n)
    wants = page.evaluate(AUTO, [n, list(PLOTS)])
    for pid, v in s.items():
        want = wants[pid]
        assert v["sizes"] == [want["size"]], (pid, n, v, want)
        assert v["opacities"] == [want["opacity"]], (pid, n, v, want)
    return wants


def test_automatic_size_follows_table_filter_and_subset_in_every_plot(page, server):
    page.goto(_link(server))
    page.wait_for_selector(f'.tile[data-tile-id="{TABLE}"] .dataTables_scrollBody tbody tr', timeout=30000)
    full = _check(page, 200)

    # 1. the table's search: its 100 rows are all the plots keep
    page.fill(f'.tile[data-tile-id="{TABLE}"] input[type="search"]', "cell_01")
    narrowed = _check(page, 100)
    assert all(narrowed[p]["size"] != full[p]["size"] for p in PLOTS), (narrowed, full)

    # 2. a smaller subset, on top of the table's search
    page.click("#subset-button")
    page.wait_for_selector("#subset-apply", state="visible")
    page.click('#subset-presets button[data-n="100"]')
    page.wait_for_function("() => !document.getElementById('subset-apply').disabled")
    page.click("#subset-apply")
    page.wait_for_selector("#subset-modal", state="hidden")
    page.wait_for_timeout(1500)
    drawn = page.evaluate(STATE)
    n = {v["n"] for v in drawn.values()}
    assert len(n) == 1 and 0 < n.pop() < 100, drawn         # both plots hold the same fewer points
    n = drawn[PLOTS[0]]["n"]
    fewer = _check(page, n)
    assert all(fewer[p]["size"] != narrowed[p]["size"] for p in PLOTS)

    # 3. everything back
    page.click("#subset-button")
    page.wait_for_selector("#subset-apply", state="visible")
    page.click("#subset-preset-all")
    page.wait_for_function("() => !document.getElementById('subset-apply').disabled")
    page.click("#subset-apply")
    page.wait_for_selector("#subset-modal", state="hidden")
    page.fill(f'.tile[data-tile-id="{TABLE}"] input[type="search"]', "")
    assert _check(page, 200) == full


def test_greyed_out_points_do_not_count_and_stay_behind(page, server):
    page.goto(_link(server, remove=False))
    page.wait_for_selector(f'.tile[data-tile-id="{TABLE}"] .dataTables_scrollBody tbody tr', timeout=30000)
    full = _check(page, 200)

    # the table's search greys 100 rows out: 100 points in full, 100 grey
    page.fill(f'.tile[data-tile-id="{TABLE}"] input[type="search"]', "cell_01")
    narrowed = _check(page, 100)
    assert all(narrowed[p]["size"] != full[p]["size"] for p in PLOTS), (narrowed, full)
    for pid, v in page.evaluate(STATE).items():
        assert v["grey"] == 100, (pid, v)
        # the grey ones follow the curve for their own 100 points, behind the others
        assert v["greySizes"] == [narrowed[pid]["size"]], (pid, v, narrowed)

    page.fill(f'.tile[data-tile-id="{TABLE}"] input[type="search"]', "")
    assert _check(page, 200) == full
