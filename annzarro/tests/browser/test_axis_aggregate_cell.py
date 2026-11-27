"""An axis of a Cell Plot takes a set from the item picker (axis-aggregate-picker-080): the source column lists no
signature any more; with a layer source the item picker lists the focused gene, then Gene signatures and Gene tables in
separate sections, and a set picked there shows an aggregation button (a symbol) after it.

1.  The type menu has no Gene score; the item picker has sections with headers; picking a signature shows the button
    (default z, "Aggregation: Z-score mean"); picking a gene removes it.
2.  The button's pop-over lists every method as symbol and name; choosing one is one request and one Undo step.
3.  Switching an axis back to a normal source (obsm) clears the aggregation completely and the plot draws.
4.  Three aggregated axes are three one-line rows with no second layer or method row.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_gene_score_plots import (  # noqa: E402,F401
    C, SIG, SCORE, UMAP_X, UMAP_Y, _cell, _drawn, _open, _sig, page, served)
from annzarro.tests.browser import axis_sets  # noqa: E402
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

SHOTS = os.environ.get("ANNZARRO_SHOTS")
LEGACY = ("gene-score", "layer", "label", "labelFull", "stat", "groupWas", "follow")


def _sel(axis, kind):
    return f'{C} select.axis-{kind}-select[data-axis="{axis}"]'


def _options(page, axis, kind):
    return page.evaluate("""(s) => [...document.querySelector(s).options].map(o => [o.value, o.textContent, o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : ''])""", _sel(axis, kind))


def _setting(page, axis):
    return page.evaluate("(a) => window.PanelManager.getPanel('cell-plot-C').getConfig()[a]", axis)


def _item(page, axis, text):
    value = next(v for v, t, _ in _options(page, axis, "column") if t == text)
    page.select_option(_sel(axis, "column"), value)


def _on_layer(page, axis):
    page.select_option(_sel(axis, "type"), "layer")
    until(page, "([s]) => document.querySelector(s).options.length > 1", [_sel(axis, "column")])


def test_the_item_picker_lists_signatures_in_sections_and_a_set_shows_the_aggregation_button(page, served):
    _open(page, served, plots=(("cell-plot-C", _cell(color={"type": "none", "key": "", "column": ""})),))
    _drawn(page)
    page.evaluate("async () => { const { DataManager } = await import('/static/js/data-manager.js'); DataManager.setFocusedGene('GAPDH'); }")
    types = [v for v, _, _ in _options(page, "color", "type")]
    assert "gene-score" not in types, f"no signature in the source column: {types}"
    _on_layer(page, "color")
    sections = [g for _, _, g in _options(page, "color", "column") if g]
    assert "Gene signatures" in sections, _options(page, "color", "column")
    assert not page.is_visible(f'{C} button.axis-agg-btn[data-axis="color"]'), "a single gene has nothing to aggregate"
    _item(page, "color", "T cell score")
    button = f'{C} button.axis-agg-btn[data-axis="color"]'
    page.wait_for_selector(button)
    assert page.inner_text(button).strip() == "z" and page.get_attribute(button, "aria-label") == "Aggregation: Z-score mean"
    assert page.evaluate("(s) => document.querySelector(s + ' .axis-agg-sym').classList.contains('agg-sym--over')", button), "z with a bar over it, drawn by CSS"
    assert _setting(page, "color")["type"] == "gene-score" and _setting(page, "color")["key"] == SIG
    assert page.input_value(_sel("color", "type")) == "layer", "the row reads layer, item, aggregation"
    assert page.locator(f"{C} select.axis-member-select, {C} input.group-filter").count() == 0, "a signature is a set itself: no member select, and no filter field in any row"
    assert [g for _, _, g in _options(page, "color", "column") if g][:1] == ["Genes"], _options(page, "color", "column")
    gene = next(t for _, t, g in _options(page, "color", "column") if g == "Genes")
    _item(page, "color", gene)
    until(page, "(s) => !document.querySelector(s)", button)
    assert _setting(page, "color")["type"] == "layer"


def test_the_aggregation_popover_lists_symbols_and_choosing_one_is_one_request(page, served):
    _open(page, served, plots=(("cell-plot-C", _cell(color=SCORE)),))
    button = f'{C} button.axis-agg-btn[data-axis="color"]'
    page.wait_for_selector(button)
    rows = [(r["v"], r["text"]) for r in axis_sets.aggregations(page, C, "color")]
    assert ("mean", "x Mean") in rows and ("sum", "\u03a3 Sum") in rows and ("zscore_mean", "z Z-score mean") in rows, rows
    before = page.evaluate("() => window.__scoreCalls.filter(c => c.kind === 'compute').length")
    axis_sets.choose_aggregation(page, C, "color", "sum")
    until(page, "(s) => document.querySelector(s).textContent.trim() === 'Σ'", button)
    assert page.get_attribute(button, "aria-label") == "Aggregation: Sum"
    until(page, "(n) => window.__scoreCalls.filter(c => c.kind === 'compute').length === n + 1", before)
    assert _setting(page, "color")["column"] == "sum"


def test_switching_back_to_a_normal_source_clears_the_aggregation_and_the_plot_draws(page, served):
    _open(page, served, plots=(("cell-plot-C", _cell(x=SCORE, color=SCORE)),))
    page.wait_for_selector(f'{C} button.axis-agg-btn[data-axis="x"]')
    page.select_option(_sel("x", "type"), "obsm")
    until(page, "(a) => { const s = window.PanelManager.getPanel('cell-plot-C').getConfig()[a]; return s.type === 'obsm'; }", "x")
    s = _setting(page, "x")
    assert s["type"] == "obsm" and not [f for f in LEGACY if f in s], s
    assert not page.is_visible(f'{C} button.axis-agg-btn[data-axis="x"]')
    until(page, "(t) => { const gd = document.querySelector(t + ' .js-plotly-plot'); return !!gd && Array.isArray(gd.data) && gd.data.some(d => (d.x || []).length > 5 && Array.from(d.x).every(v => typeof v === 'number')); }", C, timeout=30)


def test_three_aggregated_axes_are_three_one_line_rows(page, served):
    _open(page, served, plots=(("cell-plot-C", _cell(x=SCORE, y=SCORE, z=SCORE, color=SCORE)),))
    page.wait_for_selector(f'{C} button.axis-agg-btn[data-axis="color"]')
    boxes = page.evaluate("""(t) => ['x', 'y', 'color'].map((a) => { const row = document.querySelector(t + ` select.axis-type-select[data-axis="${a}"]`).closest('.axis-selector');
        const one = row.querySelector('.axis-type-select').getBoundingClientRect().height;
        return { axis: a, height: Math.round(row.getBoundingClientRect().height), select: Math.round(one),
                 extra: row.querySelectorAll('.axis-layer-select, .axis-stat-select').length }; })""", C)
    for b in boxes:
        assert b["extra"] == 0 and b["height"] <= b["select"] + 6, f"one line per axis: {b}"
    if SHOTS:
        page.screenshot(path=os.path.join(SHOTS, "axis-aggregate-cell.png"))


def test_a_link_made_with_the_signature_as_a_source_loads_into_the_new_row_with_the_same_plot(page, served):
    """The old form is what is stored (a signature is `{type: 'gene-score', key, column: method, layer}`), so a session, a URL or
    a preset made before the item picker draws the same plot, and its row reads layer, item, aggregation."""
    old = {**SCORE, "column": "mean", "layer": "counts"}
    _open(page, served, plots=(("cell-plot-C", _cell(x=UMAP_X, y=UMAP_Y, color=old)),))
    until(page, "() => window.__scoreCalls.some(c => c.kind === 'compute' && c.method === 'mean' && c.input === 'counts')")
    assert page.input_value(_sel("color", "type")) == "layer" and page.input_value(_sel("color", "key")) == "counts"
    assert page.input_value(_sel("color", "column")) == "\x01gene-score\x01" + SIG
    assert page.get_attribute(f'{C} button.axis-agg-btn[data-axis="color"]', "aria-label") == "Aggregation: Mean"
    assert _setting(page, "color")["type"] == "gene-score", "what is stored is unchanged"
    assert len([c for c in page.evaluate("() => window.__scoreCalls") if c["kind"] == "compute"]) == 1


def test_the_menu_is_the_method_table_in_its_order_with_the_default_chosen_on_a_new_axis(page, served):
    _open(page, served, plots=(("cell-plot-C", _cell(color={"type": "none", "key": "", "column": ""})),))
    _drawn(page)
    axis_sets.pick_set(page, C, "color", SIG)
    labels = page.evaluate("""async () => { const m = await import('/static/js/utils/signature-options.js');
        return { order: m.METHOD_INFO.map(x => [x.value, x.label]), def: m.DEFAULT_METHOD }; }""")
    rows = axis_sets.aggregations(page, C, "color")
    assert [(r["v"], r["name"]) for r in rows] == [tuple(x) for x in labels["order"]], "the table's order and its labels"
    assert [r["v"] for r in rows if r["on"]] == [labels["def"]] == ["zscore_mean"], "the default is chosen on a new axis"
    assert len({r["sym"] for r in rows}) == len(rows), "one symbol per method"
    assert [(r["v"], r["over"]) for r in rows if r["over"]] == [("zscore_mean", True), ("mean", True)], "x and z carry their bar as CSS"


def test_the_menu_columns_line_up_and_a_disabled_entry_gives_its_reason(page, served):
    _open(page, served, plots=(("cell-plot-C", _cell(color=SCORE)),))
    button = f'{C} button.axis-agg-btn[data-axis="color"]'
    page.wait_for_selector(button)
    axis_sets.until_methods(page, "cell-plot-C", "color", "(o) => o.find(m => m.value === 'fraction_of_genes').disabled")
    page.click(button)
    xs = page.evaluate("""() => [...document.querySelectorAll("[data-popover='aggregation'] [data-agg]")].map(r => [Math.round(r.querySelector('.axis-agg-sym').getBoundingClientRect().left),
        Math.round(r.querySelector('.axis-agg-name').getBoundingClientRect().left)])""")
    assert len({a for a, _ in xs}) == 1 and len({b for _, b in xs}) == 1, f"every symbol and every name starts at one x: {xs}"
    off = page.evaluate("""() => { const r = document.querySelector("[data-popover='aggregation'] [data-agg='fraction_of_genes']");
        return { disabled: r.disabled, title: r.title, why: (r.querySelector('.axis-agg-why') || {}).textContent || '' }; }""")
    assert off["disabled"] and "Raise Expressed above" in off["title"] and off["why"] == off["title"], off
    assert page.evaluate("() => document.querySelector(\"[data-popover='aggregation'] [data-agg='zscore_mean']\").getAttribute('aria-checked')") == "true"
    page.keyboard.press("Escape")


@pytest.mark.skipif(not SHOTS, reason="screenshots only when ANNZARRO_SHOTS names a directory")
def test_screenshots_of_the_open_menu_of_a_signature_on_x(page, served):
    y = {"type": "layer", "key": "X", "column": "GAPDH"}
    _open(page, served, plots=(("cell-plot-C", _cell(x=SCORE, y=y, color={"type": "none", "key": "", "column": ""})),))
    page.wait_for_selector(f'{C} button.axis-agg-btn[data-axis="x"]')
    axis_sets.until_methods(page, "cell-plot-C", "x", "(o) => o.find(m => m.value === 'fraction_of_genes').disabled")
    os.makedirs(SHOTS, exist_ok=True)
    for theme in ("light", "dark"):
        page.evaluate("(t) => { document.documentElement.setAttribute('data-theme', t); document.documentElement.setAttribute('data-bs-theme', t); }", theme)
        page.click(f'{C} button.axis-agg-btn[data-axis="x"]')
        page.locator("[data-popover='aggregation']").wait_for(state="visible")
        box = page.locator(f"{C} .plot-controls").bounding_box()
        page.screenshot(path=os.path.join(SHOTS, f"agg-a-cell-signature-menu-open-{theme}.png"), clip={**box, "height": 330})
        page.keyboard.press("Escape")
        page.locator("[data-popover='aggregation']").wait_for(state="hidden")
