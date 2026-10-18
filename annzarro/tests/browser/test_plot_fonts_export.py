"""The panel's text font reaches the legend and the colour bar; the Publication preset; the export default.

Same two cell plots as test_plot_options: A coloured by cell type (legend), B by
total counts (colour bar). Fonts are read from what Plotly drew (_fullLayout,
_fullData), on a preset, on a live change of the font and in the PNG's size.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os
import struct

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_memory_guard import _serve  # noqa: E402
from annzarro.tests.browser.test_plot_options import (  # noqa: E402,F401
    A, B, GD, _cfgs, _close_menu, _menu, _open, _settings,
)

ARIAL = "Arial, Helvetica, sans-serif"
SERIF = "Georgia, serif"


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
            context = browser.new_context(accept_downloads=True, viewport={"width": 1500, "height": 1000})
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.on("dialog", lambda d: errors.append(f"browser dialog: {d.message}") or d.dismiss())
            yield page
            assert not errors, errors
        finally:
            browser.close()


BAR = """(id) => { const t = (%s)(id)._fullData.find(t => t.marker && t.marker.colorbar); const c = t.marker.colorbar;
    return {nticks: c.nticks, len: c.len, titleFamily: c.title.font.family, titleSize: c.title.font.size,
            tickFamily: c.tickfont.family, tickSize: c.tickfont.size}; }""" % GD
LEG = """(id) => { const l = (%s)(id)._fullLayout.legend;
    return {titleFamily: l.title.font.family, itemFamily: l.font.family, titleSize: l.title.font.size, itemSize: l.font.size}; }""" % GD
AXES = """(id) => { const l = (%s)(id)._fullLayout;
    return [l.font.family, l.xaxis.title.font.family, l.yaxis.title.font.family, l.xaxis.tickfont.family, l.yaxis.tickfont.family]; }""" % GD


def _all_in(page, family, size=None):
    """Every text of both plots (axes, legend title and items, colour bar title and ticks) is in `family`."""
    assert set(page.evaluate(AXES, A)) == {family}, page.evaluate(AXES, A)
    assert set(page.evaluate(AXES, B)) == {family}
    leg = page.evaluate(LEG, A)
    assert leg["titleFamily"] == family and leg["itemFamily"] == family, leg
    bar = page.evaluate(BAR, B)
    assert bar["titleFamily"] == family and bar["tickFamily"] == family, bar
    if size:
        assert leg["itemSize"] == size and leg["titleSize"] == size + 2, leg
        assert bar["tickSize"] == size and bar["titleSize"] == size + 2, bar


def test_publication_sets_arial_three_ticks_and_a_short_colour_bar(page, server):
    # from another font, so the preset has something to change
    start = {"fontFamily": SERIF, "fontSize": 12}
    _open(page, server, _cfgs(extra_a=start, extra_b=start))
    _all_in(page, SERIF, size=12)
    for pid in (A, B):
        _menu(page, pid, "presets")
        page.click(f"#preset-publication-{pid}")
        _close_menu(page, pid)
    page.wait_for_function("(id) => (%s)(id)._fullData.find(t => t.marker && t.marker.colorbar).marker.colorbar.nticks === 3" % GD, arg=B)
    page.wait_for_timeout(500)
    bar = page.evaluate(BAR, B)
    assert bar["nticks"] == 3 and bar["len"] == 0.4, bar
    _all_in(page, ARIAL, size=16)
    assert _settings(page, B)["fontFamily"] == ARIAL


def test_a_live_change_of_the_font_reaches_legend_and_colour_bar(page, server):
    _open(page, server)
    _all_in(page, ARIAL, size=12)
    for pid in (A, B):
        _menu(page, pid, "text")
        page.select_option(f"#font-family-{pid}", SERIF)
        _close_menu(page, pid)
    page.wait_for_function("(id) => (%s)(id)._fullData.find(t => t.marker && t.marker.colorbar).marker.colorbar.tickfont.family === 'Georgia, serif'" % GD, arg=B)
    page.wait_for_timeout(400)
    _all_in(page, SERIF)
    # and the size, on top of the family
    for pid in (A, B):
        _menu(page, pid, "text")
        page.eval_on_selector(f"#font-size-{pid}", "e => { e.value = 18; e.dispatchEvent(new Event('input', {bubbles: true})); e.dispatchEvent(new Event('change', {bubbles: true})); }")
        _close_menu(page, pid)
    page.wait_for_function("(id) => (%s)(id)._fullLayout.legend.font.size === 18" % GD, arg=A)
    page.wait_for_timeout(400)
    _all_in(page, SERIF, size=18)


def _png_size(path):
    with open(path, "rb") as f:
        head = f.read(24)
    assert head[:8] == b"\x89PNG\r\n\x1a\n"
    return struct.unpack(">II", head[16:24])


def test_the_default_png_is_twice_the_size_set(page, server, tmp_path):
    _open(page, server)
    _menu(page, A, "export")
    assert page.is_checked(f"#scale-export-{A}")
    with page.expect_download() as dl:
        page.click(f"#download-png-{A}")
    out = tmp_path / "a.png"
    dl.value.save_as(out)
    assert _png_size(out) == (2400, 1600)
    page.wait_for_timeout(500)
    # a size set by the user is kept as set, then doubled
    _menu(page, A, "export")
    page.fill(f"#plot-width-{A}", "1000")
    page.press(f"#plot-width-{A}", "Tab")
    page.fill(f"#plot-height-{A}", "500")
    page.press(f"#plot-height-{A}", "Tab")
    page.wait_for_timeout(400)
    _menu(page, A, "export")
    with page.expect_download() as dl:
        page.click(f"#download-png-{A}")
    dl.value.save_as(tmp_path / "b.png")
    page.wait_for_timeout(500)
    _menu(page, A, "export")
    assert _png_size(tmp_path / "b.png") == (2000, 1000)
    # unticked: exactly the pixels set
    _menu(page, A, "export")
    page.uncheck(f"#scale-export-{A}")
    page.wait_for_timeout(300)
    assert _settings(page, A)["scaleExport"] is False
    with page.expect_download() as dl:
        page.click(f"#download-png-{A}")
    dl.value.save_as(tmp_path / "c.png")
    assert _png_size(tmp_path / "c.png") == (1000, 500)


def test_a_panel_saved_with_scale_off_keeps_it(page, server):
    _open(page, server, _cfgs(extra_a={"scaleExport": False}))
    assert _settings(page, A)["scaleExport"] is False
    assert _settings(page, B)["scaleExport"] is True        # unset in an older link: the new default
    _menu(page, A, "export")
    assert not page.is_checked(f"#scale-export-{A}")


# -- the colour bar and legend survive a change of the colour ------------------------------

from annzarro.tests.browser.test_axis_title_restore import _start  # noqa: E402

CONT = {"type": "obs", "key": "total_counts", "column": ""}
UMAP0 = {"type": "obsm", "key": "X_umap", "column": "0"}
GENE = {"type": "layer", "key": "X", "column": "GENE000"}
CAT = {"type": "obs", "key": "cell_type", "column": ""}
FIRST = """(id) => { const gd = (%s)(id); const t = gd._fullData.find(t => t.marker && t.marker.colorbar && t.marker.showscale);
    if (!t) return null; const c = t.marker.colorbar;
    return {nticks: c.nticks, len: c.len, orientation: c.orientation, titleFamily: c.title.font.family,
            tickFamily: c.tickfont.family, titleSize: c.title.font.size, tickSize: c.tickfont.size}; }""" % GD


@pytest.fixture(scope="module")
def large_server(tmp_path_factory):
    proc, root = _start(tmp_path_factory.mktemp("home-large"), 100)
    yield root
    proc.terminate()
    proc.wait(10)


def _pick(page, pid, field):
    base = f'.tile[data-tile-id="{pid}"] '
    page.select_option(base + '.axis-type-select[data-axis="color"]', field["type"])
    key = base + '.axis-key-select[data-axis="color"]'
    page.wait_for_function("([sel, v]) => [...document.querySelector(sel).options].some(o => o.value === v)",
                           arg=[key, field["key"]], timeout=15000)
    page.select_option(key, field["key"])
    if field["column"]:
        col = base + '.axis-column-select[data-axis="color"]'
        page.wait_for_function("([sel, v]) => [...document.querySelector(sel).options].some(o => o.value === v)",
                               arg=[col, field["column"]], timeout=15000)
        page.select_option(col, field["column"])
    page.wait_for_timeout(2500)


def _bar_kept(page, step):
    bar = page.evaluate(FIRST, B)
    assert bar is not None, f"{step}: no colour bar"
    assert bar["len"] == 0.4 and bar["nticks"] == 3 and bar["orientation"] == "h", (step, bar)
    assert bar["titleFamily"] == ARIAL and bar["tickFamily"] == ARIAL, (step, bar)
    assert bar["tickSize"] == 16 and bar["titleSize"] == 18, (step, bar)


@pytest.mark.parametrize("mode", ["regular", "large"])
def test_colour_bar_and_legend_keep_their_options_through_a_colour_change(page, server, large_server, mode):
    root = server if mode == "regular" else large_server
    _open(page, root, _cfgs(extra_b={"fontFamily": SERIF}))
    if mode == "large":
        assert page.evaluate("(id) => !!(%s)(id).__isLarge" % GD, B)
    _menu(page, B, "presets")
    page.click(f"#preset-publication-{B}")
    _menu(page, B, "legend")
    page.select_option(f"#colorbar-position-{B}", "bottom")
    page.wait_for_timeout(800)
    _close_menu(page, B)
    _bar_kept(page, "after Publication")
    for step, field in (("another continuous column", UMAP0), ("a gene", GENE), ("total counts again", CONT)):
        _pick(page, B, field)
        _bar_kept(page, step)
    # categorical and back: the legend takes the font, the colour bar comes back as it was
    _pick(page, B, CAT)
    leg = page.evaluate(LEG, B)
    assert leg["titleFamily"] == ARIAL and leg["itemFamily"] == ARIAL, leg
    assert leg["itemSize"] == 16 and leg["titleSize"] == 18, leg
    _pick(page, B, CONT)
    _bar_kept(page, "categorical back to continuous")
    cfg = _settings(page, B)
    assert cfg["colorbarLength"] == 0.4 and cfg["colorbarTicks"] == 3 and cfg["colorbarPosition"] == "bottom"
