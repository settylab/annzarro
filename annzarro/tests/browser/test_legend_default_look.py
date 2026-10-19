"""The legend with no legend option set looks as it did in v0.6.0 (but for its title), and switching it off and on is quick.

The expectations below were measured on v0.6.0 (the same fixture, window and browser): the legend's layout
settings, the room it takes (the plot area's margins), and the geometry of its box and entries. The legend
options of v0.6.1 (dot size, columns, title) must leave all of it alone while unset. A change of Plotly's
or the app's layout is a change of these numbers: measure the new look (LEGEND_MEASURE=1 pytest -s), then change them
on purpose. The one deliberate change since v0.6.0 is the title: above the entries at every position, starting where
the labels start, with a line below it (test_legend_title.py); only the box, margins and first entry's place moved.

Switching the legend off and on is a layout change plus nothing per trace: it was one restyle for each of the
~70 traces of a plot with ~35 categories, a second at 1M points. The count of Plotly calls guards that.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1 (set in CI).
"""
import json
import os

import pytest

from annzarro.tests.browser.test_plot_options import (  # noqa: F401  (fixtures and helpers)
    A, B, DRAWN, GD, _cfgs, _link, _menu, page, server)
from annzarro.tests.browser import test_many_categories as M  # noqa: E402
from annzarro.tests.browser.test_many_categories import server as many_server  # noqa: F401  (the fixture)

GEOMETRY = """(id) => { const gd = (%s)(id); const L = gd._fullLayout, lg = L.legend;
    const r = (e) => { const b = e.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; };
    const g = gd.getBoundingClientRect();
    const items = [...gd.querySelectorAll('.legend g.traces')].map(e => e.getBoundingClientRect());
    return { layout: { orientation: lg.orientation, x: lg.x, y: Math.round(lg.y * 1000) / 1000, xanchor: lg.xanchor, yanchor: lg.yanchor,
                       itemsizing: lg.itemsizing, tracegroupgap: lg.tracegroupgap, entrywidth: lg.entrywidth || null,
                       traceorder: lg.traceorder, titleSide: lg.title && lg.title.side, itemwidth: lg.itemwidth },
             margins: { l: L._size.l, r: L._size.r, t: L._size.t, b: L._size.b },
             box: r(gd.querySelector('.legend .bg')), symbol: r(gd.querySelector('.legend .scatterpts')),
             entries: items.length, entryH: Math.round(items[0].height),
             pitch: items.length > 1 ? Math.round((items[1].y - items[0].y) * 10) / 10 : null,
             firstX: Math.round(items[0].x - g.x), firstY: Math.round(items[0].y - g.y) }; }""" % GD

# v0.6.0, the fixture's 200 cells coloured by cell type (3 categories), a 1500 x 1000 window
EXPECTED = {
    "right": {"layout": {"orientation": "v", "x": 1.05, "y": 0.5, "xanchor": "left", "yanchor": "middle", "itemsizing": "constant", "tracegroupgap": 10, "entrywidth": None, "traceorder": "grouped", "titleSide": "top", "itemwidth": 30}, "margins": {"l": 80, "r": 144, "t": 80, "b": 60}, "box": {"w": 106, "h": 124}, "symbol": {"w": 12, "h": 12}, "entries": 3, "entryH": 19, "pitch": 29, "firstX": 628, "firstY": 232},
    "left": {"layout": {"orientation": "v", "x": -0.05, "y": 0.5, "xanchor": "right", "yanchor": "middle", "itemsizing": "constant", "tracegroupgap": 10, "entrywidth": None, "traceorder": "grouped", "titleSide": "top", "itemwidth": 30}, "margins": {"l": 144, "r": 80, "t": 80, "b": 60}, "box": {"w": 106, "h": 124}, "symbol": {"w": 12, "h": 12}, "entries": 3, "entryH": 19, "pitch": 29, "firstX": 12, "firstY": 232},
    "top": {"layout": {"orientation": "h", "x": 0.5, "y": 1, "xanchor": "center", "yanchor": "bottom", "itemsizing": "constant", "tracegroupgap": 10, "entrywidth": None, "traceorder": "grouped", "titleSide": "top", "itemwidth": 30}, "margins": {"l": 80, "r": 80, "t": 80, "b": 60}, "box": {"w": 294, "h": 66}, "symbol": {"w": 12, "h": 12}, "entries": 3, "entryH": 19, "pitch": 0, "firstX": 226, "firstY": 55},
    "bottom": {"layout": {"orientation": "h", "x": 0.5, "y": -0.236, "xanchor": "center", "yanchor": "top", "itemsizing": "constant", "tracegroupgap": 10, "entrywidth": None, "traceorder": "grouped", "titleSide": "top", "itemwidth": 30}, "margins": {"l": 80, "r": 80, "t": 80, "b": 141}, "box": {"w": 294, "h": 66}, "symbol": {"w": 12, "h": 12}, "entries": 3, "entryH": 19, "pitch": 0, "firstX": 226, "firstY": 449},
}


def _geometry(page, position):
    page.goto(_link(server_root(page), _cfgs(extra_a={"legendPosition": position})))
    for pid in (A, B):
        page.wait_for_function(DRAWN, arg=pid, timeout=60000)
    page.wait_for_function("(id) => (%s)(id).querySelectorAll('.legend g.traces').length === 3" % GD, arg=A, timeout=30000)
    page.wait_for_timeout(1500)
    return page.evaluate(GEOMETRY, A)


def server_root(page):
    return page._azroot


@pytest.mark.parametrize("position", ["right", "left", "top", "bottom"])
def test_the_default_legend_looks_as_in_v060(page, server, position):
    page._azroot = server
    got = _geometry(page, position)
    if not EXPECTED or os.environ.get("LEGEND_MEASURE"):
        print("MEASURED", position, json.dumps(got))
        return
    want = EXPECTED[position]
    assert got["layout"] == want["layout"], got["layout"]
    assert got["margins"] == want["margins"], got["margins"]
    for key in ("symbol", "entries", "entryH", "pitch"):
        assert got[key] == want[key], (key, got[key], want[key])
    for key in ("box", "firstX", "firstY"):
        assert got[key] == pytest.approx(want[key], abs=2), (key, got[key], want[key])


PLOT_M = """document.querySelector('.tile[data-tile-id="cell-plot-M"] .js-plotly-plot')"""
TOGGLE = """async (id) => {
    const gd = (%s)(id);
    const calls = [];
    const wrapped = {};
    for (const f of ['relayout', 'restyle', 'react', 'redraw', 'update', 'addTraces', 'deleteTraces']) {
        wrapped[f] = Plotly[f];
        Plotly[f] = function () { calls.push(f); return wrapped[f].apply(this, arguments); };
    }
    const box = document.getElementById('show-legend-' + id);
    const out = { traces: gd.data.length, ms: {} };
    try {
        for (const on of [false, true, false, true]) {
            const before = calls.length, t0 = performance.now();
            box.checked = on; box.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise(res => { const poll = () => ((!!gd.querySelector('.legend g.traces')) === on ? res() : setTimeout(poll, 5)); poll(); });
            out.ms[on ? 'on' : 'off'] = Math.max(out.ms[on ? 'on' : 'off'] || 0, Math.round(performance.now() - t0));
            out.calls = Math.max(out.calls || 0, calls.length - before);
            await new Promise(res => setTimeout(res, 300));
        }
    } finally { Object.assign(Plotly, wrapped); }
    return out;
}""" % GD


def test_switching_the_legend_off_and_on_does_not_touch_every_trace(page, many_server):
    """64 colour groups are ~128 traces. The switch is a few Plotly calls, not one per trace (it was ~70 restyles)."""
    root, store = many_server
    page.goto(M._link(root, store, colour="clone"))
    page.wait_for_function("() => { const gd = " + PLOT_M + "; return !!gd && gd.querySelectorAll('.legend g.traces').length === 64; }", timeout=60000)
    page.wait_for_timeout(1500)
    page.click("#aesthetics-menu-btn-cell-plot-M")
    page.wait_for_selector("details[data-panel='cell-plot-M']", state="visible")
    page.click("details[data-panel='cell-plot-M'][data-section='legend'] summary")
    page.wait_for_timeout(300)
    got = page.evaluate(TOGGLE.replace("(%s)(id)" % GD, PLOT_M), "cell-plot-M")
    assert got["traces"] >= 100, got
    assert got["calls"] <= 6, got                      # a layout change or two, whatever the number of traces
    assert max(got["ms"].values()) < 2000, got         # generous: ~50 ms measured; the per-trace version took a second at 1M points
