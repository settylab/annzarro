"""The "Not in table" points: size from their own count, own controls, no legend entry.

Cell plots filtered by a cell table, rows the table hides greyed out (not
removed). Their style is derived one way, whichever way the table came to
filter the plot (a link, or picked in the panel): the automatic style of
their own count times the panel's scale, never the main points' size.
The page gets a steep size curve (as test_auto_point_size.py), so 100 and
200 points draw at different sizes. Like every automatic size, the grey
points' size follows the plot area too (utils/point-style.js), so the
expected size is the curve's for their count in that plot's own area.

1. a size set by hand after the table filters the plot leaves the grey
   points at the size for their count (the bug: they kept the size from
   before they were excluded);
2. the table switched on in the panel and a link that names it give the
   same grey points;
3. another count (a subset) re-adjusts them;
4. size scale, opacity and colour from Plot Options change them, survive
   the panel's config (link, copy), and the grey points have no legend item.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import base64
import json
import urllib.parse

from annzarro.tests.browser.test_auto_point_size import (  # noqa: F401  (fixtures)
    AUTO, PLOTS, STATE, TABLE, _link, _settled, page, server)
from annzarro.tests.browser.test_memory_guard import STORE  # noqa: E402

A, B = PLOTS
SEARCH = f'.tile[data-tile-id="{TABLE}"] input[type="search"]'
GREY = """(id) => {
    const gd = document.querySelector(`.tile[data-tile-id="${id}"] .js-plotly-plot`);
    const g = gd.data.filter(t => t.name === 'Not in table' && t.meta !== 'az-legend' && t.x);
    return { n: g.reduce((s, t) => s + t.x.length, 0), sizes: g.map(t => t.marker.size),
             opacities: g.map(t => t.marker.opacity), colors: g.map(t => t.marker.color),
             legend: gd.data.some(t => t.name === 'Not in table' && t.showlegend !== false) };
}"""
SNAP = """async (v) => (await import('/static/js/utils/slider-scales.js')).snapPointSize(v)"""


def _ready(page, root, remove=False, table=True):
    page.goto(_link(root, remove=remove) if table else _link(root, remove=remove).replace("tableFilter", "tf"))
    page.wait_for_selector(f'.tile[data-tile-id="{TABLE}"] .dataTables_scrollBody tbody tr', timeout=30000)
    _settled(page, 200)


def _grey_is_curve(page, pid, scale=1):
    g = None
    for _ in range(50):
        g = page.evaluate(GREY, pid)
        if g["n"]:
            # the curve for their own count, in this plot's own plot area
            want = page.evaluate(AUTO, [g["n"], [pid]])[pid]
            size = page.evaluate(SNAP, want["size"] * scale)
            if g["sizes"] == [size]:
                return g
        page.wait_for_timeout(100)
    raise AssertionError(f"{pid}: grey points {g} are not at the size for their count (scale {scale})")


def _set_size(page, pid, value):
    page.fill(f"#point-size-input-{pid}", str(value))
    page.press(f"#point-size-input-{pid}", "Tab")
    page.wait_for_timeout(500)


def test_manual_size_after_table_leaves_grey_points_at_their_own_size(page, server):
    _ready(page, server)
    page.fill(SEARCH, "cell_01")
    _settled(page, 100)
    before = _grey_is_curve(page, A)
    _set_size(page, A, 3)
    assert page.evaluate(STATE)[A]["sizes"] == [page.evaluate(SNAP, 3)]
    assert _grey_is_curve(page, A)["sizes"] == before["sizes"]       # not the size set for the others
    _set_size(page, A, 1)
    assert _grey_is_curve(page, A)["sizes"] == before["sizes"]


def test_switching_the_table_on_equals_a_link_that_names_it(page, server):
    _ready(page, server)
    page.fill(SEARCH, "cell_01")
    _settled(page, 100)
    linked = _grey_is_curve(page, A)

    _ready(page, server, table=False)
    assert page.evaluate(GREY, A)["n"] == 0
    page.select_option(f"#table-filter-{A}", TABLE)
    page.fill(SEARCH, "cell_01")
    page.wait_for_function("(id) => document.querySelector(`.tile[data-tile-id=\"${id}\"] .js-plotly-plot`)"
                           ".data.some(t => t.name === 'Not in table' && t.x && t.x.length)", arg=A, timeout=30000)
    # settled, as the linked plot is (_settled): the switch changes what the strip above the plot says, the plot area
    # grows, and the automatic style follows the new area once the resize has settled (plot-make.js __azFollowView).
    # Compared before that, the grey points still had the opacity for the old area (0.99 against 1)
    page.wait_for_function("""(id) => { const gd = document.querySelector(`.tile[data-tile-id="${id}"] .js-plotly-plot`);
        const f = gd.__azFollowView; return !!f && !f.pending() && !gd.__azRestyling; }""", arg=A, timeout=30000)
    switched = _grey_is_curve(page, A)
    assert switched == linked


def test_another_count_readjusts_the_grey_points(page, server):
    _ready(page, server)
    page.fill(SEARCH, "cell_01")
    _settled(page, 100)
    first = _grey_is_curve(page, A)
    page.click("#subset-button")
    page.wait_for_selector("#subset-apply", state="visible")
    page.click('#subset-presets button[data-n="100"]')
    page.wait_for_function("() => !document.getElementById('subset-apply').disabled")
    page.click("#subset-apply")
    page.wait_for_selector("#subset-modal", state="hidden")
    page.wait_for_timeout(1500)
    second = _grey_is_curve(page, A)
    assert second["n"] != first["n"] and second["sizes"] != first["sizes"], (first, second)


def test_controls_style_the_grey_points_and_travel_with_the_panel(page, server):
    _ready(page, server)
    page.fill(SEARCH, "cell_01")
    _settled(page, 100)
    base = _grey_is_curve(page, A)
    assert not base["legend"] and base["colors"] == ["#b4b4b4"]
    page.click(f"#aesthetics-menu-btn-{A}")
    page.click(f"details[data-panel='{A}'][data-section='points'] > summary")     # the Points group, folded at first
    page.wait_for_selector(f"#not-in-table-scale-{A}", state="visible")
    # automatic opacity: the box shows what is drawn (so the arrows step from it) and stores nothing until changed
    shown = float(page.input_value(f"#not-in-table-opacity-{A}"))
    assert shown == round(base["opacities"][0], 2), (shown, base["opacities"])
    assert "notInTableOpacity" not in page.evaluate("() => window.PanelManager.saveLayout().panelConfigs['%s']" % A)
    page.fill(f"#not-in-table-scale-{A}", "2")
    _grey_is_curve(page, A, scale=2)
    page.fill(f"#not-in-table-opacity-{A}", "0.25")
    page.fill(f"#not-in-table-color-{A}", "#ff0000")
    page.wait_for_function("""(id) => { const g = document.querySelector(`.tile[data-tile-id="${id}"] .js-plotly-plot`)
        .data.find(t => t.name === 'Not in table'); return g.marker.opacity === 0.25 && g.marker.color === '#ff0000'; }""",
                           arg=A, timeout=10000)
    # B was not touched
    assert _grey_is_curve(page, B)["colors"] == base["colors"]
    # the panel's config carries them: saved layout, then a link made from it
    layout = page.evaluate("() => window.PanelManager.saveLayout()")
    cfg = layout["panelConfigs"][A]
    assert (cfg["notInTableScale"], cfg["notInTableOpacity"], cfg["notInTableColor"]) == (2, 0.25, "#ff0000")
    assert "notInTableScale" not in layout["panelConfigs"][B]            # B keeps the defaults
    enc = base64.urlsafe_b64encode(json.dumps({"v": 1, "subset": None, "layout": layout}).encode()).decode().rstrip("=")
    # Only the fragment changes, so the page reloads itself (main.js hashchange); a second reload of ours
    # raced it and, while the first was still drawing this view, hit the guard that never redraws a view
    # that did not finish loading ("The view in the address did not finish loading last time"). Wait for
    # the page's own reload instead.
    with page.expect_event("load", timeout=30000):
        page.goto(f"{server}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={enc}")
    page.wait_for_selector(f'.tile[data-tile-id="{TABLE}"] .dataTables_scrollBody tbody tr', timeout=30000)
    page.fill(SEARCH, "cell_01")
    page.wait_for_function("""(id) => { const g = document.querySelector(`.tile[data-tile-id="${id}"] .js-plotly-plot`)
        ?.data?.find(t => t.name === 'Not in table'); return g && g.marker.opacity === 0.25 && g.marker.color === '#ff0000'; }""",
                           arg=A, timeout=30000)
    _grey_is_curve(page, A, scale=2)
