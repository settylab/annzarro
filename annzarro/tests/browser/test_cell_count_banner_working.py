"""The Count Plot's bottom edge and top-left corner, and its empty 2D-histogram tiles:

- the coverage banner renders as the Cell Plot's does (same computed style) and sits flush with the bottom of the panel,
  with nothing under it;
- what the plot is doing while it keeps its drawing ("Counting N cells…") is a small overlay in the plot's top-left corner,
  clear of the modebar, the spinner and the progress bar, and gone when the plot is ready;
- an empty 2D-histogram tile is a real 0 for a count, with a hover that says so.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser import test_cell_count_panel as cc  # noqa: E402
from annzarro.tests.browser import test_cell_group_plots as gp  # noqa: E402
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

served = cc.served
page = cc.page
CC, S, P = cc.CC, cc.S, gp.P
PT = f'.tile[data-tile-id="{P}"]'
DEPTH = {"source": {"type": "obs", "key": "depth"}}
SCORE = {"source": {"type": "obs", "key": "score"}}
RANGED = dict(mode="histogram", x={"source": {"type": "obs", "key": "depth"}, "binning": {"method": "equal_width", "range": [1, None]}})

BANNER = """(t) => { const tile = document.querySelector(t);
    const b = tile.querySelector('.plot-status');
    const cs = getComputedStyle(b);
    const body = tile.querySelector('.tile-content').getBoundingClientRect();
    const r = b.getBoundingClientRect();
    return { style: { className: b.className.replace(/plot-status--\\w+/, ''), fontSize: cs.fontSize, fontFamily: cs.fontFamily, padding: cs.padding,
        backgroundColor: cs.backgroundColor, borderTop: cs.borderTopWidth + ' ' + cs.borderTopColor, borderLeft: cs.borderLeftWidth,
        height: Math.round(r.height), color: cs.color }, gap: Math.round(body.bottom - r.bottom) }; }"""


def test_the_banner_renders_as_the_cell_plots_and_sits_flush_with_the_panel_bottom(page, served):
    # both complete, so both banners are in the same state (a banner with gaps is drawn in its warning colours)
    cc._open(page, served, {CC: cc._count(mode="bar", x=cc.CELL_TYPE), P: gp._plot()}, open_ids=(CC, P))
    cc._drawn(page, "bar")
    page.wait_for_selector(f"{PT} .plot-status")
    page.wait_for_selector(f"{S} .plot-status")
    folder = os.environ.get("ANNZARRO_BANNER_SHOTS")
    if folder:
        for name, tile in (("count", S), ("cell", PT)):
            box = page.locator(f"{tile} .tile-content").bounding_box()
            page.screenshot(path=os.path.join(folder, f"{name}.png"),
                            clip={"x": box["x"], "y": box["y"] + box["height"] - 90, "width": min(box["width"], 700), "height": 100})
    cell, count = page.evaluate(BANNER, PT), page.evaluate(BANNER, S)
    assert count["style"] == cell["style"], (count["style"], cell["style"])
    assert cell["gap"] == 0, cell
    assert count["gap"] == 0, "nothing sits between the banner and the bottom of the panel: %s" % count
    assert page.query_selector(f"{S} .ccnt-strip") is None
    # and with something to say the banner is still flush at the bottom
    cc._open(page, served, {CC: cc._count(**RANGED)})
    cc._drawn(page, "histogram")
    assert page.evaluate(BANNER, S)["gap"] == 0


GEOM = """(s) => { const q = (sel) => { const e = document.querySelector(s + ' ' + sel); if (!e || e.hidden || !e.getClientRects().length) return null;
        const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
    return { work: q('.ccnt-working'), plot: q('.ccnt-plot'), modebar: q('.modebar'), placeholder: q('.coverage-placeholder'), bar: q('.ps-progress'),
             text: (document.querySelector(s + ' .ccnt-working') || {}).textContent }; }"""


def _hit(a, b):
    return not (a["r"] <= b["l"] or b["r"] <= a["l"] or a["b"] <= b["t"] or b["b"] <= a["t"])


def test_what_the_plot_is_doing_sits_in_its_top_left_clear_of_the_modebar_spinner_and_progress_bar(page, served):
    held = []
    slow = {"on": False}

    def route(r):
        body = r.request.post_data or ""
        if slow["on"] and "estimate_only" not in body:
            held.append(r)
        else:
            r.continue_()
    page.route("**/data/cell_groups*", route)
    cc._open(page, served, {CC: cc._count(mode="histogram", x=DEPTH)})
    cc._drawn(page, "histogram")
    assert page.evaluate(GEOM, S)["work"] is None, "nothing is shown while the plot is ready"
    slow["on"] = True
    page.evaluate(f"""() => window.PanelManager.getPanel('{CC}').updateConfig({{ x: {{ source: {{ type: 'obs', key: 'depth' }}, binning: {{ method: 'equal_width', bins: 20 }} }} }})""")
    until(page, "(s) => { const w = document.querySelector(s + ' .ccnt-working'); return !!w && !w.hidden && /Counting/.test(w.textContent); }", S)
    g = page.evaluate(GEOM, S)
    w, plot = g["work"], g["plot"]
    assert plot["l"] <= w["l"] <= plot["l"] + 24 and plot["t"] <= w["t"] <= plot["t"] + 24, "top left of the plot: %s in %s" % (w, plot)
    assert w["r"] <= plot["r"] and w["b"] <= plot["b"]
    for name in ("modebar", "placeholder", "bar"):
        if g[name]:
            assert not _hit(w, g[name]), "%s overlaps the processing text: %s %s" % (name, g[name], w)
    page.hover(f"{S} .ccnt-plot")
    g = page.evaluate(GEOM, S)
    if g["modebar"]:
        assert not _hit(g["work"], g["modebar"]), "the modebar stays clear of the processing text"
    slow["on"] = False
    for r in held:
        r.continue_()
    cc._drawn(page, "histogram", "c.x.binning && c.x.binning.bins === 20")
    until(page, "(s) => { const w = document.querySelector(s + ' .ccnt-working'); return !w || w.hidden; }", S)


def test_an_empty_tile_of_a_2d_histogram_is_a_zero_and_its_hover_says_so(page, served):
    cc._open(page, served, {CC: cc._count(mode="hist2d", x=DEPTH, y=SCORE)})
    cc._drawn(page, "hist2d")
    got = page.evaluate("""(s) => { const t = document.querySelector(s + ' .ccnt-plot').data[0];
        const full = document.querySelector(s + ' .ccnt-plot')._fullData[0];
        let at = null;
        t.z.forEach((row, j) => row.forEach((v, i) => { if (v === 0 && !at) at = [j, i]; }));
        return { nulls: t.z.flat().filter(v => v === null).length, zeros: t.z.flat().filter(v => v === 0).length,
                 hover: at ? t.hovertext[at[0]][at[1]] : null, zmin: full.zmin }; }""", S)
    assert got["nulls"] == 0 and got["zeros"] > 0, got
    assert "Cells: 0" in got["hover"], got
    assert got["zmin"] == 0, "the auto range starts at the real minimum, 0"
