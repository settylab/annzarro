"""Plot Options, Focused cell, in large-plot mode: the highlight is a layout shape.

The fixture's 200 cells are drawn in large-plot mode by a threshold of 100
points. The shape takes every option: radius half the marker size, opacity
(a shape's covers fill and edge, as a marker's), fill, edge colour and
width. Without the keys it is the default open circle, five times the point size; a change replaces the
shape (one relayout), with no restyle or new plot; a set colour stays
across a theme switch.
"""
import io

import pytest
from PIL import Image

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


def test_the_default_shape_is_an_open_circle(page, server):
    page.goto(_link(server))
    page.wait_for_function("(id) => !!(%s)(id)" % SHAPE, arg=A, timeout=60000)
    page.wait_for_timeout(1000)
    s = _shape(page)
    assert s["large"], "the fixture did not draw in large-plot mode"
    assert s["r"] == max(2, s["pointSize"] * 5 / 2), s
    assert (s["opacity"], s["fill"], s["lineColor"], s["lineWidth"]) == (1, "rgba(0, 0, 0, 0)", "#000000", 2), s


def test_the_focused_shape_takes_every_option(page, server):
    page.goto(_link(server, {A: {"focusedNoFill": False}}))
    page.wait_for_function("(id) => !!(%s)(id)" % SHAPE, arg=A, timeout=60000)
    page.wait_for_timeout(1000)
    s = _shape(page)
    assert s["large"], "the fixture did not draw in large-plot mode"
    # filled: radius 2.5 times the point size (at least 2 px), opaque, red, 2 px black
    assert s["r"] == max(2, s["pointSize"] * 5 / 2), s
    assert (s["opacity"], s["fill"], s["lineColor"], s["lineWidth"]) == (1, "#ff0000", "#000000", 2), s
    _menu(page, A, "focused")
    steps = [(f"#focused-scale-{A}", 7, "r", max(2, s["pointSize"] * 7 / 2)),
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
    page.wait_for_function("([id, ps]) => { const s = (%s)(id); return s && s.pointSize !== ps && s.r === Math.max(2, s.pointSize * 7 / 2); }"
                           % SHAPE, arg=[A, before], timeout=10000)
    # a set colour stays across a theme switch; the shape is still drawn
    page.click(f"#reset-focused-color-{A}")
    _wait(page, "fill", "#ff0000")
    page.click('#theme-toggle button[data-theme-mode="dark"]')
    page.wait_for_function("() => document.documentElement.getAttribute('data-theme') === 'dark'")
    page.wait_for_timeout(800)
    s = _shape(page)
    assert (s["fill"], s["lineColor"], s["opacity"]) == ("#ff0000", "#0000ff", 0.4), s


def test_no_fill_makes_the_shape_an_open_circle(page, server):
    page.goto(_link(server, {A: {"focusedNoFill": False, "focusedScale": 6, "focusedEdgeWidth": 3, "focusedEdgeColor": "#0000ff", "focusedColor": "#ff0000"}}))
    page.wait_for_function("(id) => !!(%s)(id)" % SHAPE, arg=A, timeout=60000)
    page.wait_for_timeout(1000)
    assert _shape(page)["fill"] == "#ff0000"
    _menu(page, A, "focused")
    page.evaluate(SPY)
    page.set_checked(f"#focused-no-fill-{A}", True)
    _wait(page, "fill", "rgba(0, 0, 0, 0)")
    spy = _spied(page)
    assert spy["newPlot"] == spy["react"] == spy["restyle"] == spy["addTraces"] == spy["deleteTraces"] == 0 and spy["relayout"] == 1, spy
    assert (_shape(page)["lineColor"], _shape(page)["lineWidth"]) == ("#0000ff", 3)
    px = lambda p: (p[0], p[1], p[2])  # noqa: E731
    page.mouse.move(2, 2)
    page.wait_for_timeout(400)
    at = page.evaluate("""(id) => { const gd = (%s)(id); const s = gd.layout.shapes.find(s => s.name === 'Focused Cell');
        const fl = gd._fullLayout, r = gd.querySelector('.nsewdrag').getBoundingClientRect();
        return { x: r.left + fl.xaxis.l2p(s.xanchor), y: r.top + fl.yaxis.l2p(s.yanchor), r: s.x1 }; }""" % GD, A)
    img = Image.open(io.BytesIO(page.screenshot())).convert("RGB")
    blue = lambda p: p[2] > 200 and p[0] < 60 and p[1] < 60  # noqa: E731
    red = lambda p: p[0] > 220 and p[1] < 50 and p[2] < 50  # noqa: E731
    r = at["r"]
    pts = [(x, y) for x in range(int(at["x"] - r - 3), int(at["x"] + r + 4)) for y in range(int(at["y"] - r - 3), int(at["y"] + r + 4))]
    assert sum(1 for x, y in pts if blue(px(img.getpixel((x, y))))) > 2 * 3.14 * r * 0.5
    assert not any(red(px(img.getpixel((x, y)))) for x, y in pts)
    centre = [(x, y) for x, y in pts if (x - at["x"]) ** 2 + (y - at["y"]) ** 2 < (r / 2) ** 2]
    assert not any(blue(px(img.getpixel(p))) or red(px(img.getpixel(p))) for p in centre)
    # it survives a focus move and a link
    page.evaluate("async () => (await import('/static/js/data-manager.js')).DataManager.setFocusedCell('cell_0042', false)")
    page.wait_for_timeout(800)
    assert _shape(page)["fill"] == "rgba(0, 0, 0, 0)"
    layout = page.evaluate("() => window.PanelManager.saveLayout()")
    assert "focusedNoFill" not in layout["panelConfigs"][A]       # no fill is the default
