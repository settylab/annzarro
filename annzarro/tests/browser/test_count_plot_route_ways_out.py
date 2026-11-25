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
