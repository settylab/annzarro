"""A group can be renamed in the grid, and given a colour in the same place (operator decision 38).

An override is `groupOverrides: [{name, label?, color?}]`, keyed by the group's GENERATED name (its level labels joined by the
separator). The label is what every panel that shows the grouping calls the group; no request goes out for it.

1.  Renaming from the grid (double-click, ✎ or F2) changes the grid, the Cell Plot legend and the Cell-Gene axis with no
    request; Undo restores it.
2.  The ways out: Enter or ✓ saves; Escape or ✕ cancels; a click elsewhere saves; Tab saves and edits the next group; Reset.
3.  The colour beside the field is the group's own colour in the grid and the Cell Plot legend; Undo restores. (The Cell-Gene
    strips draw each FACTOR's level colours, so a group's own colour is not on them; a level's colour is, test 5.)
4.  An override no group matches goes inactive, is listed at the bottom with Drop, applies again when a group of that name is
    back, and Drop removes it.
5.  A level's colour beside its name editor in a factor's levels pop-over; the Cell-Gene strip shows it.
6.  A label another group already has is qualified.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
from annzarro.tests.browser.test_cell_group_plots import by
from annzarro.tests.browser.test_cell_gene_panel import GENES, P as GP, S1, TP as GT, _plot as _gene_plot, _sig  # noqa: E402
from annzarro.tests.browser.test_grouping_palettes import (  # noqa: E402,F401
    A, C, CELL_TYPE, GA, LEVELS, P, TWO, _computes, _config, _grid, _open, _plot, _plot_colours, _rgb, _strip_colours, _undo_size,
    _wait_plot, EDIT, TYPES, page, served)
from annzarro.tests.browser import waits  # noqa: E402
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402
from annzarro.tests.browser.test_cell_grouping_panel import _grouping  # noqa: E402

B = "B cell"
ROW = f"{A} .cgg-row:has(.cgg-name:text-is('{B}'))"
EDITOR = f"{A} .cgg-edit"
FIELD = f"{EDITOR} input.cgg-edit__name"
INACTIVE = f"{A} .cgg__inactive"


def _configs(**grouping):
    return {P: _plot(color=by(GA)),
            GA: _grouping(partitionings=[CELL_TYPE], **grouping),
            GP: _gene_plot(cellAxis={"type": "cell-group", "key": GA}, sections=[{"source": S1, "rows": "genes"}]),
            S1: _sig(S1, "Markers", GENES[:4])}


def _open_all(page, served, **grouping):
    _open(page, served, _configs(**grouping), (P, GA, GP, S1))
    _wait_plot(page, TYPES)
    until(page, f"() => document.querySelector('{GT} .cgene-panel').dataset.state === 'ready'", timeout=60)


def _axis_labels(page):
    return page.evaluate(f"() => document.querySelector('{GT} .cgene-plot').layout.yaxis.ticktext")


def _legend_names(page):
    return [name for name in _plot_colours(page)]


def _names(page):
    return list(_grid(page))


def _gone(page, selector):
    until(page, "(s) => !document.querySelector(s)", selector)


def test_a_group_renamed_in_the_grid_is_renamed_in_every_panel_with_no_request_and_undo_restores_it(page, served):
    _open_all(page, served)
    asked = len(_computes(page))
    before = _undo_size(page)
    page.dblclick(f"{ROW} .cgg-name")
    page.wait_for_selector(FIELD)
    page.fill(FIELD, "B lymphocytes")
    page.keyboard.press("Enter")
    _gone(page, f"{A} .cgg-edit")
    _wait_plot(page, ["B lymphocytes"])
    assert "B lymphocytes" in _names(page) and B not in _names(page)
    assert "B lymphocytes" in _legend_names(page), "the Cell Plot legend"
    until(page, "(s) => document.querySelector(s + ' .cgene-plot').layout.yaxis.ticktext.includes('B lymphocytes')", GT)
    assert _config(page)["groupOverrides"] == [{"name": B, "label": "B lymphocytes"}], "keyed by the generated name"
    assert _undo_size(page) == before + 1
    waits.expect_stays(lambda: len(_computes(page)) == asked, "a name is a label: past the live delay a request would have gone", page=page, seconds=1.0)
    page.click(f"{A} .cgrp-undo")
    _wait_plot(page, [B])
    assert B in _names(page) and "groupOverrides" not in _config(page)
    until(page, "(s) => document.querySelector(s + ' .cgene-plot').layout.yaxis.ticktext.includes('B cell')", GT)


def test_the_ways_out_of_a_group_name_editor(page, served):
    _open(page, served, {GA: _grouping(partitionings=[CELL_TYPE])}, (GA,))
    _grid(page)
    # ✎ opens it, Escape cancels
    page.hover(ROW)
    page.click(f"{ROW} .cgg-rename")
    page.wait_for_selector(FIELD)
    page.fill(FIELD, "never")
    page.keyboard.press("Escape")
    _gone(page, f"{A} .cgg-edit")
    assert B in _names(page) and "groupOverrides" not in _config(page)
    # F2 on the row opens it, ✕ cancels, ✓ saves
    page.focus(ROW)
    page.keyboard.press("F2")
    page.wait_for_selector(FIELD)
    page.fill(FIELD, "never")
    page.click(f"{EDITOR} .cgg-edit__cancel")
    _gone(page, f"{A} .cgg-edit")
    assert "groupOverrides" not in _config(page)
    page.dblclick(f"{ROW} .cgg-name")
    page.fill(FIELD, "by button")
    page.click(f"{EDITOR} .cgg-edit__ok")
    _gone(page, f"{A} .cgg-edit")
    assert _config(page)["groupOverrides"] == [{"name": B, "label": "by button"}]
    # a click elsewhere saves
    row = f"{A} .cgg-row:has(.cgg-name:text-is('by button'))"
    page.dblclick(f"{row} .cgg-name")
    page.fill(FIELD, "by click")
    page.click(f"{A} .cgrp-status")
    _gone(page, f"{A} .cgg-edit")
    assert _config(page)["groupOverrides"] == [{"name": B, "label": "by click"}]
    # Reset (the name and the colour go)
    row = f"{A} .cgg-row:has(.cgg-name:text-is('by click'))"
    page.hover(row)
    page.click(f"{row} .cgg-reset")
    page.wait_for_selector(f"{A} .cgg-row:has(.cgg-name:text-is('by click'))", state="detached")
    assert "groupOverrides" not in _config(page) and B in _names(page)


def test_tab_saves_and_edits_the_next_group(page, served):
    _open(page, served, {GA: _grouping(partitionings=[CELL_TYPE])}, (GA,))
    names = _names(page)
    page.dblclick(f"{ROW} .cgg-name")
    page.fill(FIELD, "first")
    page.keyboard.press("Tab")
    until(page, "() => !!document.querySelector('.cgg-edit') && document.activeElement.matches('input.cgg-edit__name')")
    assert page.input_value(FIELD) == names[1], "the next group's name"
    page.fill(FIELD, "second")
    page.keyboard.press("Tab")
    until(page, "() => (window.PanelManager.getPanel('cell-grouping-A').getConfig().groupOverrides || []).length === 2")
    assert [o["label"] for o in _config(page)["groupOverrides"]] == ["first", "second"]


def test_the_colour_beside_the_field_is_the_groups_colour_everywhere_and_undo_restores_it(page, served):
    _open_all(page, served)
    before_colours = _rgb(page, [_plot_colours(page)[B]])
    before = _undo_size(page)
    page.dblclick(f"{ROW} .cgg-name")
    page.wait_for_selector(FIELD)
    assert page.get_attribute(f"{EDITOR} input.cgg-edit__color", "aria-label") == "Color of this group"
    assert page.get_attribute(f"{EDITOR} input.cgg-edit__color", "tabindex") is None, "keyboard-reachable"
    page.fill(f"{EDITOR} input.cgg-edit__color", "#fedcba")
    until(page, "([s]) => { const gd = document.querySelector(s + ' .js-plotly-plot'); return !!gd && gd.data.some(d => d.name === 'B cell' && d.marker.color === '#fedcba'); }", [C])
    assert _rgb(page, [_grid(page)[B]]) == _rgb(page, ["#fedcba"]), "the grid"
    assert _config(page)["groupOverrides"] == [{"name": B, "color": "#fedcba"}]
    assert page.locator(FIELD).count() == 1, "the field stays open while a colour is chosen"
    page.keyboard.press("Escape")
    assert _undo_size(page) == before + 1
    page.click(f"{A} .cgrp-undo")
    until(page, "(s) => !(window.PanelManager.getPanel('cell-grouping-A').getConfig().groupOverrides)")
    until(page, "([s, c]) => { const gd = document.querySelector(s + ' .js-plotly-plot'); return !!gd && !gd.data.some(d => d.marker && d.marker.color === '#fedcba'); }", [C, before_colours])


def test_an_override_no_group_matches_is_kept_listed_at_the_bottom_reapplies_and_is_dropped(page, served):
    overrides = [{"name": B, "label": "B lymphocytes", "color": "#fedcba"}, {"name": "Gone", "color": "#010203"}]
    _open(page, served, {GA: _grouping(partitionings=[CELL_TYPE], groupOverrides=overrides)}, (GA,))
    until(page, "() => !!document.querySelector('.cgg__inactive:not([hidden])')")
    assert page.locator(f"{INACTIVE} .cgg-inactive-row").count() == 1
    assert page.inner_text(f"{INACTIVE} .cgg-inactive-name") == "Gone"
    assert "B lymphocytes" in _names(page)
    # rename the level: the generated name moves, the group's override goes inactive and is kept
    page.click(EDIT)
    page.wait_for_selector(LEVELS)
    page.click(f"{LEVELS} .cgrp-level[data-id='c:B cell'] .cgrp-level__rename")
    page.fill(f"{LEVELS} input.cgrp-level__name", "B renamed")
    page.keyboard.press("Enter")
    until(page, "() => !document.querySelector('.cgrp-level--editing')")
    until(page, "() => document.querySelectorAll('.cgg-inactive-row').length === 2")
    names = page.eval_on_selector_all(f"{INACTIVE} .cgg-inactive-name", "els => els.map(e => e.textContent)")
    assert "B cell → B lymphocytes" in names and "Gone" in names
    assert len(_config(page)["groupOverrides"]) == 2, "kept, not dropped"
    assert "B renamed" in _names(page)
    # the level back: the override applies again
    page.click(f"{LEVELS} .cgrp-level[data-id='c:B cell'] .cgrp-level__rename")
    page.fill(f"{LEVELS} input.cgrp-level__name", "B cell")
    page.keyboard.press("Enter")
    until(page, "() => document.querySelectorAll('.cgg-inactive-row').length === 1")
    assert "B lymphocytes" in _names(page)
    # Drop removes one; Drop all inactive appears for several
    page.click(f"{INACTIVE} .cgg-drop")
    until(page, "() => !document.querySelector('.cgg__inactive:not([hidden])')")
    assert _config(page)["groupOverrides"] == [{"name": B, "label": "B lymphocytes", "color": "#fedcba"}]


def test_drop_all_inactive_removes_only_the_inactive_ones(page, served):
    overrides = [{"name": B, "label": "Bs"}, {"name": "Gone1", "color": "#010203"}, {"name": "Gone2", "label": "x"}]
    _open(page, served, {GA: _grouping(partitionings=[CELL_TYPE], groupOverrides=overrides)}, (GA,))
    until(page, "() => document.querySelectorAll('.cgg-inactive-row').length === 2")
    page.click(f"{INACTIVE} .cgg-drop-all")
    until(page, "() => !document.querySelector('.cgg__inactive:not([hidden])')")
    assert _config(page)["groupOverrides"] == [{"name": B, "label": "Bs"}]


def test_a_level_color_sits_beside_its_name_editor(page, served):
    _open_all(page, served)
    page.click(EDIT)
    page.wait_for_selector(LEVELS)
    page.click(f"{LEVELS} .cgrp-level[data-id='c:B cell'] .cgrp-level__rename")
    page.wait_for_selector(f"{LEVELS} .cgrp-level--editing input.cgrp-level-color")
    assert page.get_attribute(f"{LEVELS} .cgrp-level--editing input.cgrp-level-color", "aria-label") == "Color of B cell"
    page.fill(f"{LEVELS} .cgrp-level--editing input.cgrp-level-color", "#fedcba")
    until(page, "() => !!(window.PanelManager.getPanel('cell-grouping-A').getConfig().partitionings[0].colors)")
    assert _config(page)["partitionings"][0]["colors"]["overrides"] == {"c:B cell": "#fedcba"}
    assert page.locator(f"{LEVELS} .cgrp-level--editing").count() == 1, "the name editor stays open"
    assert _rgb(page, [_grid(page)[B]]) == _rgb(page, ["#fedcba"]), "the group of that level takes it"
    until(page, f"() => JSON.stringify(document.querySelector('{GT} .cgene-plot').data.filter(t => t.name === 'group strip').map(t => Array.from(t.marker.color))).includes('#fedcba')")


def test_a_label_another_group_has_is_qualified(page, served):
    _open(page, served, {GA: _grouping(partitionings=[CELL_TYPE], groupOverrides=[{"name": B, "label": "T cell"}])}, (GA,))
    names = _names(page)
    assert "T cell" in names and "T cell (2)" in names, names
