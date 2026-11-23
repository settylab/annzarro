"""Cell-Gene Plot: the one-row section's Color and Size, and the plot's own Statistics offered, are pop-overs (WP-8).

Neither may change the size or flow of the panel: the operator's complaint was that folding sections change the panel's
minimum size and move the layout (operator-feedback-2026-11-23).

1.  Switching a section to One row changes the section list's height by at most one row.
2.  Opening the plot's own Statistics offered (obs axis) leaves the plot box where it was.
3.  Escape closes the section's values pop-over and focus goes back to its button; the edits inside apply live.
4.  "Offer other…" on an obs axis opens the Statistics offered pop-over.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_gene_panel import (  # noqa: E402,F401
    GENES, P, S1, TP, _config, _drawn, _open, _plot, _sig, page, served)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

OBS = {"type": "obs", "key": "cell_type"}
SECTION = f"{TP} .cgene-section[data-index='0']"
VALUES_BUTTON = f"{SECTION} .cgene-section__values-btn"
VALUES_POP = "[data-popover='values']"
OFFER_POP = "[data-popover='statistics']"


def _box(page, selector):
    return page.eval_on_selector(selector, "e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round); }")


def _one_section(page, served, rows="genes"):
    configs = {P: _plot(cellAxis=OBS, sections=[{"source": S1, "rows": rows}]), S1: _sig(S1, "Markers", GENES[0:6])}
    _open(page, served, configs, open_ids=(P, S1))
    _drawn(page)


def test_switching_a_section_to_one_row_changes_the_list_height_by_at_most_one_row(page, served):
    _one_section(page, served)
    before = _box(page, f"{TP} .cgene-sections")[3]
    row = _box(page, SECTION)[3]
    page.locator(f"{SECTION} input[value='set']").check()
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().sections[0].rows === 'set'", P)
    page.wait_for_selector(f"{SECTION} .cgene-section__head")
    after = _box(page, f"{TP} .cgene-sections")[3]
    assert after - before <= row, (before, after, row)


def test_opening_the_plots_statistics_offered_leaves_the_plot_where_it_was(page, served):
    _one_section(page, served)
    plot_before = _box(page, f"{TP} .cgene-plot")
    panel_before = _box(page, f"{TP} .cgene-panel")
    page.locator(f"{TP} .cgene-offer button:visible").first.click()
    page.wait_for_selector(OFFER_POP, state="visible")
    assert _box(page, f"{TP} .cgene-plot") == plot_before
    assert _box(page, f"{TP} .cgene-panel") == panel_before


def test_escape_closes_the_values_popover_and_focus_returns_to_its_button(page, served):
    _one_section(page, served, rows="set")
    page.click(VALUES_BUTTON)
    page.wait_for_selector(VALUES_POP, state="visible")
    assert page.locator(f"{VALUES_POP} .cgene-section__agg[data-which='color']").input_value() == "mean_of_means"
    page.keyboard.press("Escape")
    page.wait_for_selector(VALUES_POP, state="detached")
    assert page.evaluate("(s) => document.activeElement === document.querySelector(s)", VALUES_BUTTON)


def test_offer_other_on_an_obs_axis_opens_the_statistics_offered_popover(page, served):
    _open(page, served, {P: _plot(cellAxis=OBS, sections=[])})
    until(page, "([s]) => { const o = document.querySelector(`${s} .cgene-color-layer option[value=\"counts\"]`); return !!o && !o.disabled; }", [TP], timeout=30)
    page.select_option(f"{TP} .cgene-color-layer", "__offer_other__")
    page.wait_for_selector(OFFER_POP, state="visible")
    assert page.input_value(f"{TP} .cgene-color-layer") == "logged"
