"""Plotly's toolbar sits at the top right corner of the plotting area, clear of the legend and colour bar.

Plot A is coloured by a category (legend), plot B by total counts (colour bar), both with a thin top
margin and a full-height colour bar, so that the figure's top right corner is where a legend or bar
placed on the right reaches. Wherever the legend or bar is put (right, left, top, bottom) the toolbar
lies inside the plotting area's top right and intersects neither, and it stays there after the window
is resized. The same holds in 3D and in large-plot mode (the 200-cell fixture served with a lowered
large_plot_points).

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1 (set in CI).
"""
import pytest

from annzarro.tests.browser.test_memory_guard import _serve
from annzarro.tests.browser.test_plot_options import A, B, DRAWN, GD, _cfgs, _link, _menu, playwright  # noqa: F401

THIN = {"marginsUnlinked": True, "margins": {"t": 8, "b": 60, "l": 60, "r": 80}, "colorbarLength": 1}

# the toolbar's box against the plot area's (the axes, or the 3D scene) and a legend's / colour bar's
BOXES = """([id, what]) => {
    const gd = (%s)(id), g = gd.getBoundingClientRect(), L = gd._fullLayout;
    const box = (r) => ({ l: r.left - g.left, r: r.right - g.left, t: r.top - g.top, b: r.bottom - g.top });
    const bar = box(gd.querySelector('.modebar').getBoundingClientRect());
    let area = { l: L._size.l, r: L._size.l + L._size.w, t: L._size.t, b: L._size.t + L._size.h };
    if (L.scene) {
        const d = L.scene.domain;
        area = { l: area.l + d.x[0] * L._size.w, r: area.l + d.x[1] * L._size.w,
                 t: L._size.t + (1 - d.y[1]) * L._size.h, b: L._size.t + (1 - d.y[0]) * L._size.h };
    }
    const el = gd.querySelector(what);
    const o = el ? box(el.getBoundingClientRect()) : null;
    const hit = !!o && bar.l < o.r && o.l < bar.r && bar.t < o.b && o.t < bar.b;
    return { bar, area, other: o, hit, width: g.width };
}""" % GD


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    root, proc = _serve(tmp_path_factory)
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture
def large(tmp_path_factory):
    root, proc = _serve(tmp_path_factory, "ui:\n  defaults:\n    large_plot_points: 100\n")
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture
def page(server):
    with playwright.sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            page = browser.new_page(viewport={"width": 1500, "height": 1000})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            yield page
            assert not errors, errors
        finally:
            browser.close()


SCENE = """(id) => { const gd = (%s)(id); return !!(gd && gd._fullLayout && gd._fullLayout.scene && gd.data && gd.data.length); }""" % GD


def _open(page, root, cfgs):
    page.goto(_link(root, cfgs))
    for pid, cfg in cfgs.items():
        page.wait_for_function(SCENE if cfg.get("z") else DRAWN, arg=pid, timeout=60000)
    page.wait_for_timeout(1200)
    page.wait_for_selector(f".tile[data-tile-id='{A}'] .modebar", state="attached")


def _boxes(page, pid, what):
    """The boxes once they stop moving (a placement change redraws a moment later, longer under load)."""
    prev = None
    for _ in range(40):
        got = page.evaluate(BOXES, [pid, what])
        if got == prev:
            return got
        prev = got
        page.wait_for_timeout(250)
    return got


def _in_corner(got):
    """Inside the plot area, against its top right corner (the toolbar's own 2 px inset and group padding)."""
    bar, area = got["bar"], got["area"]
    return (bar["b"] - bar["t"] < 40                      # one row of buttons, not wrapped
            and bar["r"] <= area["r"] + 1 and bar["t"] >= area["t"] - 1 and bar["l"] >= area["l"]
            and abs(bar["r"] - area["r"]) <= 6 and abs(bar["t"] - area["t"]) <= 6)


def _open_legend_section(page, pid):
    if not page.query_selector(f"details[data-panel='{pid}']"):
        page.click(f"#aesthetics-menu-btn-{pid}")
        page.wait_for_selector(f"details[data-panel='{pid}']", state="visible")
    for d in page.query_selector_all(f"details[data-panel='{pid}']"):
        if "Legend" in d.query_selector("summary").inner_text() and not d.evaluate("e => e.open"):
            d.query_selector("summary").click()


def test_toolbar_is_in_the_plot_areas_top_right_for_a_right_legend_and_colour_bar(page, server):
    _open(page, server, _cfgs(THIN, THIN))
    for pid, what in ((A, ".legend"), (B, ".colorbar")):
        got = _boxes(page, pid, what)
        assert got["other"] and _in_corner(got) and not got["hit"], (pid, got)


@pytest.mark.parametrize("side", ["right", "left", "top", "bottom"])
def test_legend_anywhere_leaves_the_toolbar_in_the_corner(page, server, side):
    _open(page, server, _cfgs(THIN, THIN))
    _open_legend_section(page, A)
    page.select_option(f"#legend-position-{A}", side)
    page.wait_for_timeout(800)
    got = _boxes(page, A, ".legend")
    assert got["other"] and _in_corner(got) and not got["hit"], (side, got)


# the colour bar's, the x-axis tick labels' and title's boxes against the axes' and the figure's
BAR = """([id, what]) => {
    const gd = (%s)(id), g = gd.getBoundingClientRect(), L = gd._fullLayout, s = L._size;
    const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left - g.left, r: r.right - g.left, t: r.top - g.top, b: r.bottom - g.top }; };
    const axes = { l: s.l, r: s.l + s.w, t: s.t, b: s.t + s.h };
    const meets = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
    // what is drawn of the bar (gradient, tick labels, title), not its padding box
    const parts = [...gd.querySelectorAll('.colorbar .cbfills, .colorbar .cbaxis, .colorbar .cbtitle')].map(box);
    const bar = { l: Math.min(...parts.map(p => p.l)), r: Math.max(...parts.map(p => p.r)),
                  t: Math.min(...parts.map(p => p.t)), b: Math.max(...parts.map(p => p.b)) };
    const xs = [...gd.querySelectorAll('.xtick text, .g-xtitle')].map(box);
    return { bar, axes, onAxes: meets(bar, axes), onXAxisText: xs.some(x => meets(bar, x)), nXText: xs.length,
             inFigure: bar.l >= 0 && bar.t >= 0 && bar.r <= g.width && bar.b <= g.height };
}""" % GD


@pytest.mark.parametrize("side", ["right", "left", "top", "bottom"])
def test_colour_bar_anywhere(page, server, side):
    # the thin margin (8 px) is what Plotly's auto margin has to make room from
    _open(page, server, _cfgs(THIN, THIN))
    _open_legend_section(page, B)
    page.select_option(f"#colorbar-position-{B}", side)
    page.wait_for_timeout(1000)
    got = _boxes(page, B, ".colorbar")
    assert got["other"] and _in_corner(got) and not got["hit"], (side, got)
    bar = page.evaluate(BAR, [B, ".colorbar"])
    assert bar["nXText"] and not bar["onAxes"] and not bar["onXAxisText"] and bar["inFigure"], (side, bar)


@pytest.mark.parametrize("side", ["top", "bottom"])
def test_a_top_or_bottom_colour_bar_is_whole_in_an_export(page, server, side):
    _open(page, server, _cfgs(THIN, {**THIN, "colorbarPosition": side, "legendPosition": side}))
    got = page.evaluate("""async (id) => {
        const gd = (%s)(id);
        const svg = await Plotly.toImage(gd, { format: 'svg', width: 1200, height: 800 });
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;left:0;top:0;width:1200px;height:800px;opacity:0;pointer-events:none';
        host.innerHTML = decodeURIComponent(svg.slice(svg.indexOf(',') + 1));
        document.body.appendChild(host);
        const root = host.querySelector('svg').getBoundingClientRect(), bar = host.querySelector('.colorbar').getBoundingClientRect();
        host.remove();
        return { top: bar.top - root.top, bottom: root.bottom - bar.bottom, left: bar.left - root.left, right: root.right - bar.right };
    }""" % GD, B)
    assert min(got.values()) >= 0, (side, got)


def test_toolbar_stays_in_the_corner_after_a_resize(page, server):
    _open(page, server, _cfgs(THIN, THIN))
    for w, h in ((1100, 800), (1500, 1000), (900, 700)):
        page.set_viewport_size({"width": w, "height": h})
        page.wait_for_timeout(1000)
        for pid, what in ((A, ".legend"), (B, ".colorbar")):
            got = _boxes(page, pid, what)
            assert _in_corner(got) and not got["hit"], (w, h, pid, got)


def test_3d_plot_toolbar_is_in_the_scene_corner(page, server):
    z = {"z": {"type": "obsm", "key": "X_umap", "column": "1"}}
    _open(page, server, _cfgs({**THIN, **z}, THIN))
    _open_legend_section(page, A)
    for side in ("right", "left", "top"):
        page.select_option(f"#legend-position-{A}", side)
        page.wait_for_timeout(800)
        got = _boxes(page, A, ".legend")
        assert _in_corner(got) and not got["hit"], (side, got)


def test_large_plot_toolbar_is_in_the_corner(page, large):
    page.goto(_link(large, {A: _cfgs(THIN, THIN)[A]}))
    page.wait_for_function("() => { const g = document.querySelector('.js-plotly-plot'); return !!(g && g.__isLarge && g._fullLayout); }",
                           timeout=60000)
    page.wait_for_timeout(1200)
    got = _boxes(page, A, ".legend")
    assert _in_corner(got) and not got["hit"], got


@pytest.mark.parametrize("side", ["top", "bottom"])
def test_large_plot_colour_bar_clears_the_axes_and_the_toolbar(page, large, side):
    cfg = _cfgs(THIN, {**THIN, "colorbarPosition": side, "legendPosition": side})[B]
    page.goto(_link(large, {B: cfg}))
    page.wait_for_function("() => { const g = document.querySelector('.js-plotly-plot'); return !!(g && g.__isLarge && g._fullLayout); }",
                           timeout=60000)
    page.wait_for_timeout(1500)
    got = _boxes(page, B, ".colorbar")
    assert _in_corner(got) and not got["hit"], (side, got)
    bar = page.evaluate(BAR, [B, ".colorbar"])
    assert not bar["onAxes"] and not bar["onXAxisText"] and bar["inFigure"], (side, bar)
