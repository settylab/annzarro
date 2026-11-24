"""Reset names: the Settings button "Reset group names (n)" and a factor's own "Reset names" (0.8.0, operator feedback)."""
from annzarro.tests.browser import waits  # noqa: E402
from annzarro.tests.browser.test_cell_grouping_panel import (  # noqa: E402,F401
    A, CELL_TYPE, GA, _grouping, _open, _ready, page, served)
from annzarro.tests.browser.test_cell_grouping_rename import EDIT, P as LP  # noqa: E402
from annzarro.tests.browser.test_grouping_palettes import SETTINGS, SETTINGS_BUTTON, _computes, _undo_size  # noqa: E402
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

B = "B cell"


def _config(page):
    return page.evaluate("() => window.PanelManager.getPanel('cell-grouping-A').getConfig()")


def test_reset_group_names_removes_labels_keeps_colours_one_undo_step_no_request(page, served):
    overrides = [{"name": B, "label": "B lymphocytes", "color": "#fedcba"}, {"name": "T cell", "label": "T"}]
    _open(page, served, {GA: _grouping(partitionings=[CELL_TYPE], groupOverrides=overrides)}, (GA,))
    page.click(SETTINGS_BUTTON)
    page.wait_for_selector(SETTINGS, state="visible")
    button = f"{SETTINGS} .cgrp-group-names-reset"
    assert page.inner_text(button) == "Reset group names (2)"
    asked, undo = len(_computes(page)), _undo_size(page)
    page.click(button)
    until(page, "() => !(window.PanelManager.getPanel('cell-grouping-A').getConfig().groupOverrides || []).some((o) => o.label)")
    assert _config(page)["groupOverrides"] == [{"name": B, "color": "#fedcba"}]
    assert _undo_size(page) == undo + 1
    assert page.inner_text(button) == "Reset group names (0)" and page.is_disabled(button)
    waits.expect_stays(lambda: len(_computes(page)) == asked, "a name is a label: past the live delay a request would have gone", page=page, seconds=1.0)
    page.click(f"{A} .cgrp-undo")
    until(page, "() => (window.PanelManager.getPanel('cell-grouping-A').getConfig().groupOverrides || []).some((o) => o.label === 'T')")


def test_a_factors_reset_names_removes_its_level_labels(page, served):
    _open(page, served, {GA: _grouping(partitionings=[{**CELL_TYPE, "labels": {"c:B cell": "Bs"}}])}, (GA,))
    _ready(page)
    page.click(EDIT)
    button = f"{LP} .cgrp-names-reset"
    page.wait_for_selector(button)
    assert page.is_enabled(button)
    page.click(button)
    until(page, "() => !window.PanelManager.getPanel('cell-grouping-A').getRecipe().partitionings[0].labels")
    assert page.is_disabled(button)
