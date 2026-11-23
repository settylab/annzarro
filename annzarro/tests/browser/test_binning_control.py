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

from annzarro.tests.browser import waits  # noqa: E402
from annzarro.tests.browser.test_cell_grouping_panel import (  # noqa: E402,F401
    _captured_url, _requests, A, GA, DATA, N, _add, _grouping, _ready, _recipe, _state, page, served)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

BIN = "[data-popover='binning']"                  # a binned factor's Edit pop-over
CTRL = f"{BIN} .pbc"
SHOTS = os.environ.get("ANNZARRO_G9B_SHOTS")


def _binned(key, **binning):
    return {"source": {"type": "obs", "key": key}, "binning": {"method": "equal_count", **binning}}


def _open_binned(page, served, partitionings, subset=None, expand=True):
    root, store = served
    tiles = {"type": "tile", "id": GA, "controlsVisible": True}
    view = {"v": 1, "layout": {"v": 1, "hierarchy": [tiles], "controlState": {GA: True},
                               "panelConfigs": {GA: _grouping(partitionings=partitionings)}}}
    if subset:
        view["subset"] = subset
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    page.goto(f"{root}/?dataset_path={urllib.parse.quote(store, safe='/')}#view={enc}")
    page.wait_for_selector(f"{A} .cgrp-panel .cgrp-status[data-state]", timeout=30000)
    if partitionings and expand:
        _expand(page, 0)


def _expand(page, i):
    """Open factor i's Edit pop-over (a factor just added has opened its own)."""
    edit = f"{A} .cgrp-card[data-index='{i}'] .cgrp-card__edit"
    try:
        page.wait_for_selector(f"{edit}[aria-expanded='true']", timeout=1500)       # a factor just added opens its own
    except Exception:  # noqa: BLE001 - playwright's TimeoutError: it is not open, so open it
        page.click(edit)
    page.wait_for_selector(f"{edit}[aria-expanded='true']")
    page.wait_for_selector(CTRL)


def _ctrl_ready(page, card=0):
    """The reply has come: the preview is drawn."""
    until(page, "(s) => !!document.querySelector(s + ' .pbc-hist:not(.is-empty)')", BIN)


def _binning(page, i=0):
    return _recipe(page)["partitionings"][i]["binning"]


def _message(page):
    return page.evaluate("(s) => (document.querySelector(s + ' .pbc-message:not([hidden])') || {}).textContent || ''", CTRL)


def _wait_binning(page, expected, i=0):
    """The stored binning of factor ``i`` is ``expected`` (compared as data, so key order and 3 against 3.0 do not matter)."""
    until(page, """([id, i, want]) => { const sort = (v) => Array.isArray(v) ? v.map(sort) : v && typeof v === 'object'
            ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v;
        const got = window.PanelManager.getPanel(id).getRecipe().partitionings[i].binning;
        return JSON.stringify(sort(got)) === JSON.stringify(sort(want)); }""", [GA, i, expected])


# ------------------------------------------------------------------ 1. the zero bin

def test_a_column_with_many_zeros_gets_the_zero_bin_at_once_as_one_undoable_step(page, served):
    _open_binned(page, served, [])
    _add(page, "column", type_="obs", key="depth")
    _expand(page, 0)
    _wait_binning(page, {"method": "equal_count", "zero_bin": True})
    assert page.is_checked(f"{CTRL} .pbc-zero")
    _ready(page)
    _ctrl_ready(page)
    labels = page.evaluate("(s) => [...document.querySelectorAll(s + ' .cgrp-level__label')].map(e => e.textContent)", BIN)
    assert labels[0] == "depth = 0"
    zeros = int((DATA.obs["depth"] == 0).sum())
    first = page.evaluate("(s) => document.querySelector(s + ' .cgrp-level__n').textContent", BIN)
    assert first == f"{zeros:,}"
    # one step: the add, then the default
    assert _state(page)["undo"] == 2
    page.click(f"{A} .cgrp-undo")
    _wait_binning(page, {"method": "equal_count"})
    _expand(page, 0)        # the click on the panel's Undo was outside the pop-over: it closed
    # it is not put back on by the repaint that follows
    page.uncheck(f"{CTRL} .pbc-zero") if page.is_checked(f"{CTRL} .pbc-zero") else None
    assert not page.is_checked(f"{CTRL} .pbc-zero")


def test_a_column_with_fewer_zeros_does_not_and_a_signed_one_has_no_zero_bin_to_offer(page, served):
    _open_binned(page, served, [_binned("pseudotime")])
    _ready(page)
    _ctrl_ready(page)
    assert not page.is_checked(f"{CTRL} .pbc-zero")
    assert _binning(page) == {"method": "equal_count"}
    _add(page, "column", type_="obs", key="signed")
    _expand(page, 1)
    _ctrl_ready(page, 1)
    assert page.locator(f"{CTRL} .pbc-zero").count() == 0


def _histogram_requests(page):
    return [c for c in page.calls if not c.get("estimate_only") and c.get("want", {}).get("histograms")]


def test_a_link_with_factory_binning_on_zero_heavy_data_is_never_changed_and_histograms_follow_expansion(page, served):
    _open_binned(page, served, [_binned("depth")], expand=False)
    _ready(page)
    assert _histogram_requests(page) == [], "a collapsed card asks for no histogram"
    page.click(f"{A} .cgrp-card[data-index='0'] .cgrp-card__edit")
    _ctrl_ready(page)
    assert len(_histogram_requests(page)) == 1, "expanding asks for exactly one"
    page.click(f"{A} .cgrp-card[data-index='0'] .cgrp-card__edit")
    waits.expect_stays(lambda: len(_histogram_requests(page)) == 1 and len(_requests_all(page)) == len(page.calls),
                       "collapsing a card must send no request", page=page)
    n = len(page.calls)
    page.click(f"{A} .cgrp-card[data-index='0'] .cgrp-card__edit")
    _ctrl_ready(page)
    waits.expect_stays(lambda: len(page.calls) == n, "re-expanding keeps the histogram it has", page=page)
    # the user's factory binning from a link stays as it is, however many zeros
    waits.expect_stays(lambda: _binning(page) == {"method": "equal_count"}, "a linked factory binning is never auto-changed", page=page)
    assert not page.is_checked(f"{CTRL} .pbc-zero")


def _requests_all(page):
    return list(page.calls)


def test_turning_the_default_off_and_reloading_keeps_it_off(page, served):
    _open_binned(page, served, [])
    _add(page, "column", type_="obs", key="depth")
    _wait_binning(page, {"method": "equal_count", "zero_bin": True})
    _ctrl_ready(page)
    page.uncheck(f"{CTRL} .pbc-zero")
    _wait_binning(page, {"method": "equal_count"})
    link = _captured_url(page, served)
    page.goto("about:blank")
    page.goto(link)
    page.wait_for_selector(f"{A} .cgrp-panel .cgrp-status[data-state]", timeout=30000)
    _expand(page, 0)
    _ctrl_ready(page)
    waits.expect_stays(lambda: _binning(page) == {"method": "equal_count"} and not page.is_checked(f"{CTRL} .pbc-zero"),
                       "an explicit off survives a reload", page=page)


def test_the_bins_are_listed_with_their_cells_and_one_can_be_renamed(page, served):
    _open_binned(page, served, [_binned("depth", bins=3)])
    _ready(page)
    _ctrl_ready(page)
    card = BIN
    rows = page.evaluate("(s) => [...document.querySelectorAll(s + ' .cgrp-level')].map(e => [e.querySelector('.cgrp-level__label').textContent, e.querySelector('.cgrp-level__n').textContent])", card)
    summary = page.inner_text(f"{A} .cgrp-card[data-index='0'] .cgrp-card__summary")
    assert len(rows) >= 2 and summary.endswith(f"{len(rows)} levels"), (rows, summary)
    assert all(n for _, n in rows)
    assert page.locator(f"{card} .cgrp-level__rename").count() == len(rows), "every bin row can be renamed"
    page.click(f"{card} .cgrp-level__rename >> nth=1")
    page.fill(f"{card} .cgrp-level__name", "missing")
    page.press(f"{card} .cgrp-level__name", "Enter")
    until(page, "(id) => { const l = window.PanelManager.getPanel(id).getRecipe().partitionings[0].labels; return !!l && Object.values(l).includes('missing'); }", GA)
    until(page, "(s) => [...document.querySelectorAll(s + ' .cgrp-level__label')].some(e => e.textContent === 'missing')", card)


def test_a_new_binned_factor_costs_at_most_two_computes_and_a_missing_factor_keeps_the_positions_right(page, served):
    _open_binned(page, served, [{"source": {"type": "obs", "key": "condition"}}], expand=False)
    _ready(page)
    before = len(_requests(page))
    _add(page, "column", type_="obs", key="depth")
    _wait_binning(page, {"method": "equal_count", "zero_bin": True}, 1)
    _ctrl_ready(page, 1)
    _ready(page)
    sent = _requests(page)[before:]
    assert len(sent) == 2, [c["want"] for c in sent]
    assert sent[0]["want"]["histograms"] == [1], "the first request already asks for the preview"
    # a factor the dataset lacks computes nothing; removing it moves the card to position 0 and the histogram follows
    page.goto("about:blank")
    page.calls.clear()
    _open_binned(page, served, [_binned("nosuch"), _binned("depth", bins=3)], expand=False)
    _expand(page, 1)
    waits.expect_stays(lambda: not _histogram_requests(page), "nothing is computed while a factor is missing", page=page)
    page.click(f"{A} .cgrp-card[data-index='0'] .cgrp-card__more")
    page.click(f"{A} .cgrp-card[data-index='0'] [data-op='remove']")
    _expand(page, 0)        # the click on the other card's menu was outside the pop-over: it closed
    _ctrl_ready(page, 0)
    assert _histogram_requests(page)[-1]["want"]["histograms"] == [0]


def test_a_renamed_bin_survives_a_reload_and_keeps_its_label_when_the_edges_move(page, served):
    _open_binned(page, served, [_binned("score", bins=3)])
    _ready(page)
    _ctrl_ready(page)
    card = BIN
    was = page.evaluate("(s) => document.querySelectorAll(s + ' .cgrp-level__label')[1].textContent", card)
    page.click(f"{card} .cgrp-level__rename >> nth=1")
    page.fill(f"{card} .cgrp-level__name", "low depth")
    page.press(f"{card} .cgrp-level__name", "Enter")
    until(page, "(id) => { const l = window.PanelManager.getPanel(id).getRecipe().partitionings[0].labels; return !!l && Object.values(l).includes('low depth'); }", GA)
    assert list(_recipe(page)["partitionings"][0]["labels"].values()) == ["low depth"]
    link = _captured_url(page, served)
    page.goto("about:blank")
    page.goto(link)
    page.wait_for_selector(f"{A} .cgrp-panel .cgrp-status[data-state]", timeout=30000)
    _expand(page, 0)
    _ready(page)
    until(page, "(s) => [...document.querySelectorAll(s + ' .cgrp-level__label')].some(e => e.textContent === 'low depth')", card)
    # the edges move: the label stays on its level, with the hover that says what it was
    page.fill(f"{CTRL} .pbc-bins", "5")
    page.press(f"{CTRL} .pbc-bins", "Enter")
    _wait_binning(page, {"method": "equal_count", "bins": 5})
    until(page, "(s) => document.querySelectorAll(s + ' .cgrp-level').length === 5", card)
    title = page.evaluate("(s) => { const e = [...document.querySelectorAll(s + ' .cgrp-level__label')].find(x => x.textContent === 'low depth'); return e ? e.title : null; }", card)
    assert title and title.startswith("Was: "), title
    assert was.startswith("score"), was


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
    _open_binned(page, served, [_binned("depth", bins=5)])
    _ready(page)
    _ctrl_ready(page)
    options = page.eval_on_selector_all(f"{CTRL} .pbc-method option", "(o) => o.map(e => e.textContent)")
    assert options == ["Equal count", "Equal width", "Log-spaced", "Manual thresholds"]
    page.select_option(f"{CTRL} .pbc-method", "equal_width")
    _wait_binning(page, {"method": "equal_width", "bins": 5})
    page.select_option(f"{CTRL} .pbc-method", "log")
    _wait_binning(page, {"method": "log", "bins": 5})
    zeros = int((DATA.obs["depth"] == 0).sum())
    until(page, "(s) => /have no bin/.test(document.querySelector(s + ' .pbc-notes').textContent)", CTRL)
    assert page.inner_text(f"{CTRL} .pbc-notes") == f"{zeros:,} cells at or below 0 have no bin. Turn on Zero as its own bin to keep them."
    page.check(f"{CTRL} .pbc-zero")
    _wait_binning(page, {"method": "log", "bins": 5, "zero_bin": True})
    until(page, "(s) => !/have no bin/.test(document.querySelector(s + ' .pbc-notes').textContent)", CTRL)


def test_a_range_on_equal_width_bins_clamps_and_says_how_many(page, served):
    _open_binned(page, served, [{"source": {"type": "obs", "key": "score"}, "binning": {"method": "equal_width"}}])
    _ready(page)
    _ctrl_ready(page)
    assert page.inner_text(f"{CTRL} .pbc-range-help") == "Values outside go into the first or last bin, labelled ≤ and ≥."
    page.fill(f"{CTRL} .pbc-range-lo", "3")
    page.press(f"{CTRL} .pbc-range-lo", "Enter")
    _wait_binning(page, {"method": "equal_width", "range": [3, None]})
    page.fill(f"{CTRL} .pbc-range-hi", "7")
    page.press(f"{CTRL} .pbc-range-hi", "Enter")
    _wait_binning(page, {"method": "equal_width", "range": [3, 7]})
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
    page.locator(f"{CTRL} .pbc-line").first.focus()
    page.keyboard.press("ArrowRight")
    until(page, "([id, v]) => Math.abs(window.PanelManager.getPanel(id).getRecipe().partitionings[0].binning.thresholds[0] - v) < 1e-9", [GA, 3 + step])
    # the focus survives the repaint, so the key can be pressed again
    until(page, "() => document.activeElement.getAttribute('aria-label') === 'Threshold 1 of 2'")
    until(page, "() => document.activeElement.getAttribute('aria-label') === 'Threshold 1 of 2'")
    page.keyboard.press("Shift+ArrowLeft")
    until(page, "([id, v]) => Math.abs(window.PanelManager.getPanel(id).getRecipe().partitionings[0].binning.thresholds[0] - v) < 1e-9", [GA, 3 + step - 10 * step])
    until(page, "() => document.activeElement.getAttribute('aria-label') === 'Threshold 1 of 2'")
    page.keyboard.press("End")
    until(page, "(id) => window.PanelManager.getPanel(id).getRecipe().partitionings[0].binning.thresholds[0] > 5.5", GA)
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
    shown = page.evaluate("async () => (await import('/static/js/data-manager.js')).DataManager.getCells().length")
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
    labels = page.evaluate("(s) => [...document.querySelectorAll(s + ' .cgrp-level__label')].map(e => e.textContent)", BIN)
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
    _open_binned(page, served, [])
    _add(page, "column", type_="obs", key="depth")
    _ready(page)
    _ctrl_ready(page)
    until(page, "(s) => !!document.querySelector(s + ' .pbc-zero:checked')", CTRL)
    _ready(page)
    page.locator(BIN).screenshot(path=str(out / f"binned-card-equal-count-{theme}.png"))
    page.select_option(f"{CTRL} .pbc-method", "manual")
    until(page, "(s) => document.querySelectorAll(s + ' .pbc-line').length > 0", CTRL)
    page.locator(BIN).screenshot(path=str(out / f"binned-card-manual-{theme}.png"))


def test_a_grouping_card_holds_the_preview_space_until_the_histogram_arrives(page, served):
    """The empty preview is the placeholder of a grouping's card: dropping it would make the card jump when the reply lands."""
    held = []
    page.route("**/data/cell_groups*", lambda route: held.append(route))
    _open_binned(page, served, [_binned("depth")], expand=False)
    _expand(page, 0)
    until(page, "(s) => !!document.querySelector(s + ' .pbc-hist.is-empty')", BIN)
    box = page.locator(f"{CTRL} .pbc-hist").bounding_box()
    assert box and box["height"] > 20, box
    assert held, "the reply was held back, so the card was drawn without it"
    page.unroute("**/data/cell_groups*")  # releases the held requests
