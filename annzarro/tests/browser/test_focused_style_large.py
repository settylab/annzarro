"""Plot Options, Focused cell, in large-plot mode: the highlight is a layout shape.

The fixture's 200 cells are drawn in large-plot mode by a threshold of 100
points. The shape takes every option: radius half the marker size, opacity
(a shape's covers fill and edge, as a marker's), fill, edge colour and
width. Without the keys it is drawn as before them; a change replaces the
shape (one relayout), with no restyle or new plot; a set colour stays
across a theme switch.
"""
import pytest

from annzarro.tests.browser.test_axis_title_restore import _start
from annzarro.tests.browser.test_focused_style import A, GD, SPY, _link, _menu, _set, _spied
from annzarro.tests.browser.test_plot_options import page  # noqa: F401  (fixture)

SHAPE = """(id) => { const gd = (%s)(id); const s = gd && (gd.layout.shapes || []).find(s => s.name === 'Focused Cell');
    const panel = window.PanelManager && window.PanelManager.getActivePanels().find(p => p.getId() === id);
    const cfg = panel ? panel.getConfig() : {};
    return s && panel ? { r: s.x1, opacity: s.opacity, fill: s.fillcolor, lineColor: s.line.color, lineWidth: s.line.width,
                 pointSize: cfg.pointSize, large: !!gd.__isLarge } : null; }""" % GD


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    proc, root = _start(tmp_path_factory.mktemp("home"), 100)
    yield root
    proc.terminate()
    proc.wait(10)


def _shape(page):
    return page.evaluate(SHAPE, A)


def _wait(page, key, want):
    page.wait_for_function("([id, key, want]) => { const s = (%s)(id); return s && s[key] === want; }" % SHAPE,
                           arg=[A, key, want], timeout=10000)


def test_the_focused_shape_takes_every_option(page, server):
    page.goto(_link(server))
    page.wait_for_function("(id) => !!(%s)(id)" % SHAPE, arg=A, timeout=60000)
    page.wait_for_timeout(1000)
    s = _shape(page)
    assert s["large"], "the fixture did not draw in large-plot mode"
    # as before the options: radius the point size (at least 2 px), opaque, red, 2 px black
    assert s["r"] == max(2, s["pointSize"]), s
    assert (s["opacity"], s["fill"], s["lineColor"], s["lineWidth"]) == (1, "#ff0000", "#000000", 2), s
    _menu(page, A, "focused")
    steps = [(f"#focused-scale-{A}", 5, "r", max(2, s["pointSize"] * 5 / 2)),
             (f"#focused-opacity-{A}", 0.4, "opacity", 0.4),
             (f"#focused-edge-width-{A}", 3, "lineWidth", 3),
             (f"#focused-color-{A}", "#00ff00", "fill", "#00ff00"),
             (f"#focused-edge-color-{A}", "#0000ff", "lineColor", "#0000ff")]
    for sel, value, key, want in steps:
        page.evaluate(SPY)
        _set(page, sel, value)
        _wait(page, key, want)
        spy = _spied(page)
        assert spy["newPlot"] == spy["react"] == spy["restyle"] == spy["addTraces"] == spy["deleteTraces"] == 0, (sel, spy)
        assert spy["relayout"] == 1, (sel, spy)
    # the same value again: nothing to send
    page.evaluate(SPY)
    _set(page, f"#focused-color-{A}", "#00ff00")
    assert _spied(page)["relayout"] == 0
    # the point size moving keeps the factor
    before = _shape(page)["pointSize"]
    page.fill(f"#point-size-input-{A}", "8")
    page.press(f"#point-size-input-{A}", "Tab")
    page.wait_for_function("([id, ps]) => { const s = (%s)(id); return s && s.pointSize !== ps && s.r === Math.max(2, s.pointSize * 5 / 2); }"
                           % SHAPE, arg=[A, before], timeout=10000)
    # a set colour stays across a theme switch; the shape is still drawn
    page.click(f"#reset-focused-color-{A}")
    _wait(page, "fill", "#ff0000")
    page.click('#theme-toggle button[data-theme-mode="dark"]')
    page.wait_for_function("() => document.documentElement.getAttribute('data-theme') === 'dark'")
    page.wait_for_timeout(800)
    s = _shape(page)
    assert (s["fill"], s["lineColor"], s["opacity"]) == ("#ff0000", "#0000ff", 0.4), s
