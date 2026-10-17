"""Plotly's toolbar sits top left, clear of a legend or colour bar on the right.

Plot A is coloured by a category (legend), plot B by total counts (colour bar), both with a thin
top margin and a full-height colour bar, so that the toolbar's corner is where a right-hand legend
or bar reaches. The toolbar must not intersect them; it moves to the right corner when the legend
or bar is placed on the left, and back when it is placed on the right or above. The same holds in
3D and in large-plot mode (the 200-cell fixture served with a lowered large_plot_points).

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1 (set in CI).
"""
import pytest

from annzarro.tests.browser.test_memory_guard import _serve
from annzarro.tests.browser.test_plot_options import A, B, DRAWN, GD, _cfgs, _link, _menu, playwright  # noqa: F401

THIN = {"marginsUnlinked": True, "margins": {"t": 8, "b": 60, "l": 60, "r": 80}, "colorbarLength": 1}

# the toolbar's box against a legend's / colour bar's, and which half of the graph the toolbar is in
BOXES = """([id, what]) => {
    const gd = (%s)(id), g = gd.getBoundingClientRect();
    const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left - g.left, r: r.right - g.left, t: r.top - g.top, b: r.bottom - g.top }; };
    const bar = box(gd.querySelector('.modebar'));
    const other = gd.querySelector(what);
    const o = other ? box(other) : null;
    const hit = !!o && bar.l < o.r && o.l < bar.r && bar.t < o.b && o.t < bar.b;
    return { bar, other: o, hit, width: g.width, right: gd.classList.contains('az-modebar-right') };
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
    return page.evaluate(BOXES, [pid, what])


def _open_legend_section(page, pid):
    if not page.query_selector(f"details[data-panel='{pid}']"):
        page.click(f"#aesthetics-menu-btn-{pid}")
        page.wait_for_selector(f"details[data-panel='{pid}']", state="visible")
    for d in page.query_selector_all(f"details[data-panel='{pid}']"):
        if "Legend" in d.query_selector("summary").inner_text() and not d.evaluate("e => e.open"):
            d.query_selector("summary").click()


def test_toolbar_is_top_left_and_clears_a_right_legend_and_colour_bar(page, server):
    _open(page, server, _cfgs(THIN, THIN))
    leg = _boxes(page, A, ".legend")
    assert leg["other"] and leg["right"] is False
    assert leg["bar"]["l"] < leg["width"] / 2 and not leg["hit"], leg
    bar = _boxes(page, B, ".colorbar")
    assert bar["other"] and bar["right"] is False
    assert bar["bar"]["l"] < bar["width"] / 2 and not bar["hit"], bar


def test_legend_on_the_left_moves_the_toolbar_right_and_back(page, server):
    _open(page, server, _cfgs(THIN, THIN))
    _open_legend_section(page, A)
    for side, right in (("left", True), ("right", False), ("top", False), ("bottom", False), ("left", True)):
        page.select_option(f"#legend-position-{A}", side)
        page.wait_for_timeout(800)
        got = _boxes(page, A, ".legend")
        assert got["right"] is right, (side, got)
        assert (got["bar"]["l"] > got["width"] / 2) is right, (side, got)
        assert not got["hit"], (side, got)


def test_colour_bar_on_the_left_moves_the_toolbar_right(page, server):
    _open(page, server, _cfgs(THIN, THIN))
    _open_legend_section(page, B)
    for side, right in (("left", True), ("right", False)):
        page.select_option(f"#colorbar-position-{B}", side)
        page.wait_for_timeout(800)
        got = _boxes(page, B, ".colorbar")
        assert got["right"] is right, (side, got)
        assert not got["hit"], (side, got)


def test_3d_plot_keeps_the_toolbar_clear_of_the_legend(page, server):
    z = {"z": {"type": "obsm", "key": "X_umap", "column": "1"}}
    _open(page, server, _cfgs({**THIN, **z}, THIN))
    got = _boxes(page, A, ".legend")
    assert got["right"] is False and got["bar"]["l"] < got["width"] / 2 and not got["hit"], got
    _open_legend_section(page, A)
    page.select_option(f"#legend-position-{A}", "left")
    page.wait_for_timeout(800)
    got = _boxes(page, A, ".legend")
    assert got["right"] is True and not got["hit"], got


def test_large_plot_toolbar_clears_the_legend(page, large):
    page.goto(_link(large, {A: _cfgs(THIN, THIN)[A]}))
    page.wait_for_function("() => { const g = document.querySelector('.js-plotly-plot'); return !!(g && g.__isLarge && g._fullLayout); }",
                           timeout=60000)
    page.wait_for_timeout(1200)
    got = _boxes(page, A, ".legend")
    assert got["right"] is False and got["bar"]["l"] < got["width"] / 2 and not got["hit"], got
