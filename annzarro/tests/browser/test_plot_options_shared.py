"""The shared Plot Options of the Cell-Gene Plot and the Cell Count Plot in a real browser (WP-5a; design note
options-ux-080 sections 2f, 3.1 and 5; operator decisions 25, 30 and 33).

The store is the grouping fixture (tests/core/grouping_store.py): 1,200 cells, cell_type with 6 levels, condition with 2.

1.  The Cell-Gene Plot's font size reaches the drawing, survives a redraw and the Undo of a later edit, and is undone
    by its own Undo.
2.  SVG export of a Cell-Gene Plot and of a count plot, at the size on screen.
3.  Apply to other Cell-Gene plots: the other plot takes the look, not the title.
4.  The legend's columns change the drawn legend: a count plot's legend in two Plotly legends, a Cell-Gene strip legend in
    two columns; the cap lists N levels and "+ k more".
5.  Opening Plot Options leaves the panel's box as it is, in both panels.
6.  Screenshots of the pop-over of both panels and of a capped legend (only when ANNZARRO_SHOTS names a directory).

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_gene_panel import (  # noqa: E402,F401 (the fixtures)
    served, page, _url, _plot, _sig, P, TP, S1, GENES)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402
from annzarro.tests.browser.test_cell_count_panel import CELL_TYPE, CONDITION  # noqa: E402

SHOTS = os.environ.get("ANNZARRO_SHOTS")
P2 = "cell-gene-Q"
TP2 = f'.tile[data-tile-id="{P2}"]'
CC = "cell-count-A"
SC = f'.tile[data-tile-id="{CC}"]'
POP = "[data-popover='plot-options']"


def _option(name):
    return f"{POP} [data-option='{name}']"


def _open(page, served, configs, open_ids):
    page.goto(_url(served, list(open_ids), configs))
    for pid in (i for i in open_ids if i.startswith("cell-")):
        page.wait_for_selector(f'.tile[data-tile-id="{pid}"] [data-state]', timeout=30000)


def _cg_ready(page, pid=P):
    until(page, "(id) => { const e = document.querySelector(`.tile[data-tile-id='${id}'] .cgene-panel`); return e && e.dataset.state === 'ready'; }",
          pid, timeout=60)


def _cc_ready(page, check="true"):
    until(page, f"""(s) => {{ const r = document.querySelector(s + ' .ccnt-panel'); const c = window.PanelManager.getPanel('{CC}').getConfig();
        return r && r.dataset.drawn === 'bar' && r.dataset.state === 'ready' && ({check}); }}""", SC, timeout=60)


def _cg_layout(page, path, pid=P):
    """A value of the drawn Cell-Gene layout, by dotted path."""
    return page.evaluate("([id, path]) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), "
                         "document.querySelector(`.tile[data-tile-id='${id}'] .cgene-plot`).layout)", [pid, path])


def _cg_until(page, check, arg=None, pid=P):
    until(page, "([id, f, a]) => { const p = document.querySelector(`.tile[data-tile-id='${id}'] .cgene-plot`);"
                " return !!p && !!p.layout && (new Function('p', 'a', 'return (' + f + ')(p, a)'))(p, a); }", [pid, check, arg], timeout=30)


def _config(page, pid):
    return page.evaluate("(id) => window.PanelManager.getPanel(id).getConfig()", pid)


def _open_options(page, tile, button):
    if page.locator(POP).count() == 0:
        page.click(f"{tile} {button}")
    page.wait_for_selector(POP)


def _section(page, name):
    """Unfold a section of the pop-over (Text, Legend, Export and the panel's own start open)."""
    page.evaluate("(n) => { const d = document.querySelector(`[data-popover='plot-options'] details[data-section='${n}']`); if (!d.open) d.querySelector('summary').click(); }", name)


def _set_number(page, name, value):
    page.fill(_option(name), str(value))
    page.press(_option(name), "Enter")


def _cg(page, served, **fields):
    _open(page, served, {P: _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=[{"source": S1, "rows": "genes"}], **fields),
                         S1: _sig(S1, "Markers", GENES[:4])}, (P, S1))
    _cg_ready(page)


def _count(**config):
    return {"id": CC, "title": "Count 1", "version": 1, **config}


def _cc(page, served, **config):
    _open(page, served, {CC: _count(mode="bar", x=CONDITION, split=CELL_TYPE, **config)}, (CC,))
    _cc_ready(page)


def _box(page, sel):
    return page.evaluate("(s) => { const r = document.querySelector(s).getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }", sel)


def _frames(page):
    page.evaluate("() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))")


# ------------------------------------------------------------------ 1. font size, redraw, undo

def test_cell_gene_font_size_survives_a_redraw_and_an_undo(page, served):
    _cg(page, served)
    assert _cg_layout(page, "font.size") == 12
    assert _cg_layout(page, "xaxis.showgrid") is False, "the Cell-Gene Plot draws no grid by default (operator)"
    _open_options(page, TP, ".cgene-options-btn")
    _set_number(page, "fontSize", 18)
    _cg_until(page, "(p) => p.layout.font.size === 18")
    assert _config(page, P)["look"] == {"fontSize": 18}
    assert page.locator(POP).count() == 1, "an edit applies live and leaves the pop-over open"
    # a later edit redraws the plot; the font stays, and its Undo leaves the font as it is
    page.check(_option("totals"))
    _cg_until(page, "(p) => p.data.some((t) => t.name === 'cells per group')")
    assert _cg_layout(page, "font.size") == 18
    page.keyboard.press("Escape")
    page.click(f"{TP} .cgene-undo")
    _cg_until(page, "(p) => !p.data.some((t) => t.name === 'cells per group')")
    assert _cg_layout(page, "font.size") == 18
    # a redraw of its own (the mode) keeps it
    page.click(f"{TP} .cgene-mode input[value='heatmap']")
    _cg_until(page, "(p) => p.data.some((t) => t.type === 'heatmap')")
    assert _cg_layout(page, "font.size") == 18
    page.click(f"{TP} .cgene-undo")
    _cg_until(page, "(p) => !p.data.some((t) => t.type === 'heatmap')")
    # the font size's own Undo
    assert page.get_attribute(f"{TP} .cgene-undo", "title") == "Undo: font size"
    page.click(f"{TP} .cgene-undo")
    _cg_until(page, "(p) => p.layout.font.size === 12")
    assert "look" not in _config(page, P)


# ------------------------------------------------------------------ 2. SVG export

def _export_svg(page, tile, button):
    _open_options(page, tile, button)
    btn = f"{POP} .po-export-btn[data-format='svg']"
    assert page.is_enabled(btn)
    with page.expect_download(timeout=30000) as dl:
        page.click(btn)
    path = dl.value.path()
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    return dl.value.suggested_filename, text


def test_svg_export_of_a_cell_gene_plot_and_a_count_plot(page, served):
    _cg(page, served)
    name, text = _export_svg(page, TP, ".cgene-options-btn")
    assert name.endswith(".svg"), name
    assert text.lstrip().startswith("<svg") and "GENE000" in text
    _cc(page, served)
    name, text = _export_svg(page, SC, ".ccnt-options-btn")
    assert name.endswith(".svg"), name
    assert text.lstrip().startswith("<svg") and "condition" in text


# ------------------------------------------------------------------ 3. Apply to other panels

def test_apply_to_other_cell_gene_plots_copies_the_look_not_the_title(page, served):
    second = _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=[{"source": S1, "rows": "genes"}], titles={"plot": "Theirs"})
    second["id"] = P2
    second["title"] = "Cell-Gene Plot 2"
    _open(page, served, {P: _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=[{"source": S1, "rows": "genes"}], titles={"plot": "Mine"}),
                         P2: second, S1: _sig(S1, "Markers", GENES[:4])}, (P, P2, S1))
    _cg_ready(page, P)
    _cg_ready(page, P2)
    _open_options(page, TP, ".cgene-options-btn")
    _set_number(page, "fontSize", 15)
    _section(page, "axes")
    page.check(_option("grid"))
    _cg_until(page, "(p) => p.layout.font.size === 15 && p.layout.xaxis.showgrid === true")
    _section(page, "apply")
    page.click(f"{POP} .po-apply-others")
    assert page.inner_text(f"{POP} .po-ask") .startswith("Replace the look of 1 other plot with this one's?")
    page.click(f"{POP} .po-apply-yes")
    assert page.inner_text(f"{POP} .po-apply-done") == "Applied to 1 plot."
    _cg_until(page, "(p) => p.layout.font.size === 15 && p.layout.xaxis.showgrid === true", pid=P2)
    other = _config(page, P2)
    assert other["look"] == {"fontSize": 15, "grid": True}
    assert other["titles"]["plot"] == "Theirs", "a title is not a look"


# ------------------------------------------------------------------ 4. legend columns and cap

def test_legend_columns_change_the_drawn_count_legend_and_the_cap_lists_n_and_more(page, served):
    _cc(page, served)
    names = page.evaluate("(s) => document.querySelector(s + ' .ccnt-plot').data.filter(t => t.showlegend !== false).map(t => t.name)", SC)
    assert len(names) == 6, "one entry per cell type, Plotly's own legend"
    _open_options(page, SC, ".ccnt-options-btn")
    _set_number(page, "legendColumns", 2)
    _cc_ready(page, "c.look && c.look.legendColumns === 2")
    until(page, "(s) => { const p = document.querySelector(s + ' .ccnt-plot'); return !!p.layout.legend2"
                " && p.data.filter(t => t.meta === 'az-legend' && t.legend === 'legend2').length === 3; }", SC, timeout=30)
    # both columns are drawn side by side
    xs = page.evaluate("(s) => Array.from(document.querySelectorAll(s + ' .ccnt-plot g.legend, ' + s + ' .ccnt-plot g.legend2'))"
                       ".map(g => g.getBoundingClientRect().x)", SC)
    assert len(xs) == 2 and abs(xs[0] - xs[1]) > 20, xs
    _set_number(page, "legendMax", 3)
    _cc_ready(page, "c.look && c.look.legendMax === 3")
    until(page, "(s) => { const p = document.querySelector(s + ' .ccnt-plot');"
                " const e = p.data.filter(t => t.meta === 'az-legend').map(t => t.name);"
                " return e.length === 4 && e[3] === '+ 3 more'; }", SC, timeout=30)
    assert page.evaluate("(s) => document.querySelector(s + ' .ccnt-plot').data.filter(t => t.type === 'bar').length", SC) == 6, \
        "every level is still drawn"


def test_legend_columns_change_the_drawn_cell_gene_strip_legend(page, served):
    _cg(page, served)
    xs = page.evaluate("(s) => new Set(document.querySelector(s + ' .cgene-plot').data.find(t => t.name === 'strip legend').x).size", TP)
    assert xs == 1
    _open_options(page, TP, ".cgene-options-btn")
    _set_number(page, "legendColumns", 2)
    _cg_until(page, "(p) => new Set(p.data.find((t) => t.name === 'strip legend').x).size === 2")
    _set_number(page, "legendMax", 4)
    _cg_until(page, "(p) => { const t = p.data.find((x) => x.name === 'strip legend').text; return t.length === 5 && t[4] === '+ 2 more'; }")


# ------------------------------------------------------------------ 5. the panel box

@pytest.mark.parametrize("which", ["cell-gene", "cell-count"])
def test_plot_options_leaves_the_panel_box_unchanged(page, served, which):
    if which == "cell-gene":
        _cg(page, served)
        tile, button, area = TP, ".cgene-options-btn", f"{TP} .cgene-area"
    else:
        _cc(page, served)
        tile, button, area = SC, ".ccnt-options-btn", f"{SC} .ccnt-plot-area"
    _frames(page)
    closed = (_box(page, tile), _box(page, area))
    page.click(f"{tile} {button}")
    page.wait_for_selector(POP)
    # every section open: the longest the pop-over gets
    page.evaluate("() => document.querySelectorAll(\"[data-popover='plot-options'] details\").forEach((d) => { d.open = true; })")
    _frames(page)
    assert (_box(page, tile), _box(page, area)) == closed, "opening Plot Options moves nothing in the panel"
    assert page.locator(f"{tile} {POP}").count() == 0, "the pop-over is in the body-level layer, not the tile"
    page.keyboard.press("Escape")
    page.wait_for_selector(POP, state="detached")
    assert page.evaluate("([t, b]) => document.activeElement === document.querySelector(t + ' ' + b)", [tile, button])


# ------------------------------------------------------------------ 6. screenshots

@pytest.mark.skipif(not SHOTS, reason="screenshots only when ANNZARRO_SHOTS names a directory")
def test_screenshots_of_plot_options_and_a_capped_legend(page, served):
    os.makedirs(SHOTS, exist_ok=True)
    _cg(page, served, look={"legendMax": 4})
    _open_options(page, TP, ".cgene-options-btn")
    page.screenshot(path=os.path.join(SHOTS, "wp5a-cell-gene-plot-options.png"))
    page.keyboard.press("Escape")
    page.locator(TP).screenshot(path=os.path.join(SHOTS, "wp5a-cell-gene-capped-strip-legend.png"))
    _cc(page, served, look={"legendMax": 3, "legendColumns": 2})
    until(page, "(s) => document.querySelector(s + ' .ccnt-plot').data.some(t => t.name === '+ 3 more')", SC, timeout=30)
    _frames(page)
    page.locator(SC).screenshot(path=os.path.join(SHOTS, "wp5a-count-capped-legend.png"))
    _open_options(page, SC, ".ccnt-options-btn")
    page.screenshot(path=os.path.join(SHOTS, "wp5a-count-plot-options.png"))
