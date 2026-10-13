"""A category hidden with the legend cannot be hovered or clicked in large-plot mode.

The committed 200-cell fixture is served with ``ui.defaults.large_plot_points``
lowered to 100 and coloured by cell_type, so the large plot has a legend. The
point index holds every drawn point; hiding a category (a legend click sets its
traces to 'legendonly') must take its points out of the lookup: over a place
where only hidden points are, hover shows nothing and a click focuses nothing.
"""
import base64
import json
import urllib.parse

import pytest

from annzarro.tests.browser.test_large_plot_subset_roundtrip import STORE, server, GD, playwright  # noqa: F401


def _link(root):
    plot = {"id": "cell-plot-a", "title": "A", "pointSize": 12, "pointOpacity": 1,
            "x": {"type": "obsm", "key": "X_umap", "column": "0"},
            "y": {"type": "obsm", "key": "X_umap", "column": "1"},
            "color": {"type": "obs", "key": "cell_type", "column": ""}}
    view = {"v": 1, "subset": None,
            "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": "cell-plot-a", "controlsVisible": True}],
                       "controlState": {"cell-plot-a": True}, "panelConfigs": {"cell-plot-a": plot}}}
    enc = base64.urlsafe_b64encode(json.dumps(view, separators=(",", ":")).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={enc}"


@pytest.fixture
def page(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1400, "height": 900})
            page.errors = []
            page.on("pageerror", lambda e: page.errors.append(str(e)))
            yield page
            assert not page.errors, page.errors
        finally:
            browser.close()


READY = """() => { const g = document.querySelector('%s');
  return !!(g && g.__isLarge && g._fullLayout && g.__largeState && g.__largeState.index); }""" % GD

# A category, and one of its points with no point of another category within 40 px of it
SPOT = """() => {
    const g = document.querySelector('%s');
    const xa = g._fullLayout.xaxis, ya = g._fullLayout.yaxis;
    const r = g.querySelector('.nsewdrag').getBoundingClientRect();
    const pts = [];
    for (const t of g.data) {
        if (!t.legendgroup || t.showlegend || !t.x || !t.x.length) continue;
        for (let i = 0; i < t.x.length; i++) pts.push({group: t.legendgroup, px: xa.l2p(t.x[i]), py: ya.l2p(t.y[i])});
    }
    for (const a of pts) {
        if (pts.every(b => b.group === a.group || Math.hypot(b.px - a.px, b.py - a.py) >= 40)) {
            return {group: a.group, x: r.left + a.px, y: r.top + a.py};
        }
    }
    return null;
}""" % GD

TIP = "() => { const t = document.querySelector('.large-plot-tip'); return !!t && getComputedStyle(t).display !== 'none'; }"


def _move_to(page, x, y):
    page.mouse.move(x - 60, y - 60)
    page.mouse.move(x, y, steps=6)
    page.wait_for_timeout(600)


def test_hidden_category_is_not_hoverable_or_clickable(page, server):
    page.goto(_link(server))
    page.wait_for_function(READY, timeout=60000)
    spot = page.evaluate(SPOT)
    assert spot, "no point of a category with no other category within 40 px"

    # visible: the hover finds it
    _move_to(page, spot["x"], spot["y"])
    assert page.evaluate(TIP), "the visible point is not hoverable"

    # hide its category with the legend, as a user does; the view stays (hiding would otherwise rescale the axes)
    page.evaluate("""async (group) => {
        const g = document.querySelector('%s');
        await Plotly.relayout(g, {'xaxis.range': g._fullLayout.xaxis.range.slice(), 'yaxis.range': g._fullLayout.yaxis.range.slice()});
        const item = Array.from(g.querySelectorAll('.legend .traces')).find(n => n.textContent.trim() === group);
        item.querySelector('.legendtoggle').dispatchEvent(new MouseEvent('mouseup', {bubbles: true}));
    }""" % GD, spot["group"])
    page.wait_for_function("""(group) => { const g = document.querySelector('%s');
        return g.data.some(t => t.legendgroup === group && t.visible === 'legendonly'); }""" % GD, arg=spot["group"], timeout=10000)

    # where only its hidden points are: nothing to hover, nothing to focus
    page.mouse.move(spot["x"] + 300, spot["y"] + 200)
    page.wait_for_timeout(300)
    _move_to(page, spot["x"], spot["y"])
    assert not page.evaluate(TIP), "a hidden point shows the large-plot tooltip"
    page.mouse.down()
    page.mouse.up()
    page.wait_for_timeout(600)
    assert not page.evaluate(TIP)
    assert page.evaluate("() => { const s = document.querySelector('%s').__largeState; return s.lastFocus; }" % GD) is None, \
        "a click focused a hidden point"
