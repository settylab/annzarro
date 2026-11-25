"""
"Try anyway" for time refusals in the browser (aggregation-unify-080.md 14.3 to 14.5), over the fake score route of
test_gene_score_plots.py: the notice with its button and tick, the request that goes out with `force`, the run that
says it stops by itself, the stopped state, the panel's tick and the strip's tag "Runs without asking" with its
"Ask again".

Run:  python -m pytest annzarro/tests/browser/test_try_anyway.py -n 2
"""
import json

import pytest

try:
    import playwright.sync_api as playwright  # noqa: E402,F401
except ImportError:  # pragma: no cover
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_gene_score_plots import (  # noqa: E402,F401
    C, _action, _calls, _drawn, _frame, _notice, _open, _slow, _tag, page, served,
)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

TRIED = {"allowed": True, "max_s": 1800, "why": None}
NOT_TRIED = {"allowed": False, "max_s": 1800, "why": "too_long"}
STRIP = f"{C} .plot-status"


def _wait_state(page, state):
    page.wait_for_selector(f"{C} .score-notice[data-state='{state}']", timeout=30000)
    return _notice(page)


def _tags(page):
    """The strip's tags in order: [data-tag, text]."""
    return page.evaluate("""(strip) => [...document.querySelectorAll(strip + ' .ps-tags .ps-tag')].map(b => [b.dataset.tag, b.textContent.trim()])""", STRIP)


def _tick(page, where):
    return page.locator(f"{where} input[data-ps-tick]")


def _stop_at_deadline(page, i=0):
    page.evaluate("""(i) => { window.__frame(i, { type: 'error', reason: 'try_time_exceeded', limit_s: 1800,
        message: 'The run reached its limit.' }); window.__ctls[i].close(); }""", i)


def test_a_time_refusal_that_may_be_tried_offers_try_anyway_and_sends_force(page, served):
    _slow(page, "refused", 840, tried=TRIED)
    _open(page, served, wait=False)
    note = _wait_state(page, "refused")
    assert "was not run: it is estimated at about 14 minutes (runs over 10 minutes are not started by themselves)." in note["text"]
    assert note["actions"][0] == "score-compute|Try anyway"
    assert _tick(page, f"{C} .score-notice").count() == 1
    assert [c["kind"] for c in _calls(page)] == ["estimate"], "nothing is sent before the click"
    _action(page, "score-compute")
    until(page, "() => window.__ctls.length === 1")
    sent = _calls(page, "compute")[0]
    assert sent["force"] is True and sent["confirm"] is True
    _frame(page, 0, type="progress", done=0, total=2, forced=True, deadline_s=1800, queue={"ahead": 0, "sharing": 0})
    until(page, "(t) => (document.querySelector(t + ' .score-notice') || {textContent: ''}).textContent.includes('Stops by itself after 30 minutes')", C)
    note = _notice(page)
    assert note["state"] == "computing"
    assert any(a.startswith("score-cancel") for a in note["actions"])


def test_a_tried_run_the_server_stops_is_stopped_with_try_again(page, served):
    _slow(page, "refused", 840, tried=TRIED)
    _open(page, served, wait=False)
    _wait_state(page, "refused")
    _action(page, "score-compute")
    until(page, "() => window.__ctls.length === 1")
    _frame(page, 0, type="progress", done=0, total=2, forced=True, deadline_s=1800, queue={"ahead": 0, "sharing": 0})
    _stop_at_deadline(page)
    note = _wait_state(page, "stopped")
    assert "was stopped after 30 minutes, the server's limit for a tried run." in note["text"]
    assert "Use fewer genes or groups, or a subset." in note["text"]
    assert note["actions"][0] == "score-compute|Try again"
    assert _tag(page) == "Score stopped"
    assert _drawn(page), "the plot keeps its neutral points: nothing partial is drawn"


def test_a_time_refusal_that_may_not_be_tried_says_why_and_has_no_button(page, served):
    _slow(page, "refused", 840, tried=NOT_TRIED)
    _open(page, served, wait=False)
    note = _wait_state(page, "refused")
    assert "more than ten times the 30 minutes" in note["text"]
    assert not [a for a in note["actions"] if a.startswith("score-compute")]
    assert _tick(page, f"{C} .score-notice").count() == 0


def test_cancelling_a_tried_run_offers_try_anyway_again(page, served):
    _slow(page, "refused", 840, tried=TRIED)
    _open(page, served, wait=False)
    _wait_state(page, "refused")
    _action(page, "score-compute")
    until(page, "() => window.__ctls.length === 1")
    _frame(page, 0, type="progress", done=0, total=2, forced=True, deadline_s=1800, queue={"ahead": 0, "sharing": 0})
    until(page, "(t) => !!document.querySelector(t + ' .score-notice[data-state=computing] [data-ps-action=score-cancel]')", C)
    _action(page, "score-cancel")
    note = _wait_state(page, "cancelled")
    assert note["actions"][0] == "score-compute|Try anyway"


def test_the_tick_on_a_try_anyway_notice_runs_it_and_shows_the_tag_first_in_the_strip(page, served):
    _slow(page, "refused", 840, tried=TRIED)
    _open(page, served, wait=False)
    _wait_state(page, "refused")
    assert [t[0] for t in _tags(page)] == ["score"]
    _tick(page, f"{C} .score-notice").click()
    until(page, "() => window.__ctls.length === 1")
    sent = _calls(page, "compute")[0]
    assert sent["force"] is True, "the tick at the refused level runs a tried run"
    page.wait_for_selector(f"{STRIP} .ps-tag[data-tag='unasked']", timeout=30000)
    tags = _tags(page)
    assert tags[0] == ["unasked", "Runs without asking"], tags
    # its pop-over: the words and one action, which takes the tick and the tag away
    page.click(f"{STRIP} .ps-tag[data-tag='unasked']")
    pop = page.locator(f"{STRIP} .ps-pop[data-pop='unasked']")
    assert "Long computations in this panel start without asking" in pop.inner_text()
    assert pop.locator("[data-ps-action]").all_inner_texts() == ["Ask again"]
    pop.locator("[data-ps-action='ask-again']").click()
    page.wait_for_selector(f"{STRIP} .ps-tag[data-tag='unasked']", state="detached", timeout=30000)


def test_the_tick_on_the_question_skips_it_for_the_next_slow_score_in_that_panel(page, served):
    _slow(page, "confirm", 130)
    _open(page, served, wait=False)
    _wait_state(page, "awaiting")
    assert _tick(page, f"{C} .score-notice").count() == 1
    # the same box in the strip's pop-over of the tag
    page.click(f"{STRIP} .ps-tag[data-tag='score']")
    assert page.locator(f"{STRIP} .ps-pop[data-pop='score'] input[data-ps-tick='confirm']").count() == 1
    _tick(page, f"{C} .score-notice").click()
    until(page, "() => window.__ctls.length === 1")
    sent = _calls(page, "compute")[0]
    assert sent["confirm"] is True and sent["force"] is False, "the question is skipped; a confirm-tier run is no tried run"
    page.wait_for_selector(f"{STRIP} .ps-tag[data-tag='unasked']", timeout=30000)


def test_the_tick_is_not_in_the_link(page, served):
    _slow(page, "confirm", 130)
    _open(page, served, wait=False)
    _wait_state(page, "awaiting")
    _tick(page, f"{C} .score-notice").click()
    until(page, "() => window.__ctls.length === 1")
    assert "ask" not in page.url.lower().replace("task", "")
    assert "unasked" not in json.dumps(page.evaluate("() => location.href + document.cookie + JSON.stringify(Object.assign({}, localStorage))"))
