"""The Cell-Gene Plot's compact controls (aggregation-unify-080.md 5.1, package C1).

Color and Size are `[label] [layer ▾] [aggregation button]`; the threshold is in the button's pop-over and shown on the
button (`c⁺ >1`); the control rows are packed (Groups, Mode, Color, Size, Scale and Add genes share lines).

The example of 5.2: three sections (Markers as genes; Pathway and IFN as one row), dots, 2D.

The control area (`.cgene-controls`, the toolbar line included) for that example, measured in Chromium:

    before C1 (19f21a8e):   313 px at 1500 wide, 420 px at 700 wide
    after C1:               280 px at 1500 wide, 317 px at 700 wide
    after C2 (one line a one-row section):   214 px at 1500 wide, 251 px at 700 wide
    after C4 (sections are entity cards):    198 px at 1500 wide, 235 px at 700 wide

The design's 200 and 240 are met.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_gene_panel import (  # noqa: E402,F401
    GENES, P, S1, S2, S3, TP, _drawn, _open, _plot, _sig, page, served,
)
from annzarro.tests.browser import cgene_controls as CC  # noqa: E402
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

def _example(page, served):
    configs = {P: _plot(cellAxis={"type": "obs", "key": "cell_type"},
                        sections=[{"source": S1, "rows": "genes"}, {"source": S2, "rows": "set"}, {"source": S3, "rows": "set"}]),
               S1: _sig(S1, "Markers", GENES[0:3]), S2: _sig(S2, "Pathway", GENES[3:11]), S3: _sig(S3, "IFN", GENES[11:23])}
    _open(page, served, configs, open_ids=(P,))
    _drawn(page)


def _controls_height(page, width):
    page.set_viewport_size({"width": width, "height": 1000})
    page.wait_for_function("(s) => document.querySelector(s + ' .cgene-controls').getBoundingClientRect().width > 0", arg=TP)
    return page.evaluate("(s) => Math.round(document.querySelector(s + ' .cgene-controls').getBoundingClientRect().height)", TP)


def test_control_area_height(page, served):
    """The 3-section example: the control area is no taller than C2 makes it (the design's 200 and 240)."""
    _example(page, served)
    wide = _controls_height(page, 1500)
    narrow = _controls_height(page, 700)
    assert wide <= 200, wide
    assert narrow <= 240, narrow


def test_first_line_holds_groups_mode_color_size_scale_and_add_genes(page, served):
    _example(page, served)
    page.set_viewport_size({"width": 1500, "height": 1000})
    tops = page.evaluate("""(s) => [".cgene-axis-type", ".cgene-mode", ".cgene-color-layer", ".cgene-size-layer", ".cgene-scale", ".cgene-add"]
        .map((c) => Math.round(document.querySelector(s + ' ' + c).getBoundingClientRect().top))""", TP)
    assert max(tops) - min(tops) <= 6, tops


def _row_children(page, which):
    return page.evaluate("""([s, w]) => [...document.querySelector(s + ' .cgene-measure__parts').parentElement.parentElement
        .querySelectorAll(':scope .cgene-field--' + w + ' .cgene-measure__parts > *')].map((e) => e.tagName.toLowerCase() + '.' + [...e.classList].find((c) => c === 'cgene-' + w || c === 'cgene-' + w + '-layer'))""", [TP, which])


def test_color_is_layer_then_agg_button(page, served):
    _example(page, served)
    assert _row_children(page, "color") == ["select.cgene-color-layer", "button.cgene-color"]
    assert page.locator(f"{TP} select.cgene-color, {TP} input.cgene-color-above").count() == 0, "no statistic select, no threshold box in the row"
    assert page.get_attribute(f"{TP} button.cgene-color", "aria-label") == "Color: aggregation: Mean"


def test_channel_menu_equals_statistic_info(page, served):
    """Order and names of the menu: every statistic of STATISTIC_INFO, then Cell count; each with its symbol."""
    _example(page, served)
    names = ["Z-score mean", "Mean", "Fraction of cells", "Mean of expressing cells", "Sum", "SD", "Cell count"]
    for which in ("color", "size"):
        assert CC.stat_names(page, TP, which) == names
    CC.open_menu(page, TP, "color")
    syms = page.eval_on_selector_all(f"{CC.MENU} [data-agg] .axis-agg-sym", "os => os.map(o => o.textContent)")
    CC.close_menu(page)
    assert syms == ["z", "x", "c⁺", "x⁺", "Σ", "σ", "n"], syms


def test_threshold_lives_in_the_popover_and_shows_on_the_button(page, served):
    configs = {P: _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=[{"source": S1, "rows": "genes"}],
                        size={"stat": "fraction_of_cells", "layer": "logged", "detect_above": 1}),
               S1: _sig(S1, "Markers", GENES[0:3])}
    _open(page, served, configs, open_ids=(P,))
    _drawn(page)
    assert page.locator(f"{TP} .cgene-controls input.cgene-size-above").count() == 0, "no box in the row"
    assert page.inner_text(f"{TP} button.cgene-size").replace(" ", "").endswith(">1")
    assert CC.above(page, TP, "size")["value"] == "1"
    assert CC.above(page, TP, "color") is None, "a mean uses no threshold"
    CC.set_above(page, TP, "size", "2")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().size.detect_above === 2", P)
    assert page.inner_text(f"{TP} button.cgene-size").replace(" ", "").endswith(">2")


def test_cell_count_hides_the_layer(page, served):
    _example(page, served)
    assert page.locator(f"{TP} select.cgene-size-layer").is_visible()
    CC.pick_stat(page, TP, "size", "count")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().size.stat === 'count'", P)
    assert page.locator(f"{TP} select.cgene-size-layer").is_hidden()
    assert page.inner_text(f"{TP} button.cgene-size").strip() == "n"


def test_height_lists_same_as_color_first(page, served):
    configs = {P: _plot(cellAxis={"type": "obs", "key": "cell_type"}, sections=[{"source": S1, "rows": "genes"}], view="3d"),
               S1: _sig(S1, "Markers", GENES[0:3])}
    _open(page, served, configs, open_ids=(P,))
    _drawn(page)
    entries = CC.stat_entries(page, TP, "height")
    assert entries[0]["v"] == "__same_as_color__" and entries[0]["on"]
    assert [e["v"] for e in entries[1:]] == ["zscore_mean", "mean", "fraction_of_cells", "mean_expressing", "sum", "sd", "count"]


def test_one_undo_step_per_pick(page, served):
    _example(page, served)
    before = page.evaluate("(id) => window.PanelManager.getPanel(id)._debugState().undo", P)
    CC.pick_stat(page, TP, "color", "sum")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().color.stat === 'sum'", P)
    assert page.evaluate("(id) => window.PanelManager.getPanel(id)._debugState().undo", P) == before + 1
    page.click(f"{TP} .cgene-undo")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().color.stat === 'mean'", P)
    assert CC.chosen_stat(page, TP, "color") == "mean"


def test_the_aggregation_button_called_as_before_is_what_it_was(page, served):
    """`suffix`, `fields` and `onField` are optional: a caller that gives none (the axis rows) gets the button it had."""
    _example(page, served)
    out = page.evaluate("""async () => {
        const { createAggregationButton } = await import('/static/js/ui/aggregation-button.js');
        const sym = { text: 'x', over: false };
        const picked = [];
        const made = createAggregationButton({ label: 'Aggregation', methods: () => ({ options: [{ value: 'a', name: 'Alpha', symbol: sym },
            { value: 'b', name: 'Beta', symbol: sym, disabled: true, title: 'why' }], chosen: 'a' }), onPick: (v) => picked.push(v) });
        document.body.append(made.button);
        made.button.click();
        const menu = document.querySelector("[data-popover='aggregation']");
        const out = { text: made.button.textContent, label: made.button.getAttribute('aria-label'), suffix: !!made.button.querySelector('.axis-agg-suffix'),
            fields: menu.querySelectorAll('input').length, items: [...menu.querySelectorAll('[data-agg]')].map((i) => [i.dataset.agg, i.disabled, i.title]) };
        made.destroy();
        return out;
    }""")
    assert out == {"text": "x", "label": "Aggregation: Alpha", "suffix": False, "fields": 0, "items": [["a", False, ""], ["b", True, "why"]]}, out
