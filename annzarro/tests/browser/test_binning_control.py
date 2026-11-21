"""The shared binning control in a binned factor's card, in a real browser, against the real cell_groups route (G9b).

The store is the grouping fixture (tests/core/grouping_store.py): ``depth`` has 60% exact zeros, ``signed`` both signs,
``constant`` one value, ``score`` is continuous.

1.  The zero bin is on at once for a column with 25% or more zeros (SHR-15), as one undoable step; the control offers
    no zero bin for a column with a negative value.
2.  Invalid entry (GRP-5): the last valid value comes back with the sentence, and a valid one clears it.
3.  Methods, bins and range; log-spaced bins say which cells have no bin; fewer bins made than asked.
4.  Sliders on manual thresholds: drag, keyboard, and a line cannot cross its neighbour (GRP-5).
5.  Freeze thresholds and its Undo (SHR-17, GRP-12).
6.  Edges from cells shown / all cells (SHR-16), and the line that names the population.
7.  Degenerate data (SHR-46).
8.  Screenshots, light and dark.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import base64
import json
import os
import pathlib
import urllib.parse

import numpy as np
import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_grouping_panel import (  # noqa: E402,F401
    A, GA, DATA, N, _add, _grouping, _ready, _recipe, _state, page, served)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

CTRL = f"{A} .cgrp-binning .pbc"
SHOTS = os.environ.get("ANNZARRO_G9B_SHOTS")


def _binned(key, **binning):
    return {"source": {"type": "obs", "key": key}, "binning": {"method": "equal_count", **binning}}


def _open_binned(page, served, partitionings, subset=None):
    root, store = served
    tiles = {"type": "tile", "id": GA, "controlsVisible": True}
    view = {"v": 1, "layout": {"v": 1, "hierarchy": [tiles], "controlState": {GA: True},
                               "panelConfigs": {GA: _grouping(partitionings=partitionings)}}}
    if subset:
        view["subset"] = subset
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    page.goto(f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}")
    page.wait_for_selector(f"{A} .cgrp-panel .cgrp-status[data-state]", timeout=30000)
    if partitionings:
        _expand(page, 0)


def _expand(page, i):
    if not page.locator(f"{A} .cgrp-card[data-index='{i}'] .cgrp-card__body").count():
        page.click(f"{A} .cgrp-card[data-index='{i}'] .cgrp-card__toggle")
    page.wait_for_selector(CTRL)


def _ctrl_ready(page):
    """The reply has come: the edges line is there."""
    until(page, "(s) => { const e = document.querySelector(s + ' .pbc-edges-line'); return !!e && e.textContent.length > 0; }", CTRL)


def _binning(page, i=0):
    return _recipe(page)["partitionings"][i]["binning"]


def _message(page):
    return page.evaluate("(s) => (document.querySelector(s + ' .pbc-message:not([hidden])') || {}).textContent || ''", CTRL)


def _wait_binning(page, expected, i=0):
    until(page, "([id, i, want]) => JSON.stringify(window.PanelManager.getPanel(id).getRecipe().partitionings[i].binning) === want",
          [GA, i, json.dumps(expected)])


# ------------------------------------------------------------------ 1. the zero bin

def test_a_column_with_many_zeros_gets_the_zero_bin_at_once_as_one_undoable_step(page, served):
    _open_binned(page, served, [])
    _add(page, "column", type_="obs", key="depth")
    _expand(page, 0)
    _wait_binning(page, {"method": "equal_count", "zero_bin": True})
    assert page.is_checked(f"{CTRL} .pbc-zero")
    _ready(page)
    _ctrl_ready(page)
    labels = page.evaluate("(s) => [...document.querySelectorAll(s + ' .cgrp-card[data-index=\"0\"] .cgrp-level__label')].map(e => e.textContent)", A)
    assert labels[0] == "depth = 0"
    zeros = int((DATA.obs["depth"] == 0).sum())
    first = page.evaluate("(s) => document.querySelector(s + ' .cgrp-card[data-index=\"0\"] .cgrp-level__n').textContent", A)
    assert first == f"{zeros:,}"
    # one step: the add, then the default
    assert _state(page)["undo"] == 2
    page.click(f"{A} .cgrp-undo")
    _wait_binning(page, {"method": "equal_count"})
    # it is not put back on by the repaint that follows
    page.uncheck(f"{CTRL} .pbc-zero") if page.is_checked(f"{CTRL} .pbc-zero") else None
    assert not page.is_checked(f"{CTRL} .pbc-zero")


def test_a_column_with_fewer_zeros_does_not_and_a_signed_one_has_no_zero_bin_to_offer(page, served):
    _open_binned(page, served, [_binned("score")])
    _ready(page)
    _ctrl_ready(page)
    assert not page.is_checked(f"{CTRL} .pbc-zero")
    assert _binning(page) == {"method": "equal_count"}
    _add(page, "column", type_="obs", key="signed")
    _expand(page, 1)
    until(page, "(s) => document.querySelectorAll(s + ' .pbc').length === 2", f"{A} .cgrp-binning")
    assert page.locator(f"{A} .cgrp-card[data-index='1'] .pbc-zero").count() == 0


# ------------------------------------------------------------------ 2. invalid entry

def test_an_invalid_bin_count_brings_the_last_value_back_with_the_sentence(page, served):
    _open_binned(page, served, [_binned("score")])
    _ready(page)
    _ctrl_ready(page)
    for bad in ("1", "1001", "3.5", "abc", ""):
        page.fill(f"{CTRL} .pbc-bins", bad)
        page.press(f"{CTRL} .pbc-bins", "Enter")
        until(page, "(s) => document.querySelector(s + ' .pbc-message:not([hidden])') !== null", CTRL)
        assert _message(page) == "Enter a whole number from 2 to 1,000.", bad
        assert page.input_value(f"{CTRL} .pbc-bins") == "4", bad
        assert _binning(page) == {"method": "equal_count"}, bad
    page.fill(f"{CTRL} .pbc-bins", "6")
    page.press(f"{CTRL} .pbc-bins", "Enter")
    _wait_binning(page, {"method": "equal_count", "bins": 6})
    until(page, "(s) => document.querySelector(s + ' .pbc-message:not([hidden])') === null", CTRL)
    assert page.input_value(f"{CTRL} .pbc-bins") == "6"


def test_invalid_thresholds_bring_the_last_ones_back_and_valid_ones_are_sorted(page, served):
    _open_binned(page, served, [{"source": {"type": "obs", "key": "score"}, "binning": {"method": "manual", "thresholds": [3, 6]}}])
    _ready(page)
    assert page.input_value(f"{CTRL} .pbc-thresholds") == "3, 6"
    page.fill(f"{CTRL} .pbc-thresholds", "3, x")
    page.press(f"{CTRL} .pbc-thresholds", "Enter")
    until(page, "(s) => document.querySelector(s + ' .pbc-message:not([hidden])') !== null", CTRL)
    assert _message(page) == "Enter numbers separated by commas."
    assert page.input_value(f"{CTRL} .pbc-thresholds") == "3, 6"
    page.fill(f"{CTRL} .pbc-thresholds", "7, 2.5, 7")
    page.press(f"{CTRL} .pbc-thresholds", "Enter")
    _wait_binning(page, {"method": "manual", "thresholds": [2.5, 7]})
    assert page.input_value(f"{CTRL} .pbc-thresholds") == "2.5, 7"


# ------------------------------------------------------------------ 3. methods

def test_methods_change_the_recipe_and_log_spaced_bins_say_which_cells_have_no_bin(page, served):
    _open_binned(page, served, [_binned("depth", zero_bin=False)])
    _ready(page)
    _ctrl_ready(page)
    options = page.eval_on_selector_all(f"{CTRL} .pbc-method option", "(o) => o.map(e => e.textContent)")
    assert options == ["Equal count", "Equal width", "Log-spaced", "Manual thresholds"]
    page.select_option(f"{CTRL} .pbc-method", "equal_width")
    _wait_binning(page, {"method": "equal_width"})
    page.select_option(f"{CTRL} .pbc-method", "log")
    _wait_binning(page, {"method": "log"})
    zeros = int((DATA.obs["depth"] == 0).sum())
    until(page, "(s) => /have no bin/.test(document.querySelector(s + ' .pbc-notes').textContent)", CTRL)
    assert page.inner_text(f"{CTRL} .pbc-notes") == f"{zeros:,} cells at or below 0 have no bin. Turn on Zero as its own bin to keep them."
    page.check(f"{CTRL} .pbc-zero")
    _wait_binning(page, {"method": "log", "zero_bin": True})
    until(page, "(s) => !/have no bin/.test(document.querySelector(s + ' .pbc-notes').textContent)", CTRL)


def test_a_range_on_equal_width_bins_clamps_and_says_how_many(page, served):
    _open_binned(page, served, [{"source": {"type": "obs", "key": "score"}, "binning": {"method": "equal_width"}}])
    _ready(page)
    _ctrl_ready(page)
    assert page.inner_text(f"{CTRL} .pbc-range-help") == "Values outside go into the first or last bin, labelled ≤ and ≥."
    page.fill(f"{CTRL} .pbc-range-lo", "3")
    page.fill(f"{CTRL} .pbc-range-hi", "7")
    page.press(f"{CTRL} .pbc-range-hi", "Enter")
    _wait_binning(page, {"method": "equal_width", "range": [3.0, 7.0]})
    outside = int(((DATA.obs["score"] < 3) | (DATA.obs["score"] > 7)).sum())
    until(page, "(s) => /outside the range/.test(document.querySelector(s + ' .pbc-notes').textContent)", CTRL)
    assert page.inner_text(f"{CTRL} .pbc-notes") == f"{outside:,} cells outside the range are in the end bins."
    page.fill(f"{CTRL} .pbc-range-lo", "9")
    page.press(f"{CTRL} .pbc-range-lo", "Enter")
    until(page, "(s) => document.querySelector(s + ' .pbc-message:not([hidden])') !== null", CTRL)
    assert page.input_value(f"{CTRL} .pbc-range-lo") == "3"


def test_fewer_bins_made_than_asked_is_said(page, served):
    # pseudotime has 25 distinct values: 30 equal-count bins merge
    _open_binned(page, served, [_binned("pseudotime", bins=30)])
    _ready(page)
    until(page, "(s) => /asked/.test(document.querySelector(s + ' .pbc-notes').textContent)", CTRL)
    text = page.inner_text(f"{CTRL} .pbc-notes")
    assert text.startswith("30 bins asked, ") and text.endswith(" made: many cells share the same value, so edges merged."), text


# ------------------------------------------------------------------ 4. sliders

def _lines(page):
    return page.evaluate("""(s) => [...document.querySelectorAll(s + ' .pbc-line[role="slider"]')].map(e => ({
        now: Number(e.getAttribute('aria-valuenow')), min: Number(e.getAttribute('aria-valuemin')),
        max: Number(e.getAttribute('aria-valuemax')), label: e.getAttribute('aria-label') }))""", CTRL)


def test_a_threshold_moves_by_the_keyboard_and_stops_at_its_neighbour(page, served):
    _open_binned(page, served, [{"source": {"type": "obs", "key": "score"}, "binning": {"method": "manual", "thresholds": [3, 6]}}])
    _ready(page)
    _ctrl_ready(page)
    lines = _lines(page)
    assert [x["now"] for x in lines] == [3, 6]
    assert lines[0]["label"] == "Threshold 1 of 2" and lines[0]["max"] == 6
    lo, hi = float(DATA.obs["score"].min()), float(DATA.obs["score"].max())
    step = (hi - lo) / 100
    page.focus(f"{CTRL} .pbc-line:nth-of-type(1)")
    page.keyboard.press("ArrowRight")
    until(page, "([id, v]) => Math.abs(window.PanelManager.getPanel(id).getRecipe().partitionings[0].binning.thresholds[0] - v) < 1e-9", [GA, 3 + step])
    # the focus survives the repaint, so the key can be pressed again
    assert page.evaluate("(s) => document.activeElement.getAttribute('aria-label')", CTRL) == "Threshold 1 of 2"
    page.keyboard.press("Shift+ArrowLeft")
    until(page, "([id, v]) => Math.abs(window.PanelManager.getPanel(id).getRecipe().partitionings[0].binning.thresholds[0] - v) < 1e-9", [GA, 3 + step - 10 * step])
    page.keyboard.press("End")
    until(page, "(id) => window.PanelManager.getPanel(id).getRecipe().partitionings[0].binning.thresholds[0] > 5.9", GA)
    assert _binning(page)["thresholds"][0] < 6
    assert _binning(page)["thresholds"][1] == 6


def test_a_threshold_is_dragged_on_the_chart_and_one_drag_is_one_undo_step(page, served):
    _open_binned(page, served, [{"source": {"type": "obs", "key": "score"}, "binning": {"method": "manual", "thresholds": [3, 6]}}])
    _ready(page)
    _ctrl_ready(page)
    undo_before = _state(page)["undo"]
    box = page.locator(f"{CTRL} .pbc-hist").bounding_box()
    line = page.locator(f"{CTRL} .pbc-line").first.bounding_box()
    x0, y = line["x"] + line["width"] / 2, line["y"] + line["height"] / 2
    page.mouse.move(x0, y)
    page.mouse.down()
    page.mouse.move(x0 + 20, y, steps=4)
    page.mouse.move(x0 + 40, y, steps=4)
    assert _binning(page)["thresholds"] == [3, 6], "nothing is committed while the line is held"
    page.mouse.up()
    until(page, "(id) => window.PanelManager.getPanel(id).getRecipe().partitionings[0].binning.thresholds[0] > 3", GA)
    moved = _binning(page)["thresholds"][0]
    lo, hi = float(DATA.obs["score"].min()), float(DATA.obs["score"].max())
    expected = 3 + 40 * (hi - lo) / box["width"]
    assert abs(moved - expected) < 0.35, (moved, expected)
    assert _state(page)["undo"] == undo_before + 1
    # dragged past the next line it stops short of it
    line = page.locator(f"{CTRL} .pbc-line").first.bounding_box()
    x1 = line["x"] + line["width"] / 2
    page.mouse.move(x1, y)
    page.mouse.down()
    page.mouse.move(box["x"] + box["width"] - 2, y, steps=6)
    page.mouse.up()
    until(page, "(id) => window.PanelManager.getPanel(id).getRecipe().partitionings[0].binning.thresholds[0] > 5", GA)
    ts = _binning(page)["thresholds"]
    assert ts[0] < ts[1] == 6
    page.click(f"{A} .cgrp-undo")
    until(page, "(id) => Math.abs(window.PanelManager.getPanel(id).getRecipe().partitionings[0].binning.thresholds[0] - %r) < 1e-9" % moved, GA)


# ------------------------------------------------------------------ 5. freeze

def test_freeze_keeps_todays_edges_as_manual_thresholds_and_undo_gives_the_method_back(page, served):
    _open_binned(page, served, [_binned("score")])
    _ready(page)
    _ctrl_ready(page)
    expected = [float(v) for v in np.quantile(DATA.obs["score"].to_numpy(), [0.25, 0.5, 0.75])]
    page.click(f"{CTRL} .pbc-freeze")
    until(page, "(id) => window.PanelManager.getPanel(id).getRecipe().partitionings[0].binning.method === 'manual'", GA)
    got = _binning(page)["thresholds"]
    assert len(got) == 3 and all(abs(a - b) < 1e-9 * max(1, abs(b)) for a, b in zip(got, expected)), (got, expected)
    assert page.eval_on_selector(f"{CTRL} .pbc-method", "(e) => e.value") == "manual"
    until(page, "(s) => !!document.querySelector(s + ' .pbc-frozen')", CTRL)
    assert page.inner_text(f"{CTRL} .pbc-frozen").startswith(f"Frozen from equal count on the {N:,} cells shown.")
    assert page.locator(f"{CTRL} .pbc-freeze").is_disabled()
    page.click(f"{CTRL} .pbc-undo")
    _wait_binning(page, {"method": "equal_count"})
    assert page.locator(f"{CTRL} .pbc-frozen").count() == 0
    # the panel's own Undo does the same for another freeze
    page.click(f"{CTRL} .pbc-freeze")
    until(page, "(id) => window.PanelManager.getPanel(id).getRecipe().partitionings[0].binning.method === 'manual'", GA)
    assert page.get_attribute(f"{A} .cgrp-undo", "title") == "Undo: freeze thresholds of score"
    page.click(f"{A} .cgrp-undo")
    _wait_binning(page, {"method": "equal_count"})


# ------------------------------------------------------------------ 6. edges from

def test_edges_from_all_cells_are_the_same_for_every_subset_and_the_line_names_the_population(page, served):
    _open_binned(page, served, [_binned("score", bins=3)], subset={"n": 6, "seed": 2, "part": 0})
    _ready(page)
    _ctrl_ready(page)
    shown = page.evaluate("() => window.DataManager.getCells().length")
    assert 0 < shown < N
    assert page.inner_text(f"{CTRL} .pbc-edges-line") == f"Edges from the {shown:,} cells shown."
    assert page.is_checked(f"{CTRL} .pbc-edges input[value='shown']")
    page.check(f"{CTRL} .pbc-edges input[value='all']")
    _wait_binning(page, {"method": "equal_count", "bins": 3, "edges_from": "all"})
    until(page, "(s) => /all/.test(document.querySelector(s + ' .pbc-edges-line').textContent)", CTRL)
    assert page.inner_text(f"{CTRL} .pbc-edges-line") == f"Edges from all {N:,} cells of the dataset."
    # freezing now gives the thresholds of the whole dataset
    page.click(f"{CTRL} .pbc-freeze")
    until(page, "(id) => window.PanelManager.getPanel(id).getRecipe().partitionings[0].binning.method === 'manual'", GA)
    expected = [float(v) for v in np.quantile(DATA.obs["score"].to_numpy(), [1 / 3, 2 / 3])]
    got = _binning(page)["thresholds"]
    assert all(abs(a - b) < 1e-9 * max(1, abs(b)) for a, b in zip(got, expected)), (got, expected)
    assert page.locator(f"{CTRL} .pbc-edges").count() == 0, "manual thresholds have no population"


# ------------------------------------------------------------------ 7. degenerate data

def test_a_column_of_one_value_says_so_and_invents_no_edge(page, served):
    _open_binned(page, served, [_binned("constant")])
    _ready(page)
    until(page, "(s) => /one value/.test(document.querySelector(s + ' .pbc-notes').textContent)", CTRL)
    assert page.inner_text(f"{CTRL} .pbc-notes") == "All cells share one value."
    labels = page.evaluate("(s) => [...document.querySelectorAll(s + ' .cgrp-card[data-index=\"0\"] .cgrp-level__label')].map(e => e.textContent)", A)
    assert labels == ["constant = 2.5"]
    assert page.locator(f"{CTRL} .pbc-line").count() == 0
    assert page.locator(f"{CTRL} .pbc-freeze").is_disabled()


# ------------------------------------------------------------------ 8. screenshots

@pytest.mark.skipif(not SHOTS, reason="set ANNZARRO_G9B_SHOTS to a folder to write the screenshots")
@pytest.mark.parametrize("theme", ["light", "dark"])
def test_screenshots(page, served, theme):
    out = pathlib.Path(SHOTS)
    out.mkdir(parents=True, exist_ok=True)
    page.emulate_media(color_scheme=theme)
    _open_binned(page, served, [_binned("depth", bins=5)])
    _ready(page)
    _ctrl_ready(page)
    page.locator(f"{A} .cgrp-card[data-index='0']").screenshot(path=str(out / f"binned-card-equal-count-{theme}.png"))
    page.select_option(f"{CTRL} .pbc-method", "manual")
    until(page, "(s) => document.querySelectorAll(s + ' .pbc-line').length > 0", CTRL)
    page.locator(f"{A} .cgrp-card[data-index='0']").screenshot(path=str(out / f"binned-card-manual-{theme}.png"))
