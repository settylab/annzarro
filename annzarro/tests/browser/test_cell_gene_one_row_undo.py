"""Dots and a one-row section from a Gene Signature, through Remove, Undo and the switch to Heatmap (operator, 2026-11-23).

The operator's words: "the dotplot worked when I removed the Gene Signature 1 in one row. but when hitting undo and it
comes back, it is not shown in the dotplot, and when switching to heatmap only the annotation changes but it still
shows dots instead of tiles". Each step must leave the figure the configuration asks for: every row drawn, the main
traces of the mode asked for, and no exception.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_gene_panel import (  # noqa: E402,F401 (the fixtures)
    served, page, _open, _plot, _sig, _drawn, _config, P, TP, S1, GA, GENES)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

TWO = {"id": GA, "title": "Grouping 1", "version": 1, "layers": ["logged"],
       "partitionings": [{"source": {"type": "obs", "key": "cell_type"}}, {"source": {"type": "obs", "key": "condition"}}]}

# what the drawing is: the main traces' types, the rows on the gene axis, the panel's state
FIGURE = """(s) => { const p = document.querySelector(s + ' .cgene-plot'); const r = document.querySelector(s + ' .cgene-panel');
  const main = (p.data || []).filter(t => !t.name && ['scatter', 'scattergl', 'heatmap'].includes(t.type));
  return { state: r.dataset.state, types: [...new Set(main.map(t => t.type))], drawnTypes: [...new Set((p._fullData || []).filter(t => !(p.data[t.index] || {}).name).map(t => t.type))],
           // the gene axis's positions that carry a value: a dot's x, or a heatmap column with a tile
           columns: new Set(main.flatMap(t => t.type !== 'heatmap' ? Array.from(t.x || [])
             : Array.from(t.x || []).filter((_, j) => (t.z || []).some(row => Number.isFinite(row[j]))))).size }; }"""


def _figure(page):
    return page.evaluate(FIGURE, TP)


def _settled(page, check, step):
    try:
        until(page, f"(s) => {{ const f = ({FIGURE})(s); return f.state === 'ready' && ({check})(f); }}", TP, timeout=30)
    except AssertionError:
        pytest.fail(f"{step}: the figure is {_figure(page)}, the panel {page.evaluate('(id) => window.PanelManager.getPanel(id)._debugState()', P)}")
    return _figure(page)


@pytest.mark.parametrize("height", [1100, 700])
def test_remove_undo_and_heatmap_with_a_one_row_signature_section(page, served, height):
    page.set_viewport_size({"width": 1500, "height": height})
    one_row = {"source": S1, "rows": "set",
               "color": {"agg": "score_pct_above", "column": "zscore_mean", "layer": "logged"},
               "size": {"agg": "score_pct_above", "column": "mean", "layer": "logged"}}
    cfg = _plot(cellAxis={"type": "cell-group", "key": GA}, size={"stat": "count"},
                cluster={"genes": "sections", "groups": "first", "linkage": "complete", "distance": "euclidean", "dendrograms": True},
                sections=[{"source": S1, "rows": "genes"}, one_row])
    _open(page, served, {P: cfg, S1: _sig(S1, "Gene Signature 1", GENES[:6]), GA: TWO}, open_ids=(P, S1, GA))
    _drawn(page)
    first = _settled(page, "(f) => f.types.length > 0", "first draw")
    assert first["types"] == ["scatter"] and first["drawnTypes"] == ["scatter"], first
    n = first["columns"]
    assert n == 7, f"six genes and the signature's row: {first}"
    # Remove the one-row section: the genes alone, as dots
    page.locator(f"{TP} .cgene-section").nth(1).locator(".az-card__more").click()
    page.locator("[data-popover='card-menu'] .az-card__op[data-op='remove']").click()
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections.length === 1", P)
    removed = _settled(page, f"(f) => f.columns === {n - 1}", "removed")
    assert removed["types"] == ["scatter"], removed
    # Undo: the one-row section is back in the configuration and drawn as its own row
    page.click(f"{TP} .cgene-undo")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections.length === 2", P)
    back = _settled(page, f"(f) => f.columns === {n}", "undone")
    assert back["drawnTypes"] == ["scatter"], back
    # Heatmap: tiles, not dots, and Plotly drew them
    page.select_option(f"{TP} select.cgene-mode", "heatmap")
    heat = _settled(page, "(f) => f.types.includes('heatmap')", "heatmap")
    assert heat["types"] == ["heatmap"] and heat["drawnTypes"] == ["heatmap"], heat
    assert heat["columns"] == n, heat
    # and Dots again
    page.select_option(f"{TP} select.cgene-mode", "dots")
    dots = _settled(page, "(f) => f.types.includes('scatter')", "dots again")
    assert dots["types"] == ["scatter"] and dots["drawnTypes"] == ["scatter"], dots
    assert _config(page)["mode"] == "dots"


# What is on screen, not what the figure holds: the heatmap's tiles are images, the dots are paths in the scatter layer
ON_SCREEN = """(s) => { const p = document.querySelector(s + ' .cgene-plot');
  return { tiles: p.querySelectorAll('.cartesianlayer .subplot.xy .hm image').length,
           dots: p.querySelectorAll('.cartesianlayer .subplot.xy .scatterlayer .trace:first-child .point').length }; }"""

# Plotly throwing part-way through a draw, as a color bar whose title outgrew its slot made it do: while armed, every
# draw is given a color bar 1 px long under a three-line title (a redraw for a new size included)
BREAK_DRAWS = """() => { const real = Plotly.react; window.__breakDraws = true; Plotly.react = function (gd, data, layout, config) {
  if (!window.__breakDraws) return real.call(this, gd, data, layout, config);
  const t = data.find(d => (d.marker && d.marker.colorbar) || d.colorbar); const cb = (t.marker && t.marker.colorbar) || t.colorbar;
  cb.len = 1; cb.lenmode = 'pixels'; cb.title = { text: 'a<br>b<br>c', side: 'top' };
  return real.call(this, gd, data, layout, config); }; }"""


def test_a_draw_that_threw_does_not_leave_the_next_one_stale(page, served):
    """After Plotly threw part-way, the panel says so, and the next drawing is the one asked for (the heatmap's
    tiles, not the dots still on screen with new annotations)."""
    cfg = _plot(cellAxis={"type": "cell-group", "key": GA}, sections=[{"source": S1, "rows": "genes"}, {"source": S1, "rows": "set"}])
    _open(page, served, {P: cfg, S1: _sig(S1, "Gene Signature 1", GENES[:6]), GA: TWO}, open_ids=(P, S1, GA))
    _drawn(page)
    shown = page.evaluate(ON_SCREEN, TP)
    assert shown["dots"] > 0 and shown["tiles"] == 0, shown
    page.evaluate(BREAK_DRAWS)
    page.locator(f"{TP} .cgene-section").nth(1).locator(".az-card__more").click()
    page.locator("[data-popover='card-menu'] .az-card__op[data-op='remove']").click()
    # the failed draw is said, not left as "drawing" for good
    until(page, "(s) => document.querySelector(s + ' .cgene-panel').dataset.state === 'failed'", TP, timeout=30)
    assert page.locator(f"{TP} .cgene-plot").evaluate("(p) => !p.data || !p.data.length"), "the half-drawn figure is cleared"
    page.evaluate("() => { window.__breakDraws = false; }")
    page.select_option(f"{TP} select.cgene-mode", "heatmap")
    until(page, f"(s) => {{ const o = ({ON_SCREEN})(s); return o.tiles > 0 && o.dots === 0; }}", TP, timeout=30)
    assert page.evaluate("(s) => document.querySelector(s + ' .cgene-panel').dataset.state", TP) == "ready"
    page.click(f"{TP} .cgene-undo")
    page.click(f"{TP} .cgene-undo")
    until(page, f"(s) => {{ const o = ({ON_SCREEN})(s); return o.dots > 0 && o.tiles === 0; }}", TP, timeout=30)
    assert _config(page)["mode"] == "dots" and len(_config(page)["sections"]) == 2
