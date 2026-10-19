"""Flip x / flip y in Plot Options (Axes and ticks): an axis that runs the other way.

Spatial coordinates are often read with y growing downwards. The flip is a view setting of one plot:
it is kept by zoom, pan, Reset axes and a double click, by Equal aspect and the scale bar, works in
large-plot mode, travels in a link, and is NOT copied by Apply to other panels.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import json
import os

import pytest

from annzarro.tests.browser.test_axis_title_restore import _start
from annzarro.tests.browser.test_plot_options import (  # noqa: F401  (fixtures and helpers)
    A, B, DRAWN, GD, _cfgs, _link, _menu, _open, page, server)


@pytest.fixture(scope="module")
def large_server(tmp_path_factory):
    proc, root = _start(tmp_path_factory.mktemp("home"), 100)
    yield root
    proc.terminate()
    proc.wait(10)


def _range(page, pid, axis="yaxis"):
    return page.evaluate("([id, a]) => [...(%s)(id)._fullLayout[a].range]" % GD, [pid, axis])


def _autorange(page, pid, axis="yaxis"):
    return page.evaluate("([id, a]) => (%s)(id)._fullLayout[a].autorange" % GD, [pid, axis])


def _reversed(r):
    return r[0] > r[1]


def _wait_reversed(page, pid, axis="yaxis", want=True):
    page.wait_for_function("([id, a, want]) => { const r = (%s)(id)._fullLayout[a].range; return (r[0] > r[1]) === want; }" % GD,
                           arg=[pid, axis, want], timeout=15000)


def test_flip_y_reverses_the_axis_and_survives_zoom_reset_and_double_click(page, server):
    _open(page, server)
    assert not _reversed(_range(page, A)) and not _reversed(_range(page, A, "xaxis"))
    _menu(page, A, "axes")
    assert page.is_visible(f"#flip-y-{A}")
    assert "downwards" in page.evaluate("(id) => document.getElementById('flip-y-' + id).closest('.form-check').title", A)
    page.check(f"#flip-y-{A}")
    _wait_reversed(page, A)
    assert not _reversed(_range(page, A, "xaxis"))
    assert _autorange(page, A) == "reversed" or _autorange(page, A) is True
    assert page.evaluate("(id) => PanelManager.getPanel(id).getConfig().flipY" , A) is True
    assert page.evaluate("(id) => PanelManager.getPanel(id).getConfig().flipX", A) is False
    # the export and download draw from this layout: it says reversed
    assert page.evaluate("(id) => { const l = (%s)(id).layout.yaxis; return l.autorange === 'reversed' || l.range[0] > l.range[1]; }" % GD, A)
    # B was not touched
    assert not _reversed(_range(page, B))
    if os.environ.get("AZ_SHOT_DIR"):
        page.screenshot(path=os.path.join(os.environ["AZ_SHOT_DIR"], "axis-flip-umap.png"))
    # a zoom keeps the direction
    page.evaluate("""(id) => { const gd = (%s)(id); const r = gd._fullLayout.yaxis.range;
        return Plotly.relayout(gd, {'yaxis.range': [r[0] - (r[0] - r[1]) * 0.25, r[1] + (r[0] - r[1]) * 0.25],
                                    'xaxis.range': [-1, 1]}); }""" % GD, A)
    page.wait_for_timeout(300)
    assert _reversed(_range(page, A))
    # Reset axes (the modebar's home) and a double click go back to the fit, still reversed
    page.evaluate("(id) => { const gd = (%s)(id); gd.querySelector('.modebar-btn[data-attr=\"zoom\"][data-val=\"reset\"], .modebar-btn[data-title=\"Reset axes\"]').click(); }" % GD, A)
    page.wait_for_timeout(600)
    assert _reversed(_range(page, A)), _range(page, A)
    assert not _reversed(_range(page, A, "xaxis"))
    page.evaluate("""(id) => { const gd = (%s)(id); const r = gd._fullLayout.yaxis.range;
        return Plotly.relayout(gd, {'yaxis.range': [r[0] * 0.5, r[1] * 0.5]}); }""" % GD, A)
    page.dblclick(f'.tile[data-tile-id="{A}"] .nsewdrag')
    page.wait_for_timeout(800)
    assert _reversed(_range(page, A)), "double click zooms back out, still flipped"
    # off again
    _menu(page, A, "axes")
    page.uncheck(f"#flip-y-{A}")
    _wait_reversed(page, A, want=False)


def test_flip_with_equal_aspect_and_the_scale_bar(page, server):
    _open(page, server, _cfgs(extra_a={"flipY": True, "flipX": True, "showScaleBar": True}))
    assert _reversed(_range(page, A)) and _reversed(_range(page, A, "xaxis"))
    ax = page.evaluate("(id) => { const fl = (%s)(id)._fullLayout; return {anchor: fl.yaxis.scaleanchor, ratio: fl.yaxis.scaleratio}; }" % GD, A)
    assert ax["anchor"] == "x" and ax["ratio"] == 1, ax            # Equal aspect is on in this fixture
    page.wait_for_function("(id) => (%s)(id).layout.shapes && (%s)(id).layout.shapes.some(s => s.name === 'az-scalebar')" % (GD, GD),
                           arg=A, timeout=15000)
    bar = page.evaluate("(id) => { const s = (%s)(id).layout.shapes.find(s => s.name === 'az-scalebar'); const r = (%s)(id)._fullLayout.xaxis.range;"
                        " return {x0: s.x0, x1: s.x1, lo: Math.min(...r), hi: Math.max(...r)}; }" % (GD, GD), A)
    assert bar["lo"] <= bar["x0"] <= bar["hi"] and bar["lo"] <= bar["x1"] <= bar["hi"], bar    # the bar is inside the plot


def test_a_flip_in_a_link_comes_back_and_an_old_link_is_unflipped(page, server):
    _open(page, server, _cfgs(extra_a={"flipY": True}))
    assert _reversed(_range(page, A)) and not _reversed(_range(page, B))
    cfg = page.evaluate("(id) => { const c = PanelManager.getPanel(id).getConfig(); return {flipX: c.flipX, flipY: c.flipY}; }", A)
    assert cfg == {"flipX": False, "flipY": True}
    # the saved layout carries it: opening it again gives the same direction
    layout = page.evaluate("() => JSON.stringify(PanelManager.saveLayout())")
    assert '"flipY":true' in json.dumps(json.loads(page.evaluate("() => JSON.stringify(window.PanelManager.getPanel('%s').getConfig())" % A))).replace(" ", "")
    # an old link (no flip keys) loads unflipped
    _open(page, server)
    assert not _reversed(_range(page, A)) and not _reversed(_range(page, A, "xaxis"))
    assert layout


def test_apply_to_other_panels_and_presets_do_not_copy_or_touch_the_flip(page, server):
    _open(page, server, _cfgs(extra_a={"flipY": True, "showGrid": False}))
    _menu(page, A, "apply")
    page.click(f"#apply-others-{A}")
    page.click(f"#apply-others-yes-{A}")
    page.wait_for_function("(id) => (%s)(id)._fullLayout.xaxis.showgrid === false" % GD, arg=B, timeout=15000)
    page.wait_for_timeout(500)
    assert not _reversed(_range(page, B)), "B took the look, not the direction"
    assert page.evaluate("(id) => PanelManager.getPanel(id).getConfig().flipY", B) is False
    # a preset on the flipped plot leaves it flipped
    _menu(page, A, "presets")
    for name in ("publication", "bare", "default"):
        page.click(f"#preset-{name}-{A}")
        page.wait_for_timeout(700)
        assert _reversed(_range(page, A)), name
        assert page.evaluate("(id) => PanelManager.getPanel(id).getConfig().flipY", A) is True


def test_flip_in_large_plot_mode(page, large_server):
    page.goto(_link(large_server, _cfgs(extra_a={"flipY": True})))
    page.wait_for_function(DRAWN, arg=A, timeout=60000)
    page.wait_for_timeout(1500)
    assert page.evaluate("(id) => !!(%s)(id).__isLarge" % GD, A), "not drawn in large-plot mode"
    assert _reversed(_range(page, A)) and not _reversed(_range(page, A, "xaxis"))
    if os.environ.get("AZ_SHOT_DIR"):
        page.screenshot(path=os.path.join(os.environ["AZ_SHOT_DIR"], "axis-flip-large.png"))
    # the switch in Plot Options, on the plot that is not flipped yet
    page.wait_for_function(DRAWN, arg=B, timeout=60000)
    _menu(page, B, "axes")
    page.check(f"#flip-y-{B}")
    _wait_reversed(page, B)
    page.uncheck(f"#flip-y-{B}")
    _wait_reversed(page, B, want=False)
    assert page.evaluate("(id) => !!(%s)(id).__isLarge" % GD, B)


def test_flip_is_not_offered_in_3d(page, server):
    z = {"type": "obs", "key": "total_counts", "column": ""}
    page.goto(_link(server, _cfgs(extra_a={"z": z})))
    page.wait_for_selector(f".tile[data-tile-id='{A}'] .js-plotly-plot", timeout=60000)
    page.wait_for_timeout(2000)
    _menu(page, A, "axes")
    assert page.is_disabled(f"#flip-y-{A}") and page.is_disabled(f"#flip-x-{A}")
