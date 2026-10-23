"""The legend title sits above the entries with a clear gap, and is aligned as Title align says.

Plotly sets a legend title flush left, a little left of the symbols, with 2 px to the first entry. The title is
above the entries at every position, with a blank line below it that grows with the font. Measured on what is
drawn: the first line's bottom against the first entry's top, and its horizontal place against what the
alignment promises: Markers at the markers' left edge, Labels at the labels' left edge, Centre over all the
columns, and Auto Centre above or below the plot and Markers beside it. In one column and in columns, at two
font sizes. The stored title stays the colouring's name whatever the alignment.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1 (set in CI).
"""
import pytest

from annzarro.tests.browser.test_plot_options import (  # noqa: F401  (fixtures and helpers)
    A, B, DRAWN, GD, _cfgs, _link, page, server)

TITLE = """(id) => { const gd = (%s)(id);
    const t = gd.querySelector('.legend .legendtitletext');
    const first = t.querySelector('tspan.line') || t;
    const ctm = t.getScreenCTM();
    const text = first.textContent;
    const at = [...text].findIndex(c => c !== '\\u00a0' && c !== ' ');
    const ext = first.getExtentOfChar(at), extEnd = first.getExtentOfChar(text.length - 1);
    const label = gd.querySelector('.legend g.traces .legendtext').getBoundingClientRect();
    const entry = gd.querySelector('.legend g.traces').getBoundingClientRect();
    const dot = gd.querySelector('.legend g.traces .scatterpts').getBoundingClientRect();
    const line = first.getBoundingClientRect();
    const bgs = [...gd.querySelectorAll('g.legend, g.legend2, g.legend3')].map(g => g.querySelector('rect.bg').getBoundingClientRect());
    // across columns the title is an annotation: its text is what is seen
    const note = [...gd.querySelectorAll('g.infolayer g.annotation text')].find(n => n.textContent.trim() === 'cell_type');
    let shown = { left: ctm.e + ext.x * ctm.a, right: ctm.e + (extEnd.x + extEnd.width) * ctm.a };
    if (note) { const r = note.getBoundingClientRect(); shown = { left: r.left, right: r.right }; }
    return { letterX: shown.left, centre: (shown.left + shown.right) / 2, labelX: label.left, dotX: dot.left, lineBottom: line.bottom, entryTop: entry.top,
             boxCentre: (Math.min(...bgs.map(b => b.left)) + Math.max(...bgs.map(b => b.right))) / 2,
             size: parseFloat(getComputedStyle(t).fontSize), text, stored: gd.layout.legend.title.text, annotated: !!note }; }""" % GD


def _expected(align, position):
    return align or ("centre" if position in ("top", "bottom") else "markers")


@pytest.mark.parametrize("align", [None, "markers", "labels", "centre"])
@pytest.mark.parametrize("font_size", [12, 24])
@pytest.mark.parametrize("columns", [None, 2])
@pytest.mark.parametrize("position", ["right", "left", "top", "bottom"])
def test_the_title_is_above_the_entries_and_aligned_as_set(page, server, position, columns, font_size, align):
    extra = {"legendPosition": position, "fontSize": font_size}
    if columns:
        extra["legendColumns"] = columns
    if align:
        extra["legendTitleAlign"] = align
    page.goto(_link(server, _cfgs(extra_a=extra)))
    for pid in (A, B):
        page.wait_for_function(DRAWN, arg=pid, timeout=60000)
    page.wait_for_function("(id) => (%s)(id).querySelectorAll('g.legend g.traces, g.legend2 g.traces').length === 3" % GD, arg=A, timeout=30000)
    page.wait_for_timeout(1800)
    t = page.evaluate(TITLE, A)
    assert "cell_type" in t["text"], t
    # clear of the first entry: a gap that grows with the font
    assert t["entryTop"] - t["lineBottom"] >= 0.5 * t["size"], t
    # what is stored is the name and its line below, whatever the alignment (the shift is applied to what is drawn)
    assert t["stored"] == "cell_type<br>\u00a0", t
    want = _expected(align, position)
    if want == "labels":
        assert abs(t["letterX"] - t["labelX"]) <= max(4, 0.3 * t["size"]), t
    elif want == "markers":
        assert abs(t["letterX"] - t["dotX"]) <= max(1, 0.1 * t["size"]), t
    else:
        assert abs(t["centre"] - t["boxCentre"]) <= 1.5, t
