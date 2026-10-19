"""The Bare preset draws nothing but the points: the plot area is the whole graph and no axis, tick, grid,
legend, colour bar, annotation or scale bar element is left. Default undoes it.

Checked on what is drawn: the drawn plot area against the graph's own size (to 1 px), and a list of every kind
of element a graph can carry around its points, which must be absent or empty. In 3D (drawn by WebGL, no SVG
to list) the scene's axes are hidden, which takes their lines, ticks, labels, grid and background planes.
The preset travels with the panel (saved layout, link, Apply to other panels) like the others.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1 (set in CI).
"""
import json

import pytest

from annzarro.tests.browser.test_axis_title_restore import _start
from annzarro.tests.browser.test_plot_options import (  # noqa: F401  (fixtures and helpers)
    A, B, DRAWN, GD, _cfgs, _link, _menu, _settings, page, server)

# what is left in the graph besides the points (an axis line with no length is 'M0,0': nothing drawn)
DRAWN_THINGS = """(id) => { const gd = (%s)(id); const L = gd._fullLayout, box = gd.getBoundingClientRect();
    const not = (sel) => [...gd.querySelectorAll(sel)].filter(e => !e.closest('.modebar'));
    const text = (sel) => not(sel).filter(e => (e.textContent || '').trim() !== '');
    return {
        size: { l: L._size.l, r: L._size.r, t: L._size.t, b: L._size.b, w: L._size.w, h: L._size.h },
        graph: { w: Math.round(box.width), h: Math.round(box.height), fullW: L.width, fullH: L.height },
        ticks: not('.xtick, .ytick, .xtick2, .ytick2').length,
        grid: not('.gridlayer path, .minor-gridlayer path, .zerolinelayer path').length,
        axisLayers: not('.xaxislayer-above *, .yaxislayer-above *, .xaxislayer-below *, .yaxislayer-below *').length,
        axisLines: not('path.xlines-above, path.ylines-above, path.xlines-below, path.ylines-below').filter(p => !['', 'M0,0'].includes(p.getAttribute('d') || '')).length,
        titles: not('.g-xtitle, .g-ytitle, .g-gtitle').filter(e => e.textContent.trim() !== '' || e.querySelector('text')).length,
        legend: not('.legend').length, colourBar: not('.colorbar, .cbaxis').length, annotations: not('.annotation, .annotation-text-g').length,
        // the focused cell's ring is data, not decoration
        shapes: (gd.layout.shapes || []).filter(s => s.name !== 'Focused Cell').length, infoText: text('.infolayer').length,
        scene: L.scene ? ['xaxis', 'yaxis', 'zaxis'].map(a => L.scene[a].visible) : null,
        showlegend: L.showlegend, mirror: L.xaxis ? [L.xaxis.mirror, L.yaxis.mirror, L.xaxis.showspikes, L.yaxis.showspikes] : null,
        points: gd.data.filter(t => t.x && t.x.length > 1).length }; }""" % GD


def _open(page, root, a=None, b=None, three=False):
    page.goto(_link(root, _cfgs(extra_a=a, extra_b=b)))
    page.wait_for_function(DRAWN, arg=B, timeout=60000)
    if three:
        page.wait_for_function("(id) => { const gd = (%s)(id); return !!(gd && gd._fullLayout && gd._fullLayout.scene && gd.data.length > 1); }" % GD,
                               arg=A, timeout=60000)
    else:
        page.wait_for_function(DRAWN, arg=A, timeout=60000)
    page.wait_for_timeout(1500)


def _preset(page, pid, name):
    _menu(page, pid, "presets")
    page.click(f"#preset-{name}-{pid}")
    page.wait_for_timeout(2000)


def _assert_bare(t, three=False):
    assert t["points"] >= 1, t
    assert t["legend"] == t["colourBar"] == t["annotations"] == t["shapes"] == t["infoText"] == 0, json.dumps(t)
    if three:
        assert t["scene"] == [False, False, False], t        # no axes, ticks, grid or background planes
        return
    assert t["size"]["l"] == t["size"]["r"] == t["size"]["t"] == t["size"]["b"] == 0, t      # no margin, no room for text
    assert abs(t["size"]["w"] - t["graph"]["w"]) <= 1 and abs(t["size"]["h"] - t["graph"]["h"]) <= 1, t   # the plot is the graph
    assert t["ticks"] == t["grid"] == t["axisLayers"] == t["axisLines"] == t["titles"] == 0, json.dumps(t)
    assert not any(t["mirror"][:2]) and t["mirror"][2:] == [False, False], t                 # no mirror lines, no spikes


@pytest.mark.parametrize("panel,extra", [(B, None), (A, None)], ids=["colour-bar-plot", "legend-plot-equal-aspect"])
def test_bare_leaves_only_the_points_in_2d_and_default_restores_it(page, server, panel, extra):
    _open(page, server)
    before = page.evaluate(DRAWN_THINGS, panel)
    assert before["ticks"] > 0 and before["size"]["l"] > 0 and (before["legend"] or before["colourBar"]), before
    _preset(page, panel, "bare")
    _assert_bare(page.evaluate(DRAWN_THINGS, panel))
    s = _settings(page, panel)
    assert s["bare"] is True and s["margins"]["l"] == 0 and s["showLegend"] is False, s
    _preset(page, panel, "default")
    after = page.evaluate(DRAWN_THINGS, panel)
    assert after["ticks"] > 0 and abs(after["size"]["l"] - before["size"]["l"]) <= 1 and (after["legend"] or after["colourBar"]), after
    assert _settings(page, panel)["bare"] is False


def test_bare_in_3d(page, server):
    _open(page, server, a={"z": {"type": "obsm", "key": "X_umap", "column": "0"}, "equalAspect": False}, three=True)
    _preset(page, A, "bare")
    _assert_bare(page.evaluate(DRAWN_THINGS, A), three=True)
    _preset(page, A, "default")
    assert page.evaluate(DRAWN_THINGS, A)["scene"] == [True, True, True]


@pytest.fixture(scope="module")
def large_server(tmp_path_factory):
    proc, root = _start(tmp_path_factory.mktemp("home"), 100)
    yield root
    proc.terminate()
    proc.wait(10)


def test_bare_in_large_plot_mode(page, large_server):
    _open(page, large_server)
    assert page.evaluate("(id) => !!(%s)(id).__isLarge" % GD, B)
    _preset(page, B, "bare")
    _assert_bare(page.evaluate(DRAWN_THINGS, B))


def test_bare_travels_with_the_panel_and_to_other_plots(page, server):
    _open(page, server)
    _preset(page, A, "bare")
    saved = _settings(page, A)
    # opened from the saved settings: the first draw is the bare plot
    page.goto(_link(server, _cfgs(extra_a={k: saved[k] for k in ("bare", "margins", "showLegend", "showGrid", "showAxisLabels", "showAxisTitles", "showAxisLines", "showTickMarks", "showZeroLines")})))
    page.wait_for_function(DRAWN, arg=A, timeout=60000)
    page.wait_for_timeout(1500)
    _assert_bare(page.evaluate(DRAWN_THINGS, A))
    # Apply to other panels: the other cell plot becomes bare too
    _menu(page, A, "apply")
    page.click(f"#apply-others-{A}")
    page.click(f"#apply-others-yes-{A}")
    page.wait_for_function("(id) => (%s)(id)._fullLayout.xaxis.visible === false" % GD, arg=B, timeout=15000)
    page.wait_for_timeout(1000)
    _assert_bare(page.evaluate(DRAWN_THINGS, B))
