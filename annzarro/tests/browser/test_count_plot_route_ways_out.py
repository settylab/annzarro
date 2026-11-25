"""T-CAP: a size cap the page could not know (the levels of the Color by were not counted before the request) comes back
from the route as a 422 with its count and limit. It is a refusal, not a failure with Retry, and its notice offers the
same ways out as a cap the page knew of (test_count_plot_ways_out.py): Split by another column and Switch to Bar, each
one undoable edit; no seconds, no Try anyway.

The route's answer is played (the fixture's columns all have levels the page knows).
"""
import json
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402,F401
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_cell_count_states import (  # noqa: E402,F401
    CC, S, _config, _count, _drawn, _open, _undo_label, obs, page, served)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

NOTICE = f"{S} .ccnt-plot > .score-notice"


def _refuse_grid(page, once=True):
    state = {"n": 0}

    def handle(route):
        body = json.loads(route.request.post_data or "{}") if route.request.method == "POST" else {}
        if route.request.method == "POST" and body.get("shape") == "grid" and not body.get("estimate_only") \
                and body.get("mode") == "2d" and (state["n"] == 0 or not once):
            state["n"] += 1
            route.fulfill(status=422, content_type="application/json", body=json.dumps(
                {"error": "Partitioning 3 has 46 levels; a 2d grid takes 8 there.", "reason": "too_many_levels",
                 "axis": 2, "count": 46, "limit": 8, "mode": "2d"}))
        else:
            route.continue_()
    page.route("**/data/cell_groups*", handle)


def _open_refused(page, served):
    _refuse_grid(page)
    _open(page, served, {CC: _count(mode="hist2d", x=obs("depth"), y=obs("score"), split=obs("cell_type"))})
    page.wait_for_selector(f"{NOTICE}[data-state='refused']", timeout=30000)


def test_the_routes_size_refusal_is_a_refusal_with_the_ways_out_and_no_retry_or_seconds(page, served):
    _open_refused(page, served)
    text = page.inner_text(NOTICE)
    assert "46" in text and "8" in text and "second" not in text and "minute" not in text
    assert "Color by cell_type has 46 levels; 2D histogram colors up to 8." in text, text      # the plan's own sentence
    labels = page.eval_on_selector_all(f"{NOTICE} button", "bs => bs.map(b => b.textContent)")
    assert labels[:2] == ["Split by another column ▾", "Switch to Bar"], labels
    assert "Retry" not in labels and "Try anyway" not in labels


def test_switch_to_bar_from_the_routes_refusal_draws_in_one_undoable_step(page, served):
    _open_refused(page, served)
    page.click(f"{NOTICE} button:has-text('Switch to Bar')")
    _drawn(page, "bar")
    assert _config(page)["mode"] == "bar"
    assert _undo_label(page) == "Undo: mode Bar"
    page.click(f"{S} .ccnt-undo")
    until(page, "(id) => window.PanelManager.getPanel(id).getConfig().mode === 'hist2d'", CC)


def test_split_by_another_column_from_the_routes_refusal_opens_the_picker(page, served):
    _open_refused(page, served)
    page.click(f"{NOTICE} button:has-text('Split by another column')")
    until(page, "(s) => [...document.querySelectorAll(s + ' [data-input=split] select option')].some(o => o.disabled)", S)
    options = page.evaluate("""(s) => Object.fromEntries([...document.querySelectorAll(s + ' [data-input=split] select option')]
        .map(o => [o.value, o.disabled]))""", S)
    assert options["many"] is True and options["sample"] is True and options["condition"] is False


# --- a grid over its cell cap: Fewer bins only when the bins can make it fit ---------------------------------------------

def _refuse_cap(page, body_mode, count=20000, limit=4000):
    state = {"n": 0}

    def handle(route):
        body = json.loads(route.request.post_data or "{}") if route.request.method == "POST" else {}
        if route.request.method == "POST" and body.get("shape") == "grid" and not body.get("estimate_only") \
                and body.get("mode") == body_mode and state["n"] == 0:
            state["n"] += 1
            route.fulfill(status=422, content_type="application/json", body=json.dumps(
                {"error": f"The grid would have {count:,} cells; the most is {limit:,}.", "reason": "grid_too_large",
                 "count": count, "limit": limit, "mode": body_mode}))
        else:
            route.continue_()
    page.route("**/data/cell_groups*", handle)


def test_a_grid_over_its_cell_cap_offers_fewer_bins_when_the_bins_make_it_fit(page, served):
    _refuse_cap(page, "2d")
    # 100 x 100 bins make 10,000 cells; the route counted 20,000, so the other input makes 2: 44 x 44 x 2 = 3,872 fit 4,000
    _open(page, served, {CC: _count(mode="hist2d", x=obs("depth"), y=obs("score"), split=obs("condition"))})
    page.wait_for_selector(f"{NOTICE}[data-state='refused']", timeout=30000)
    text = page.inner_text(NOTICE)
    assert "2D histogram would count 20,000 cells of a grid; it counts up to 4,000." in text, text
    assert "second" not in text and "Retry" not in text
    assert page.eval_on_selector_all(f"{NOTICE} button", "bs => bs.map(b => b.textContent)")[0] == "Fewer bins"
    page.click(f"{NOTICE} button:has-text('Fewer bins')")
    _drawn(page, "hist2d", "c.x.binning && c.x.binning.bins === 44 && c.y.binning.bins === 44")
    assert _undo_label(page) == "Undo: bins set to x 44, y 44"
    assert page.inner_text(f"{S} .ccnt-view-note") == "Bins set to X 44, Y 44."


def test_a_grid_over_its_cell_cap_that_no_bins_cause_says_so_with_no_way_out_buttons(page, served):
    _refuse_cap(page, "categorical", count=9000, limit=4000)
    _open(page, served, {CC: _count(mode="bar", x=obs("cell_type"), split=obs("condition"))})
    page.wait_for_selector(f"{NOTICE}[data-state='refused']", timeout=30000)
    assert "Bar would count 9,000 cells of a grid; it counts up to 4,000." in page.inner_text(NOTICE)
    labels = page.eval_on_selector_all(f"{NOTICE} button", "bs => bs.map(b => b.textContent)")
    assert "Fewer bins" not in labels and "Retry" not in labels, labels
