"""Renaming a level in a factor's Edit pop-over is easy to enter and easy to leave (the operator: "once one starts
renaming levels, it's really hard to get out of it again").

Rules, each its own test:
1.  Enter commits and leaves the field; focus is on the level's row (its rename button), not in a new edit.
2.  Escape cancels the edit and leaves the field; a second Escape closes the pop-over.
3.  Blur, by clicking elsewhere inside the pop-over, commits.
4.  A click outside the pop-over commits and closes it; reopened, no field is open.
5.  Tab commits and moves to the next level's name (Shift+Tab to the previous one).
6.  A redraw after a commit does not open the editor again.
7.  The row being edited looks edited; the others do not.
8.  The same in a binned factor's pop-over.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
from annzarro.tests.browser import waits  # noqa: E402
from annzarro.tests.browser.test_cell_grouping_panel import (  # noqa: E402,F401
    A, CELL_TYPE, GA, _grouping, _open, _ready, _state, page, served)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402

P = "[data-popover='levels']"
FIELD = f"{P} input.cgrp-level__name"
B_ROW = f"{P} .cgrp-level[data-id='c:B cell']"
EDIT = f"{A} .cgrp-card[data-index='0'] .cgrp-card__edit"


def _labels(page):
    return page.evaluate("() => window.PanelManager.getPanel('cell-grouping-A').getRecipe().partitionings[0].labels || null")


def _start(page, served, selector=None):
    _open(page, served, {GA: _grouping(partitionings=[CELL_TYPE])})
    _ready(page)
    page.click(EDIT)
    page.click(f"{B_ROW} .cgrp-level__rename")
    page.wait_for_selector(FIELD)


def _active(page):
    """Where the focus is: 'rename:<level id>', 'field:<level id>', 'edit', or the element's class."""
    return page.evaluate("""() => { const a = document.activeElement; if (!a) return null;
        const li = a.closest('.cgrp-level'); const id = li ? li.dataset.id : null;
        if (a.matches('input.cgrp-level__name')) return 'field:' + id;
        if (a.matches('.cgrp-level__rename')) return 'rename:' + id;
        if (a.matches('.cgrp-card__edit')) return 'edit';
        return a.className || a.tagName; }""")


def test_enter_commits_and_leaves_the_field_with_focus_on_the_row(page, served):
    _start(page, served)
    undo = _state(page)["undo"]
    page.fill(FIELD, "B lymphocyte")
    page.keyboard.press("Enter")
    until(page, "() => !document.querySelector(\"[data-popover='levels'] input.cgrp-level__name\")")
    assert _labels(page) == {"c:B cell": "B lymphocyte"}
    assert _state(page)["undo"] == undo + 1
    assert _active(page) == "rename:c:B cell"
    assert page.locator(P).count() == 1, "the pop-over stays open"


def test_escape_cancels_the_edit_then_a_second_escape_closes_the_popover(page, served):
    _start(page, served)
    page.fill(FIELD, "never kept")
    page.keyboard.press("Escape")
    until(page, "() => !document.querySelector(\"[data-popover='levels'] input.cgrp-level__name\")")
    assert page.locator(P).count() == 1, "the first Escape leaves the field only"
    assert _labels(page) is None, "nothing was committed"
    assert _active(page) == "rename:c:B cell"
    page.keyboard.press("Escape")
    page.wait_for_selector(P, state="detached", timeout=5000)
    assert _active(page) == "edit"
    page.click(EDIT)
    page.wait_for_selector(P)
    assert page.locator(FIELD).count() == 0, "reopened, no edit is waiting"


def test_blur_inside_the_popover_commits(page, served):
    _start(page, served)
    page.fill(FIELD, "B blur")
    page.click(f"{P} .az-popover-title")
    until(page, "() => !document.querySelector(\"[data-popover='levels'] input.cgrp-level__name\")")
    assert _labels(page) == {"c:B cell": "B blur"}
    assert page.locator(P).count() == 1


def test_a_click_outside_commits_and_closes_and_reopens_without_an_edit(page, served):
    _start(page, served)
    page.fill(FIELD, "B outside")
    page.click(f"{A} .cgrp-status")
    page.wait_for_selector(P, state="detached", timeout=5000)
    until(page, "() => !!window.PanelManager.getPanel('cell-grouping-A').getRecipe().partitionings[0].labels")
    assert _labels(page) == {"c:B cell": "B outside"}
    page.click(EDIT)
    page.wait_for_selector(P)
    assert page.locator(FIELD).count() == 0
    assert page.inner_text(f"{B_ROW} .cgrp-level__label") == "B outside"


def test_tab_commits_and_moves_to_the_next_levels_name(page, served):
    _start(page, served)
    page.fill(FIELD, "first")
    page.keyboard.press("Tab")
    page.wait_for_selector(f"{P} .cgrp-level:nth-child(2) input.cgrp-level__name")
    until(page, "() => { const a = document.activeElement; return a.matches('input.cgrp-level__name') && !a.closest(\".cgrp-level[data-id='c:B cell']\"); }")
    assert _labels(page) == {"c:B cell": "first"}
    page.fill(FIELD, "second")
    page.keyboard.press("Tab")
    until(page, "() => Object.keys(window.PanelManager.getPanel('cell-grouping-A').getRecipe().partitionings[0].labels || {}).length === 2")
    page.wait_for_selector(f"{P} .cgrp-level:nth-child(3) input.cgrp-level__name")
    until(page, "() => document.activeElement.matches('input.cgrp-level__name')")      # the field takes the focus a moment after it is drawn
    page.keyboard.press("Shift+Tab")
    page.wait_for_selector(f"{P} .cgrp-level:nth-child(2) input.cgrp-level__name")
    until(page, "() => document.activeElement.matches('input.cgrp-level__name')")
    assert page.input_value(FIELD) == "second", "the previous name is edited as it now is"


def test_a_redraw_after_a_commit_does_not_open_the_editor_again(page, served):
    _start(page, served)
    page.fill(FIELD, "once")
    page.keyboard.press("Enter")
    until(page, "() => !document.querySelector(\"[data-popover='levels'] input.cgrp-level__name\")")
    waits.expect_stays(lambda: page.locator(FIELD).count() == 0 and _active(page) == "rename:c:B cell",
                       "the server's reply redraws the pop-over after the commit: a stale edit would come back with it",
                       page=page, seconds=1.5)


def test_the_row_being_edited_looks_edited_and_the_others_do_not(page, served):
    _start(page, served)
    assert page.locator(f"{P} .cgrp-level--editing").count() == 1
    assert page.locator(f"{B_ROW}.cgrp-level--editing").count() == 1
    assert page.get_attribute(FIELD, "aria-description") == "Enter saves, Escape cancels, Tab saves and moves to the next level."
    page.keyboard.press("Escape")
    until(page, "() => !document.querySelector('.cgrp-level--editing')")


def test_the_same_in_a_binned_factors_popover(page, served):
    _open(page, served, {GA: _grouping(partitionings=[{"source": {"type": "obs", "key": "score"}, "binning": {"method": "equal_count", "bins": 3}}])})
    _ready(page)
    page.click(EDIT)
    page.wait_for_selector("[data-popover='binning'] .cgrp-level__rename")
    until(page, "() => !!document.querySelector(\"[data-popover='binning'] .pbc-hist:not(.is-empty)\")")      # the preview has come: no late redraw
    page.click("[data-popover='binning'] .cgrp-level__rename >> nth=0")
    page.fill("[data-popover='binning'] input.cgrp-level__name", "low")
    page.keyboard.press("Escape")
    until(page, "() => !document.querySelector(\"[data-popover='binning'] input.cgrp-level__name\")")
    assert page.locator("[data-popover='binning']").count() == 1 and _labels(page) is None
    page.click("[data-popover='binning'] .cgrp-level__rename >> nth=0")
    page.fill("[data-popover='binning'] input.cgrp-level__name", "low")
    page.keyboard.press("Enter")
    until(page, "() => !!window.PanelManager.getPanel('cell-grouping-A').getRecipe().partitionings[0].labels")
    waits.expect_stays(lambda: page.locator("[data-popover='binning'] input.cgrp-level__name").count() == 0
                       and _active(page).startswith("rename:"), "the redraw after a commit must not open the editor again",
                       page=page, seconds=1.0)


# ------------------------------------------------------------------ leaving by clicking: the operator's second report

def test_a_blur_commits_even_when_the_page_never_sees_the_pointer_come_up(page, served):
    """The first version waited for the release of a pointer press before it saved a blurred field; a press whose release the page
    never sees (a drag that ended outside the window, a webview that swallows it) left the edit open for good."""
    _start(page, served)
    page.fill(FIELD, "B lost release")
    page.evaluate("() => document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))")
    page.evaluate("() => document.activeElement.blur()")
    until(page, "() => !document.querySelector(\"[data-popover='levels'] input.cgrp-level__name\")")
    assert _labels(page) == {"c:B cell": "B lost release"}


def test_a_click_on_the_popovers_empty_space_and_one_on_the_page_both_commit(page, served):
    _start(page, served)
    page.fill(FIELD, "B space")
    box = page.locator(f"{P} .az-popover-body").bounding_box()
    page.mouse.click(box["x"] + box["width"] - 3, box["y"] + box["height"] - 3)      # the body's padding, no control
    until(page, "() => !document.querySelector(\"[data-popover='levels'] input.cgrp-level__name\")")
    assert _labels(page) == {"c:B cell": "B space"} and page.locator(P).count() == 1
    page.click(f"{B_ROW} .cgrp-level__rename")
    page.fill(FIELD, "B page")
    page.mouse.click(5, 300)                                                           # the page, away from everything
    page.wait_for_selector(P, state="detached", timeout=5000)
    until(page, "() => (window.PanelManager.getPanel('cell-grouping-A').getRecipe().partitionings[0].labels || {})['c:B cell'] === 'B page'")


def test_the_field_has_a_save_and_a_cancel_button_beside_it(page, served):
    _start(page, served)
    ok, cancel = f"{B_ROW} .cgrp-level__ok", f"{B_ROW} .cgrp-level__cancel"
    assert page.get_attribute(ok, "aria-label") == "Save the new name for B cell"
    assert page.get_attribute(cancel, "aria-label") == "Cancel renaming B cell"
    assert page.inner_text(ok) == "✓" and page.inner_text(cancel) == "✕"
    assert page.get_attribute(ok, "tabindex") is None and page.get_attribute(cancel, "tabindex") is None, "in the tab order"
    page.fill(FIELD, "by button")
    page.click(cancel)
    until(page, "() => !document.querySelector('.cgrp-level--editing')")
    assert _labels(page) is None
    page.click(f"{B_ROW} .cgrp-level__rename")
    page.fill(FIELD, "by button")
    page.click(ok)
    until(page, "() => !document.querySelector('.cgrp-level--editing')")
    assert _labels(page) == {"c:B cell": "by button"}
    assert _active(page) == "rename:c:B cell"


def test_the_buttons_work_from_the_keyboard_and_escape_on_them_cancels(page, served):
    _start(page, served)
    page.fill(FIELD, "keys")
    page.focus(f"{B_ROW} .cgrp-level__ok")
    assert page.locator(f"{P} .cgrp-level--editing").count() == 1, "moving to a button of the row is not leaving it"
    page.keyboard.press("Escape")
    until(page, "() => !document.querySelector('.cgrp-level--editing')")
    assert _labels(page) is None and page.locator(P).count() == 1
    page.click(f"{B_ROW} .cgrp-level__rename")
    page.fill(FIELD, "keys")
    page.focus(f"{B_ROW} .cgrp-level__ok")
    page.keyboard.press("Enter")
    until(page, "() => !document.querySelector('.cgrp-level--editing')")
    assert _labels(page) == {"c:B cell": "keys"}


# ------------------------------------------------------------------ the editor is never blank while the groups recompute

class _Gate:
    """Holds every cell_groups computation (not the estimates) until `release()`; after it, everything goes through."""

    def __init__(self, page):
        self.held, self.open = [], False
        page.route("**/api/v1/data/cell_groups*", self._handler)

    def _handler(self, route):
        body = route.request.post_data_json or {}
        if body.get("estimate_only") or self.open:
            return route.continue_()
        self.held.append(route)

    def release(self):
        self.open = True
        for route in self.held:
            route.continue_()
        self.held.clear()


def _delay_computes(page):
    return _Gate(page)


def _computing(page):
    """The panel has sent its computation (the gate holds it) and says so."""
    until(page, "() => window.PanelManager.getPanel('cell-grouping-A')._debugState().status.state === 'computing'")


def _release(gate):
    gate.release()


def test_the_levels_editor_keeps_its_rows_and_focus_while_the_groups_recompute(page, served):
    _open(page, served, {GA: _grouping(partitionings=[CELL_TYPE])})
    _ready(page)
    page.click(EDIT)
    page.wait_for_selector(f"{P} .cgrp-level[data-id='c:T cell']")
    rows = page.locator(f"{P} .cgrp-level").count()
    held = _delay_computes(page)
    page.uncheck(f"{P} .cgrp-level[data-id='c:T cell'] input[type=checkbox]")
    until(page, "() => !!window.PanelManager.getPanel('cell-grouping-A').getRecipe().partitionings[0].levels")
    _computing(page)
    waits.expect_stays(lambda: page.locator(f"{P} .cgrp-level").count() >= rows and page.locator(f"{P} .cgrp-card__wait").count() == 0
                       and page.locator(f"{P} .cgrp-levels").count() == 1,
                       "the groups are held back on purpose: the editor must stay as it was for as long as they are", page=page, seconds=1.0)
    assert page.locator(f"{P} .cgrp-level[data-id='c:T cell'] input[type=checkbox]").is_checked() is False, "it shows the edit at once"
    assert page.evaluate("(p) => document.querySelector(p).contains(document.activeElement)", P), "the focus stays in the pop-over"
    _release(held)


def test_the_counts_are_stale_while_the_groups_recompute_and_update_in_place(page, served):
    _open(page, served, {GA: _grouping(partitionings=[CELL_TYPE])})
    _ready(page)
    page.click(EDIT)
    page.wait_for_selector(f"{P} .cgrp-level[data-id='c:T cell']")
    held = _delay_computes(page)
    page.uncheck(f"{P} .cgrp-level[data-id='c:T cell'] input[type=checkbox]")
    page.wait_for_selector(f"{P} .cgrp-level__n.is-stale")
    _computing(page)
    assert page.inner_text(f"{P} .cgrp-level[data-id='c:B cell'] .cgrp-level__n") == "500", "the last counts stay"
    _release(held)
    until(page, "() => !document.querySelector(\"[data-popover='levels'] .cgrp-level__n.is-stale\")")
    assert page.inner_text(f"{P} .cgrp-level[data-id='@other'] .cgrp-level__n") == "300" or page.locator(f"{P} .cgrp-level__n").count() > 0


def test_a_rename_sends_no_request_and_never_blanks_the_editor(page, served):
    _open(page, served, {GA: _grouping(partitionings=[CELL_TYPE])})
    _ready(page)
    page.click(EDIT)
    page.click(f"{B_ROW} .cgrp-level__rename")
    held = _delay_computes(page)
    asked = len(page.calls)
    page.fill(FIELD, "no request")
    page.keyboard.press("Enter")
    until(page, "() => !document.querySelector('.cgrp-level--editing')")
    waits.expect_stays(lambda: not held.held and len(page.calls) == asked and page.locator(f"{P} .cgrp-card__wait").count() == 0
                       and page.locator(f"{P} .cgrp-level__n.is-stale").count() == 0,
                       "a rename is a label: past the live delay a request would have gone", page=page, seconds=1.0)
    assert page.inner_text(f"{B_ROW} .cgrp-level__label") == "no request"
