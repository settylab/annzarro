"""The legend title sits above the entries with a clear gap and starts where the labels start.

Plotly sets a legend title flush left, a little left of the symbols, with 2 px to the first entry (and, in
a horizontal legend, beside the entries). The title is now above the entries at every position, indented to the
labels' x (spaces in the title's font) with a blank line below it. Measured on what is drawn: the first line's
bottom against the first entry's top (the gap scales with the font), and the first letter's left against
the labels' left, at every position, in one column and in columns, and at two font sizes.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1 (set in CI).
"""
import pytest

from annzarro.tests.browser.test_plot_options import (  # noqa: F401  (fixtures and helpers)
    A, B, DRAWN, GD, _cfgs, _link, page, server)

TITLE = """(id) => { const gd = (%s)(id);
    const t = gd.querySelector('.legend .legendtitletext');
    const first = t.querySelector('tspan.line') || t;
    const svg = t.ownerSVGElement, ctm = t.getScreenCTM();
    const text = first.textContent;
    const at = [...text].findIndex(c => c !== '\\u00a0' && c !== ' ');
    const ext = first.getExtentOfChar(at);
    const label = gd.querySelector('.legend g.traces .legendtext').getBoundingClientRect();
    const entry = gd.querySelector('.legend g.traces').getBoundingClientRect();
    const line = first.getBoundingClientRect();
    return { letterX: ctm.e + ext.x * ctm.a, labelX: label.left, lineBottom: line.bottom, entryTop: entry.top,
             size: parseFloat(getComputedStyle(t).fontSize), text }; }""" % GD


@pytest.mark.parametrize("font_size", [12, 24])
@pytest.mark.parametrize("columns", [None, 2])
@pytest.mark.parametrize("position", ["right", "left", "top", "bottom"])
def test_the_title_is_above_the_entries_and_starts_at_the_labels(page, server, position, columns, font_size):
    extra = {"legendPosition": position, "fontSize": font_size}
    if columns:
        extra["legendColumns"] = columns
    page.goto(_link(server, _cfgs(extra_a=extra)))
    for pid in (A, B):
        page.wait_for_function(DRAWN, arg=pid, timeout=60000)
    page.wait_for_function("(id) => (%s)(id).querySelectorAll('.legend g.traces').length === 3" % GD, arg=A, timeout=30000)
    page.wait_for_timeout(1500)
    t = page.evaluate(TITLE, A)
    assert "cell_type" in t["text"], t
    # clear of the first entry: a gap that grows with the font
    assert t["entryTop"] - t["lineBottom"] >= 0.5 * t["size"], t
    # the first letter where the labels start (the indent is in spaces of the title's font)
    assert abs(t["letterX"] - t["labelX"]) <= max(4, 0.3 * t["size"]), t
