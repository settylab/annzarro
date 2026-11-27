"""T-CAP (aggregation-unify-080.md 14.8): a Cell Count Plot refused for a size cap offers ways out, each one an
ordinary undoable edit that draws; never an automatic change, never Try anyway, and no seconds in the sentence.

The store is the grouping fixture: cell_type (6 levels), sample (30), many (2,001), depth and score numeric. A 2D
histogram's Color by takes up to 8 levels, so `sample` is refused with its count and the limit.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_count_states import (  # noqa: E402,F401
    CC, S, _config, _count, _drawn, _open, _refused, _state, _undo_label, obs, page, served)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

SPLIT_TEXT = "Color by sample has 30 levels; 2D histogram colors up to 8."
WAYS = ["Split by another column ▾", "Switch to Bar", "Remove Color by"]


def _over_split(page, served):
    _open(page, served, {CC: _count(mode="hist2d", x=obs("depth"), y=obs("score"), split=obs("sample"))})
    _refused(page, SPLIT_TEXT, WAYS)


def test_the_notice_names_the_count_and_the_limit_and_offers_the_ways_that_draw(page, served):
    _over_split(page, served)
    text = _state(page)["text"]
    assert "30" in text and "8" in text and "second" not in text and "minute" not in text
    assert page.locator(f"{S} .ccnt-state-box button:has-text('Try anyway')").count() == 0
    assert len(_state(page)["actions"]) <= 3


def test_switch_to_bar_draws_is_one_undo_step_and_says_what_it_did(page, served):
    _over_split(page, served)
    page.click(f"{S} .ccnt-state-box button:has-text('Switch to Bar')")
    _drawn(page, "bar")
    assert _config(page)["mode"] == "bar" and _config(page)["split"] == obs("sample")
    assert _undo_label(page) == "Undo: mode Bar"
    assert page.inner_text(f"{S} .ccnt-view-note") == "Switched to Bar."
    page.click(f"{S} .ccnt-undo")
    until(page, "([s, t]) => { const b = document.querySelector(s + ' .ccnt-state');"
                " return b && !b.hidden && b.querySelector('.ccnt-state__text').textContent === t; }", [S, SPLIT_TEXT])
    assert _state(page)["actions"] == WAYS and _config(page)["mode"] == "hist2d"


def test_fewer_bins_sets_the_bins_to_the_cap_in_one_step(page, served):
    _open(page, served, {CC: _count(mode="hist2d", x=obs("depth", binning={"method": "equal_width", "bins": 600}), y=obs("score"))})
    until(page, "(s) => { const b = document.querySelector(s + ' .ccnt-state'); return b && !b.hidden; }", S)
    assert _state(page)["text"] == "depth × score is 600 × 100; 2D histogram shows up to 512 × 512."
    assert _state(page)["actions"][0] == "Fewer bins"
    page.click(f"{S} .ccnt-state-box button:has-text('Fewer bins')")
    _drawn(page, "hist2d", "c.x.binning && c.x.binning.bins === 512")
    assert _undo_label(page) == "Undo: bins set to x 512"
    assert page.inner_text(f"{S} .ccnt-view-note") == "Bins set to X 512."
    page.click(f"{S} .ccnt-undo")
    assert _config(page)["x"]["binning"]["bins"] == 600


def test_split_by_another_column_greys_the_columns_over_the_cap_with_their_counts(page, served):
    _over_split(page, served)
    page.click(f"{S} .ccnt-state-box button:has-text('Split by another column')")
    until(page, "(s) => [...document.querySelectorAll(s + ' [data-input=split] select option')].some(o => o.disabled)", S)
    options = page.evaluate("""(s) => Object.fromEntries([...document.querySelectorAll(s + ' [data-input=split] select option')]
        .map(o => [o.value, { disabled: o.disabled, text: o.textContent }]))""", S)
    assert options["many"] == {"disabled": True, "text": "many: 2,001 levels, at most 8"}
    assert options["sample"] == {"disabled": True, "text": "sample: 30 levels, at most 8"}
    assert options["cell_type"]["disabled"] is False and "at most" not in options["cell_type"]["text"]
    # choosing a column that fits is the input's ordinary change: one step, and the plot draws
    page.select_option(f"{S} [data-input=split] select >> nth=1", "cell_type")
    _drawn(page, "hist2d", "c.split && c.split.source.key === 'cell_type'")
    assert _undo_label(page).startswith("Undo:")
