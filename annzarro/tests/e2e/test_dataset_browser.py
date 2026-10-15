"""The dataset browser (#dataset-browser), opened from the dataset button, in a real (headless) browser.

One dialog for every way of choosing a dataset: places (Recent, Pinned, the data directory, Remote), a
breadcrumb that turns into a path/URL field, a native sortable table, filters, search (substring or
regex, scoped to the folder shown), a details pane with the store check, pins, and the first-load rule
and shortcuts that lead to it.

Needs Playwright with Chromium; skipped without it, or failed when ANNZARRO_REQUIRE_BROWSER=1.
Starts the servers on free 127.0.0.1 ports (e2e/dsb_servers.py).
"""
import json
import os
import re
import time

import pytest

from annzarro.tests.ui_helpers import (
    BROWSER, ROW, browser_row, browser_rows, button_state, button_text, close_browser, dataset_path, open_browser,
    open_dataset, wait_for_open)

from .dsb_servers import (  # noqa: F401  (fixtures)
    LONG, SHOTS, Session, big_server, empty_server, hosted_server, server, session, single_server)

# kept per origin and user: `local` when login is off
RECENTS_KEY = "'annzarro.recents:' + location.origin + '|local'"
PINS_KEY = "'annzarro.pins:' + location.origin + '|local'"
RECENT_KEYS = "() => Object.keys(localStorage).filter(k => k.startsWith('annzarro.recents:'))"


def _names(page):
    return page.eval_on_selector_all(f"{ROW}[data-kind='store'] .dsb-name-text", "els => els.map(e => e.textContent.trim())")


def _shot(page, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True)
        page.screenshot(path=os.path.join(SHOTS, name))


# ---- opening it ---------------------------------------------------------------------------

def test_the_button_ctrl_o_and_the_welcome_screen_open_it_and_focus_lands_in_search(session):
    page = session.page
    open_browser(page)
    assert page.inner_text("#dataset-browser-title") == "Open a dataset"
    assert page.get_attribute(BROWSER, "role") == "dialog" and page.get_attribute(BROWSER, "aria-modal") == "true"
    close_browser(page)
    page.wait_for_function("document.activeElement && document.activeElement.id === 'dataset-button'", timeout=5_000)   # Escape returns focus to the button
    open_browser(page, shortcut=True)                       # Cmd/Ctrl+O from anywhere
    close_browser(page)
    page.focus("#focused-gene")
    assert page.is_disabled("#focused-gene") is True        # no dataset: the inputs are off
    page.locator("body").click(position={"x": 5, "y": 600})
    open_browser(page, shortcut=True)
    close_browser(page)
    # the welcome screen offers the same, and (here) says there is no dataset to open yet
    page.click(".welcome-open-dataset .welcome-browse")
    page.locator(BROWSER).wait_for(state="visible")
    page.wait_for_function("document.activeElement && document.activeElement.id === 'dsb-search'")
    close_browser(page)
    assert not session.errors, session.errors


def test_ctrl_o_works_from_a_text_field_and_ctrl_shift_l_loads_a_panel_set_instead(server):
    base, data = server
    s = Session(base)
    page = s.page
    try:
        open_dataset(page, os.path.join(data, "short.zarr"))
        page.wait_for_function("!document.getElementById('focused-gene').disabled", timeout=30_000)
        page.focus("#focused-gene")
        open_browser(page, shortcut=True)
        close_browser(page)
        # the old Load Panel Set chord is the browser's now: Cmd/Ctrl+Shift+L
        page.locator("body").click(position={"x": 5, "y": 600})
        page.keyboard.press("Control+Shift+L")
        page.locator("#session-modal").wait_for(state="visible", timeout=10_000)
        page.wait_for_function("document.querySelector('#session-modal').contains(document.activeElement)", timeout=10_000)
        assert page.inner_text("#session-modal-title") == "Load Panel Set"
        page.keyboard.press("Escape")
        page.locator("#session-modal").wait_for(state="hidden")
        assert not page.locator(BROWSER).is_visible()
        assert not s.errors, s.errors
    finally:
        s.close()


def test_the_browser_lands_on_the_data_directory_and_on_recent_once_something_was_opened(server):
    base, data = server
    s = Session(base)
    page = s.page
    try:
        open_browser(page)
        assert page.get_attribute("#dsb-places [data-place='root']", "aria-current") == "true"
        assert "Data directory" in page.inner_text("#dsb-crumbs")
        rows = browser_rows(page)
        assert any(r.endswith("/projects") for r in rows) and any(r.endswith("/short.zarr") for r in rows)
        places = page.eval_on_selector_all("#dsb-places .dsb-place", "els => els.map(e => e.dataset.place)")
        assert places[:3] == ["recent", "pinned", "root"] and "remote" in places
        close_browser(page)
        # a dataset the user chose: next time the browser opens on Recent, the open one listed once and marked open
        page.click(BUTTON_SEL)
        page.locator(BROWSER).wait_for(state="visible")
        browser_row(page, "short.zarr").first.locator(".dsb-name").click()
        wait_for_open(page, "short.zarr")
        open_browser(page)
        assert page.get_attribute("#dsb-places [data-place='recent']", "aria-current") == "true"
        assert [r for r in browser_rows(page)] == [os.path.join(data, "short.zarr")]
        assert page.locator(f"{ROW} .dsb-badge-open").count() == 1
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", page.inner_text(f"{ROW} td:nth-child(6)").strip())
        assert not s.errors, s.errors
    finally:
        s.close()


BUTTON_SEL = "#dataset-button"


# ---- search ---------------------------------------------------------------------------------

def test_search_highlights_and_carries_a_pasted_path_as_the_first_row(session):
    page = session.page
    open_browser(page, query="short")
    page.wait_for_selector(f"{ROW}[data-kind='store']")
    assert all("short" in n.lower() for n in _names(page))
    assert page.locator(f"{BROWSER} mark").count() >= 1, "matches are highlighted"
    page.fill("#dsb-search", "/definitely/not/here.zarr")
    assert page.locator(f"{ROW}.dsb-row-path").count() == 1, "a typed path is offered as the first row"
    assert "Open /definitely/not/here.zarr" in page.inner_text(f"{ROW}.dsb-row-path")


def test_regex_toggle_and_invalid_regex(session):
    page = session.page
    open_browser(page)
    page.fill("#dsb-search", "^short\\.zarr$")
    page.wait_for_timeout(500)
    assert _names(page) == [], "literal text: no match"
    page.click("#dsb-regex")
    assert page.get_attribute("#dsb-regex", "aria-pressed") == "true"
    page.wait_for_function("document.querySelectorAll('#dsb-table tbody tr[data-kind=store]').length === 1")
    assert _names(page) == ["short.zarr"]
    page.fill("#dsb-search", "(")
    assert "Invalid regular expression" in page.inner_text("#dsb-search-error")
    page.fill("#dsb-search", "")
    page.wait_for_selector(f"{ROW}[data-kind='store']")


def test_search_is_scoped_to_the_folder_shown_with_one_debounced_request(session):
    page = session.page
    open_browser(page)
    requests = []
    page.on("request", lambda r: requests.append(r.url) if "/datasets/search" in r.url else None)
    # from the data directory: stores in subfolders are found without entering them
    page.click("#dsb-search")
    page.keyboard.type("lung_v2", delay=40)
    browser_row(page, "lung_v2.zarr").wait_for()
    assert len(requests) == 1, f"typing sent {len(requests)} requests: {requests}"
    assert "folder=" not in requests[0], "the data directory searches everywhere"
    assert page.inner_text(f"{ROW}[data-path$='lung_v2.zarr'] .dsb-rel").strip() == "projects/lung/"
    # inside a folder: the search stays there (folder= is sent), and finds nothing of the other folder
    page.fill("#dsb-search", "")
    browser_row(page, "/projects").locator(".dsb-name").click()
    page.wait_for_selector(f"{ROW}[data-path$='/liver']")
    browser_row(page, "/liver").locator(".dsb-name").click()
    browser_row(page, "deep_store.zarr").wait_for()
    requests.clear()
    page.fill("#dsb-search", "deep_store")
    browser_row(page, "deep_store.zarr").wait_for()
    page.wait_for_timeout(700)
    assert len(requests) == 1 and "folder=" in requests[0] and "liver" in requests[0], requests
    page.fill("#dsb-search", "lung_v2")
    page.wait_for_timeout(900)
    assert browser_rows(page) == [], "lung_v2 is not below the folder shown"
    assert "No dataset matches" in page.inner_text("#dsb-table-wrap")


def test_regex_is_sent_to_the_server_which_guards_it_and_says_why(session):
    page = session.page
    open_browser(page)
    requests = []
    page.on("request", lambda r: requests.append(r.url) if "/datasets/search" in r.url else None)
    page.click("#dsb-regex")
    page.fill("#dsb-search", "lung_v\\d\\.zarr$")
    browser_row(page, "lung_v2.zarr").wait_for()
    assert requests and "mode=regex" in requests[-1]
    # a pattern that takes exponential time is refused by the server, and the browser says why
    page.fill("#dsb-search", "(a+)+$")
    page.wait_for_selector(f"{BROWSER} #dsb-table-wrap .text-danger")
    assert "repeat inside a repeat" in page.inner_text("#dsb-table-wrap")
    page.click("#dsb-regex")                    # plain text again
    page.fill("#dsb-search", "lung_v2")
    browser_row(page, "lung_v2.zarr").wait_for()
    assert "mode=substring" in requests[-1]
    page.fill("#dsb-search", "a" * 201)
    page.wait_for_selector(f"{BROWSER} #dsb-table-wrap .text-danger")
    assert "at most" in page.inner_text("#dsb-table-wrap")


def test_enter_in_search_opens_the_first_store_and_cmd_o_type_enter_is_the_old_click_type_enter(server):
    base, data = server
    s = Session(base)
    page = s.page
    try:
        page.keyboard.press("Control+o")
        page.locator(BROWSER).wait_for(state="visible")
        page.wait_for_function("document.activeElement && document.activeElement.id === 'dsb-search'")
        page.keyboard.type("other_small")
        page.keyboard.press("Enter")
        wait_for_open(page, "other_small.zarr")
        assert button_text(page) == "other_small.zarr"
        assert not s.errors, s.errors
    finally:
        s.close()


# ---- the table ------------------------------------------------------------------------------

def test_rows_are_a_native_table_with_counts_format_dates_and_unreadable_stores_with_their_reason(session):
    page = session.page
    open_browser(page)
    assert page.evaluate("document.querySelector('#dsb-table').tagName") == "TABLE"
    headers = page.eval_on_selector_all("#dsb-table thead th", "els => els.map(e => e.textContent.trim())")
    assert [h.rstrip("▲▼ ") for h in headers] == ["Name", "Cells", "Genes", "Format", "Modified", "Last opened"]
    short = page.locator(f"{ROW}[data-path$='/short.zarr']")
    cells = short.locator("td").all_inner_texts()
    assert cells[0] == "200" and cells[1] == "20" and re.fullmatch(r"zarr v[23]( sharded)?", cells[2]) \
        and re.fullmatch(r"\d{4}-\d{2}-\d{2}", cells[3]), cells
    # the unreadable one is last, says why, and is not openable
    last = page.locator(f"{ROW}[data-kind='store']").last
    assert last.get_attribute("data-path").endswith("broken.zarr")
    assert "Not readable" in last.inner_text()
    assert last.locator(".dsb-name").get_attribute("aria-disabled") == "true"
    # folders first
    assert page.locator(f"{ROW}").first.get_attribute("data-kind") == "folder"
    # long names wrap, never cut
    clipped = page.eval_on_selector_all(f"{ROW} .dataset-name", "els => els.filter(n => n.scrollWidth > n.clientWidth + 1).map(n => n.textContent)")
    assert not clipped, clipped
    assert any(LONG in r.replace("\n", "") for r in page.eval_on_selector_all(f"{ROW}", "els => els.map(e => e.innerText)"))


def test_a_click_on_the_name_opens_a_click_elsewhere_selects_enter_and_double_click_open(server):
    base, data = server
    ends = []
    for how in ("click-name", "dblclick-row", "enter"):
        s = Session(base)
        try:
            page = s.page
            open_browser(page, query="other_small")
            browser_row(page, "other_small.zarr").wait_for()
            row = browser_row(page, "other_small.zarr")
            if how == "enter":
                page.keyboard.press("ArrowDown")
                assert page.evaluate("document.activeElement.classList.contains('dsb-name')")
                page.keyboard.press("Enter")
            elif how == "dblclick-row":
                row.locator("td").first.click()               # one click elsewhere: selected, details shown, not open
                page.wait_for_selector("#dsb-details .dsb-details-name")
                assert page.locator(BROWSER).is_visible() and dataset_path(page) is None
                assert "selected" in row.get_attribute("class")
                row.locator("td").first.dblclick()
            else:
                row.locator(".dsb-name").click()
            page.locator(BROWSER).wait_for(state="hidden", timeout=10_000)
            wait_for_open(page, "other_small.zarr")
            page.wait_for_timeout(2000)
            ends.append(page.evaluate("""() => ({path: window.annzarro.getDataset().path, cells: document.getElementById('cell-count').textContent,
                tiles: [...document.querySelectorAll('.tile[data-tile-id]')].map(t => t.dataset.tileId)})"""))
        finally:
            s.close()
    assert ends[0] == ends[1] == ends[2], ends


def test_an_unreadable_store_is_focusable_shows_its_reason_and_never_opens(session):
    page = session.page
    open_browser(page)
    row = browser_row(page, "broken.zarr")
    row.locator(".dsb-name").click(force=True)      # aria-disabled: a click selects it, nothing more
    page.wait_for_selector("#dsb-details .dsb-reason")
    assert "Not readable" in page.inner_text("#dsb-details")
    assert page.locator("#dsb-details-open").count() == 0, "no Open button for a store that cannot be opened"
    row.locator(".dsb-name").dblclick(force=True)
    page.keyboard.press("Enter")
    page.wait_for_timeout(500)
    assert page.locator(BROWSER).is_visible() and dataset_path(page) is None


@pytest.mark.parametrize("width,limit", [(1024, (700, 1000)), (1920, (1180, 1300))])
def test_the_dialog_is_wider_on_a_wide_window(server, width, limit):
    s = Session(server[0], width=width)
    try:
        open_browser(s.page)
        w = s.page.locator(f"{BROWSER} .modal-content").bounding_box()["width"]
        assert limit[0] <= w <= limit[1], w
        _shot(s.page, f"browser-{width}.png")
    finally:
        s.close()


def test_sorting_by_a_header_button_sets_aria_sort_and_the_server_sorts_name_and_modified(session):
    page = session.page
    open_browser(page)
    sort = lambda key: page.get_attribute(f"#dsb-table th:has(.dsb-sort[data-sort='{key}'])", "aria-sort")
    assert sort("name") == "ascending" and sort("cells") == "none"
    requests = []
    page.on("request", lambda r: requests.append(r.url) if "/datasets/folder" in r.url else None)
    page.click(".dsb-sort[data-sort='name']")                  # a column the server sorts: sorted before paging
    page.wait_for_function("document.querySelector(\"#dsb-table th:has(.dsb-sort[data-sort='name'])\").getAttribute('aria-sort') === 'descending'")
    assert requests and "sort=name" in requests[-1] and "order=desc" in requests[-1], requests
    names = [n for n in _names(page) if not n.startswith("broken")]
    assert names == sorted(names, key=str.lower, reverse=True)
    page.click(".dsb-sort[data-sort='modified']")
    page.wait_for_function("document.querySelector(\"#dsb-table th:has(.dsb-sort[data-sort='modified'])\").getAttribute('aria-sort') === 'descending'")
    assert "sort=modified" in requests[-1] and "order=desc" in requests[-1], requests
    n = len(requests)
    page.click(".dsb-sort[data-sort='cells']")                  # a column only the rows loaded can sort: no new request
    page.wait_for_function("document.querySelector(\"#dsb-table th:has(.dsb-sort[data-sort='cells'])\").getAttribute('aria-sort') === 'descending'")
    page.wait_for_timeout(300)
    assert len(requests) == n
    assert sort("modified") == "none"
    # folders stay first and the unreadable store last, whatever the column
    kinds = page.eval_on_selector_all(f"{ROW}", "els => els.map(e => e.dataset.kind + (e.classList.contains('dsb-unreadable') ? '-bad' : ''))")
    assert kinds[0] == "folder" and kinds[-1] == "store-bad", kinds
    caption = page.inner_text("#dsb-table caption")
    assert "sorted by cells descending" in caption, caption


def test_filters_by_format_cells_modified_and_unreadable(server):
    base, data = server
    s = Session(base)
    page = s.page
    try:
        open_browser(page)
        everything = len(browser_rows(page))
        page.select_option("#dsb-filter-format", "h5ad")
        assert _names(page) == [], "no store is an .h5ad file here"
        assert any(r.endswith("/projects") for r in browser_rows(page)), "a folder has no format: it stays, to go into"
        page.fill("#dsb-search", "short")
        page.wait_for_function("/No dataset matches the search and filters\\./.test(document.querySelector('#dsb-table-wrap').innerText)", timeout=10_000)
        page.fill("#dsb-search", "")
        page.select_option("#dsb-filter-format", "")
        assert len(browser_rows(page)) == everything
        # every fixture has 200 cells
        page.select_option("#dsb-filter-cells", "lt100k")
        assert any(r.endswith("/short.zarr") for r in browser_rows(page))
        page.select_option("#dsb-filter-cells", "1m-10m")
        assert not any(r.endswith("/short.zarr") for r in browser_rows(page))
        page.select_option("#dsb-filter-cells", "")
        page.select_option("#dsb-filter-modified", "week")
        assert any(r.endswith("/short.zarr") for r in browser_rows(page)), "just written: modified in the past week"
        page.select_option("#dsb-filter-modified", "")
        # the unreadable store: a toggle with its count
        toggle = page.locator("#dsb-filter-unreadable")
        assert toggle.get_attribute("aria-pressed") == "true" and "(1)" in toggle.inner_text()
        toggle.click()
        assert toggle.get_attribute("aria-pressed") == "false"
        assert not any(r.endswith("broken.zarr") for r in browser_rows(page))
        toggle.click()
        assert any(r.endswith("broken.zarr") for r in browser_rows(page))
        # "Matches this view" is only offered when there is a view with a store to match
        assert page.locator("#dsb-filter-matches").count() == 0
        assert not s.errors, s.errors
    finally:
        s.close()


def test_a_folder_opens_with_its_breadcrumb_and_goes_back_with_the_keyboard_and_the_crumb(server):
    base, data = server
    s = Session(base)
    page = s.page
    try:
        open_browser(page)
        browser_row(page, "/projects").locator(".dsb-name").click()
        page.wait_for_selector(f"{ROW}[data-path$='/lung']")
        assert [c.strip() for c in page.eval_on_selector_all("#dsb-crumbs .dsb-crumb", "els => els.map(e => e.textContent)")] == ["Data directory", "projects"]
        assert page.get_attribute("#dsb-crumbs .dsb-crumb[aria-current='location']", "aria-current") == "location"
        # Right enters a folder, Left (or Backspace) goes to its parent, with the keyboard only
        page.focus(f"{ROW}[data-path$='/lung'] .dsb-name")
        page.keyboard.press("ArrowRight")
        browser_row(page, "lung_v2.zarr").wait_for()
        assert "lung" in page.inner_text("#dsb-crumbs")
        page.focus(f"{ROW}[data-path$='lung_v2.zarr'] .dsb-name")
        page.keyboard.press("ArrowLeft")
        page.wait_for_selector(f"{ROW}[data-path$='/lung']")
        page.focus(f"{ROW}[data-path$='/liver'] .dsb-name")
        page.keyboard.press("Backspace")
        page.wait_for_selector(f"{ROW}[data-path$='/short.zarr']")
        # the crumb goes back too, and a store of a folder opens from it
        browser_row(page, "/projects").locator(".dsb-name").click()
        browser_row(page, "/liver").locator(".dsb-name").click()
        browser_row(page, "deep_store.zarr").wait_for()
        page.click("#dsb-crumbs .dsb-crumb:has-text('projects')")
        page.wait_for_selector(f"{ROW}[data-path$='/lung']")
        page.click("#dsb-crumbs .dsb-crumb:has-text('Data directory')")
        page.wait_for_selector(f"{ROW}[data-path$='/short.zarr']")
        browser_row(page, "/projects").locator(".dsb-name").click()
        browser_row(page, "/liver").locator(".dsb-name").click()
        browser_row(page, "deep_store.zarr").locator(".dsb-name").click()
        wait_for_open(page, "deep_store.zarr")
        assert button_text(page) == "projects/liver/deep_store.zarr"
        assert not s.errors, s.errors
    finally:
        s.close()


def test_stores_of_one_name_are_told_apart_by_their_folder_in_search_and_recent(session):
    page = session.page
    open_browser(page, query="short.zarr")
    page.wait_for_selector(f"{ROW}[data-path$='liver/short.zarr']")
    page.wait_for_timeout(500)
    rows = {r.get_attribute("data-path").rsplit("/data/", 1)[1]: r for r in page.locator(f"{ROW}[data-kind='store']").all()}
    assert set(rows) >= {"short.zarr", "projects/liver/short.zarr"}, list(rows)
    assert rows["projects/liver/short.zarr"].locator(".dsb-rel").inner_text().strip() == "projects/liver/"
    assert rows["short.zarr"].locator(".dsb-rel").count() == 0, "no folder line for a store at the top"


# ---- many stores ----------------------------------------------------------------------------

@pytest.mark.parametrize("width", [1024, 1920])
def test_two_thousand_stores_page_in_sort_among_those_loaded_and_search_stays_quick(big_server, width):
    base, _ = big_server
    s = Session(base, width=width, height=900)
    page = s.page
    try:
        open_browser(page)
        assert page.locator(f"{ROW}").count() == 200, "rendered in pages of 200"
        assert "Show more" in page.inner_text("#dsb-table-wrap .dsb-more")
        # the server lists 500 a page: 'Show more' shows 200 more rows, and reads the next page once those are all shown
        page.click("#dsb-table-wrap .dsb-more")
        assert page.locator(f"{ROW}").count() == 400
        page.click("#dsb-table-wrap .dsb-more")
        assert page.locator(f"{ROW}").count() == 500, "the 500 of the first page are all shown"
        assert "1500 not shown" in page.inner_text("#dsb-table-wrap .dsb-more")
        page.click("#dsb-table-wrap .dsb-more")
        page.wait_for_function("document.querySelectorAll('#dsb-table tbody tr').length === 600", timeout=20_000)
        # a column only the rows loaded can sort says so
        page.click(".dsb-sort[data-sort='cells']")
        page.wait_for_function("/Sorted among \\d+ loaded/.test(document.querySelector('#dsb-table-wrap').innerText)")
        page.wait_for_function("/sorted among 1000 loaded/.test(document.querySelector('#dsb-status').innerText)", timeout=10_000)
        t0 = time.time()
        page.fill("#dsb-search", "store_1999")
        browser_row(page, "store_1999.zarr").wait_for(timeout=10_000)
        assert time.time() - t0 < 4
        assert page.locator(f"{ROW}[data-kind='store']").count() == 1
        _shot(page, f"browser-2000-{width}.png")
        assert not s.errors, s.errors
    finally:
        s.close()


# ---- the path field -------------------------------------------------------------------------

def test_ctrl_l_edits_the_path_a_store_opens_a_folder_is_entered_and_a_bad_path_shows_the_servers_reason(server):
    base, data = server
    s = Session(base)
    page = s.page
    try:
        open_browser(page)
        page.keyboard.press("Control+l")
        assert page.is_visible("#dsb-path") and page.evaluate("document.activeElement.id") == "dsb-path"
        assert page.is_hidden("#dsb-crumbs")
        page.fill("#dsb-path", "/definitely/not/here.zarr")
        page.press("#dsb-path", "Enter")
        page.wait_for_selector("#dsb-path-error:not([hidden])", timeout=20_000)
        assert page.inner_text("#dsb-path-error").strip()
        assert page.get_attribute("#dsb-path", "aria-label") and page.input_value("#dsb-path") == "/definitely/not/here.zarr", "the field keeps the text"
        # a folder path navigates
        page.fill("#dsb-path", os.path.join(data, "projects", "lung"))
        page.press("#dsb-path", "Enter")
        browser_row(page, "lung_v2.zarr").wait_for()
        assert page.is_hidden("#dsb-path") and "lung" in page.inner_text("#dsb-crumbs")
        # Escape closes the field first, then the dialog
        page.keyboard.press("Control+l")
        page.keyboard.press("Escape")
        assert page.is_visible("#dsb-crumbs") and page.locator(BROWSER).is_visible()
        # a store path opens
        page.keyboard.press("Control+l")
        page.fill("#dsb-path", os.path.join(data, "projects", "liver", "deep_store.zarr"))
        page.press("#dsb-path", "Enter")
        wait_for_open(page, "deep_store.zarr")
        assert not s.errors, s.errors
    finally:
        s.close()


LABEL = "#dsb-path-label"


def _label(page):
    page.keyboard.press("Control+l")
    return page.inner_text(LABEL).strip(), page.get_attribute("#dsb-path", "placeholder")


def test_a_local_server_says_any_path(server):
    s = Session(server[0])
    try:
        open_browser(s.page)
        label, placeholder = _label(s.page)
        assert label == "Open any path, or a remote store URL" and "full path" in placeholder
    finally:
        s.close()


def test_a_confined_user_is_told_the_data_directory_and_may_use_a_relative_path(hosted_server):
    base, data, outside = hosted_server
    s = Session(base, login=("alice", "alice-pw"))
    page = s.page
    try:
        open_browser(page)
        label, placeholder = _label(page)
        assert label == "Open a path in the data directory, or a remote store URL"
        assert placeholder == "projects/liver/sample.zarr or https://…"
        # a path outside is refused with the server's own message
        page.fill("#dsb-path", outside)
        page.press("#dsb-path", "Enter")
        page.wait_for_selector("#dsb-path-error:not([hidden])", timeout=20_000)
        assert "outside the data directory" in page.inner_text("#dsb-path-error")
        # a relative path into a subfolder opens
        page.fill("#dsb-path", "projects/liver/deep_store.zarr")
        page.press("#dsb-path", "Enter")
        wait_for_open(page, "deep_store.zarr")
        assert button_text(page) == "projects/liver/deep_store.zarr"
        assert not s.errors, s.errors
    finally:
        s.close()


def test_an_admin_of_a_shared_server_is_told_any_path(hosted_server):
    s = Session(hosted_server[0], login=("root", "root-pw"))
    try:
        open_browser(s.page)
        label, _ = _label(s.page)
        assert label == "Open any path on this server, or a remote store URL (admin)"
    finally:
        s.close()


# ---- recents, pins, the first load ----------------------------------------------------------

def test_a_first_visit_and_a_link_record_no_recent_but_a_choice_does(server):
    base, data = server
    s = Session(base)
    try:
        s.page.wait_for_timeout(1000)
        assert s.page.evaluate(RECENT_KEYS) == [], "nothing was opened"
        s.page.goto(f"{base}/?dataset_path={os.path.join(data, 'short.zarr')}")
        wait_for_open(s.page, "short.zarr")
        s.page.wait_for_timeout(1500)
        assert s.page.evaluate(RECENT_KEYS) == [], "a link's dataset is not a choice"
        # a choice made in the browser is
        choose = lambda suffix: (open_browser(s.page), browser_row(s.page, suffix).first.locator(".dsb-name").click())
        choose("other_small.zarr")
        wait_for_open(s.page, "other_small.zarr")
        s.page.wait_for_function(f"localStorage.getItem({RECENTS_KEY}) !== null", timeout=30_000)
        recent = s.page.evaluate(f"JSON.parse(localStorage.getItem({RECENTS_KEY}))")[0]
        assert recent["path"].endswith("other_small.zarr") and recent["label"] == "other_small.zarr" and recent["openedAt"] > 0
    finally:
        s.close()


def test_recents_show_a_store_in_a_subfolder_and_grey_one_that_is_gone(server):
    """The recents are answered by POST /datasets/lookup, so they are not limited to the top level."""
    base, data = server
    s = Session(base)
    page = s.page
    try:
        deep = os.path.join(data, "projects", "liver", "deep_store.zarr")
        open_dataset(page, deep)                                   # a user choice: recorded
        page.wait_for_function(f"localStorage.getItem({RECENTS_KEY}) !== null", timeout=30_000)
        assert page.evaluate(f"JSON.parse(localStorage.getItem({RECENTS_KEY}))")[0]["label"] == "projects/liver/deep_store.zarr"
        gone = os.path.join(data, "removed_since.zarr")
        page.evaluate(f"""() => {{
            const key = {RECENTS_KEY};
            const list = JSON.parse(localStorage.getItem(key));
            list.splice(1, 0, {{path: {gone!r}, label: 'removed_since.zarr', openedAt: 1}});
            localStorage.setItem(key, JSON.stringify(list));
        }}""")
        open_browser(page)
        assert page.get_attribute("#dsb-places [data-place='recent']", "aria-current") == "true"
        rows = page.eval_on_selector_all(f"{ROW}", "els => els.map(e => [e.dataset.path, e.classList.contains('dsb-unreadable'), e.innerText])")
        assert [r[0] for r in rows[:2]] == [deep, gone], rows
        assert not rows[0][1] and "deep_store.zarr" in rows[0][2] and "projects/liver/" in rows[0][2]
        assert rows[1][1] and "removed_since.zarr" in rows[1][2] and "Not available" in rows[1][2], "unavailable: greyed, not openable"
        assert page.locator(f"{ROW}[data-path='{deep}']").count() == 1, "listed once"
    finally:
        s.close()


def test_recents_are_kept_per_signed_in_user(hosted_server):
    base, data, _ = hosted_server
    keys = {}
    for user, password in (("alice", "alice-pw"), ("root", "root-pw")):
        s = Session(base, login=(user, password))
        try:
            open_dataset(s.page, os.path.join(data, "short.zarr"))
            s.page.wait_for_function("Object.keys(localStorage).some(k => k.startsWith('annzarro.recents:'))", timeout=30_000)
            keys[user] = s.page.evaluate(RECENT_KEYS)
        finally:
            s.close()
    assert [k.rsplit("|", 1)[1] for k in keys["alice"]] == ["user:alice"]
    assert [k.rsplit("|", 1)[1] for k in keys["root"]] == ["user:root"]


def test_pins_are_kept_per_user_listed_under_pinned_and_unpinned_again(server):
    base, data = server
    s = Session(base)
    page = s.page
    try:
        open_browser(page)
        browser_row(page, "other_small.zarr").locator("td").first.click()
        page.wait_for_selector("#dsb-details-pin")
        assert page.inner_text("#dsb-details-pin") == "Pin" and page.get_attribute("#dsb-details-pin", "aria-pressed") == "false"
        page.click("#dsb-details-pin")
        page.wait_for_function(f"localStorage.getItem({PINS_KEY}) !== null")
        pins = page.evaluate(f"JSON.parse(localStorage.getItem({PINS_KEY}))")
        assert [p["path"] for p in pins] == [os.path.join(data, "other_small.zarr")] and pins[0]["label"] == "other_small.zarr"
        page.wait_for_function("document.querySelector('#dsb-details-pin').textContent === 'Unpin'")
        assert page.locator(f"{ROW}[data-path$='other_small.zarr'] .dsb-pinned").count() == 1
        assert page.inner_text("#dsb-places [data-place='pinned'] .dsb-place-count") == "1"
        page.click("#dsb-places [data-place='pinned']")
        assert browser_rows(page) == [os.path.join(data, "other_small.zarr")]
        # it survives a reload (per origin and user), and unpinning removes it
        page.reload()
        page.evaluate("() => window.annzarro.ready")
        open_browser(page)
        page.click("#dsb-places [data-place='pinned']")
        assert browser_rows(page) == [os.path.join(data, "other_small.zarr")]
        browser_row(page, "other_small.zarr").locator("td").first.click()
        page.click("#dsb-details-pin")
        page.wait_for_function(f"JSON.parse(localStorage.getItem({PINS_KEY})).length === 0")
        assert "Nothing pinned" in page.inner_text("#dsb-table-wrap")
        assert not s.errors, s.errors
    finally:
        s.close()


def test_first_load_opens_the_only_dataset_none_of_several_and_the_last_one_opened(server, single_server):
    # exactly one store: opened
    s = Session(single_server[0])
    try:
        wait_for_open(s.page, "only_one.zarr")
    finally:
        s.close()
    # several stores and nothing opened before: none (never an arbitrary one), the welcome screen offers to open one
    base, data = server
    s = Session(base)
    try:
        s.page.wait_for_timeout(1500)
        assert dataset_path(s.page) is None and button_state(s.page) == "none"
        assert s.page.locator(".welcome-open-dataset h3").inner_text() == "Open a dataset"
        assert s.page.locator(".welcome-open-dataset .welcome-recent").count() == 0
    finally:
        s.close()
    # the most recent one this user opened, if the server says it may still be read; a gone one is skipped
    s = Session(base)
    try:
        page = s.page
        page.evaluate(f"""() => localStorage.setItem({RECENTS_KEY}, JSON.stringify([
            {{path: {os.path.join(data, 'gone.zarr')!r}, label: 'gone.zarr', openedAt: 3}},
            {{path: {os.path.join(data, 'other_small.zarr')!r}, label: 'other_small.zarr', openedAt: 2}},
            {{path: {os.path.join(data, 'short.zarr')!r}, label: 'short.zarr', openedAt: 1}}]))""")
        page.reload()
        wait_for_open(page, "other_small.zarr")
        assert page.evaluate("JSON.parse(localStorage.getItem(" + RECENTS_KEY + ")).length") == 3, "opening it at start records nothing"
    finally:
        s.close()


def test_the_welcome_screen_lists_recents_and_opens_one(server):
    base, data = server
    s = Session(base)
    try:
        page = s.page
        server_back = []

        def lookup(route):
            # at start the recent is said to be gone (so nothing opens); later the server answers as it is
            if not server_back:
                body = json.loads(route.request.post_data)["paths"]
                route.fulfill(status=200, content_type="application/json",
                              body=json.dumps({"results": [{"path": p, "status": "unavailable"} for p in body]}))
            else:
                route.continue_()
        page.route("**/api/v1/datasets/lookup", lookup)
        page.evaluate(f"""() => localStorage.setItem({RECENTS_KEY}, JSON.stringify([
            {{path: {os.path.join(data, 'short.zarr')!r}, label: 'short.zarr', openedAt: 3}}]))""")
        page.reload()
        page.wait_for_selector(".welcome-open-dataset .welcome-recent", timeout=30_000)
        assert page.locator(".welcome-open-dataset .welcome-recent").is_disabled(), "a store that is gone cannot be opened"
        assert dataset_path(page) is None
        # the section follows the state: once the server says it is there again (here: the state changes), it opens
        server_back.append(True)
        page.evaluate("""async () => { const m = await import('/static/js/utils/dataset-state.js');
            m.DatasetState.set({path: 'x', label: 'x', status: 'nodata'}); m.DatasetState.set({status: 'none'}); }""")
        page.wait_for_selector(".welcome-open-dataset .welcome-recent:not([disabled])", timeout=10_000)
        page.locator(".welcome-open-dataset .welcome-recent").first.click()
        wait_for_open(page, "short.zarr")
        page.wait_for_function("document.querySelectorAll('.welcome-open-dataset').length === 0", timeout=10_000)
        assert not s.errors, s.errors
    finally:
        s.close()


def test_the_tab_is_titled_with_the_open_dataset(server):
    base, data = server
    s = Session(base)
    try:
        open_dataset(s.page, os.path.join(data, "projects", "lung", "lung_v2.zarr"))
        s.page.wait_for_function("document.title === 'lung_v2.zarr \\u00b7 AnnZarro'", timeout=10_000)
    finally:
        s.close()


# ---- switching ------------------------------------------------------------------------------

def test_switching_keeps_the_open_panels_and_toasts_with_a_way_back(server):
    from annzarro.tests.browser.test_memory_guard import _link
    base, data = server
    s = Session(base)
    page = s.page
    try:
        page.goto(re.sub(r"dataset_path=[^#]*", "dataset_path=" + os.path.join(data, "short.zarr").replace("/", "%2F"), _link(base)))
        page.wait_for_selector('.tile[data-tile-id="cell-plot-a"] .js-plotly-plot', timeout=60_000)
        wait_for_open(page, "short.zarr")
        open_browser(page, query="other_small")
        browser_row(page, "other_small.zarr").first.locator(".dsb-name").click()
        wait_for_open(page, "other_small.zarr")
        toast = page.locator(".notification:has-text('Opened other_small.zarr')")
        toast.wait_for(timeout=10_000)
        assert "Panels re-read from it." in toast.inner_text()
        assert page.evaluate("window.PanelManager.getActivePanels().map(p => p.getId())") == ["cell-plot-a"], "the open panel stays"
        toast.locator("[data-action='back']").click()
        wait_for_open(page, "short.zarr")
        assert button_text(page) == "short.zarr"
        assert not s.errors, s.errors
    finally:
        s.close()


def test_choosing_in_the_browser_ends_where_opening_through_the_desktop_entry_point_does(server):
    from annzarro.tests.browser.test_memory_guard import _link
    base, data = server
    ends = []
    for route in ("entry", "browser"):
        s = Session(base)
        try:
            page = s.page
            page.goto(re.sub(r"dataset_path=[^#]*", "dataset_path=" + os.path.join(data, "short.zarr").replace("/", "%2F"), _link(base)))
            page.wait_for_selector('.tile[data-tile-id="cell-plot-a"] .js-plotly-plot', timeout=60_000)
            wait_for_open(page, "short.zarr")
            if route == "entry":
                result = page.evaluate("(p) => window.annzarro.openDataset(p)", os.path.join(data, "other_small.zarr"))
                assert result["ok"] is True and result["path"].endswith("other_small.zarr"), result
            else:
                open_browser(page, query="other_small")
                browser_row(page, "other_small.zarr").first.locator(".dsb-name").click()
            wait_for_open(page, "other_small.zarr")
            page.wait_for_timeout(2500)
            ends.append(page.evaluate("""() => ({path: window.annzarro.getDataset().path, cells: document.getElementById('cell-count').textContent,
                panels: window.PanelManager.getActivePanels().map(p => p.getId()), button: document.getElementById('dataset-button-name').textContent})"""))
        finally:
            s.close()
    assert ends[0] == ends[1], ends
    assert ends[0]["panels"] == ["cell-plot-a"]


# ---- the details pane -----------------------------------------------------------------------

def test_details_show_the_metadata_first_then_the_check_for_a_local_store(server):
    base, data = server
    s = Session(base)
    page = s.page
    try:
        open_browser(page)
        held = []
        release = []
        # hold the check (check=1): the metadata (check=0) is already shown while it runs
        def hold(route):
            if "check=1" in route.request.url and not release:
                held.append(route)
            else:
                route.continue_()
        page.route("**/api/v1/datasets/details*", hold)
        browser_row(page, "short.zarr").first.locator("td").first.click()
        page.wait_for_selector("#dsb-details .dsb-fields dd")
        page.wait_for_selector("#dsb-details .dsb-key", timeout=10_000)
        details = page.inner_text("#dsb-details")
        assert "short.zarr" in details and "200" in details and "zarr format" in details, details
        assert page.locator("#dsb-details .dsb-key").count() >= 3, "obs and obsm keys as chips"
        page.wait_for_function("document.querySelector('#dsb-check') && /Checking/.test(document.querySelector('#dsb-check').textContent)", timeout=10_000)
        page.wait_for_function("() => true")
        deadline = time.time() + 10
        while not held and time.time() < deadline:
            page.wait_for_timeout(100)
        assert held, "the check was asked for on its own, after the metadata"
        release.append(True)
        held[0].continue_()
        page.wait_for_function("document.querySelector('#dsb-check') && /no chunking problems|nothing found|Store check/.test(document.querySelector('#dsb-check').textContent)", timeout=20_000)
        assert page.locator("#dsb-check-run").count() == 0, "no button for a local store"
        # Pin / Copy path / Open
        assert page.locator("#dsb-details-pin").count() == 1 and page.locator("#dsb-details-copy").count() == 1
        page.locator("#dsb-details-open").click()
        wait_for_open(page, "short.zarr")
        assert not s.errors, s.errors
    finally:
        s.close()


def test_the_selection_settles_before_details_are_asked_for_and_a_change_aborts_the_old_ones(server):
    base, data = server
    s = Session(base)
    page = s.page
    try:
        open_browser(page)
        asked = []
        page.on("request", lambda r: asked.append(r.url) if "/datasets/details" in r.url else None)
        rows = page.locator(f"{ROW}[data-kind='store'] .dsb-name")
        rows.nth(0).focus()
        for _ in range(3):
            page.keyboard.press("ArrowDown")                      # moving through rows: nothing is asked while it moves
        page.wait_for_timeout(200)
        assert asked == [], asked
        deadline = time.time() + 10
        while not asked and time.time() < deadline:
            page.wait_for_timeout(100)
        page.wait_for_timeout(600)
        assert len({u.split("path=")[1].split("&")[0] for u in asked}) == 1, "only the row the selection settled on"
    finally:
        s.close()


def _remote_page(base, details, check=None):
    """A page whose recents hold a remote store (mocked: the server of the tests opens none), to look at its details."""
    s = Session(base)
    page = s.page
    remote = "s3://bucket/atlas/remote.zarr"
    entry = {"name": "remote.zarr", "path": remote, "is_link": False, "kind": "store", "rel_path": remote,
             "cells": 1234, "genes": 56, "format": "zarr format 3", "modified": None, "remote": True}
    page.route("**/api/v1/datasets/lookup", lambda route: route.fulfill(
        status=200, content_type="application/json", body=json.dumps({"results": [entry]})))
    calls = []

    def details_route(route):
        url = route.request.url
        calls.append(url)
        body = dict(details)
        if "check=1" in url and check is not None:
            body["store_check"] = check
        elif "check=1" in url:
            body["store_check"] = {"ran": True, "reason": None, "complete": True, "budget_reached": False, "budget_s": 1.5,
                                   "worst": "warning", "counts": {"info": 0, "warning": 1, "slow": 0},
                                   "findings": [{"code": "X_CHUNK", "severity": "warning", "element": "X", "summary": "X is chunked by cells only",
                                                 "cost": "412 MB", "fix": "rechunk", "details": ""}],
                                   "docs": "https://annzarro.readthedocs.io/en/latest/data/chunking.html"}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(body))
    page.route("**/api/v1/datasets/details*", details_route)
    page.evaluate(f"""() => localStorage.setItem({RECENTS_KEY}, JSON.stringify([{{path: {remote!r}, label: {remote!r}, openedAt: 5}}]))""")
    return s, calls, remote


REMOTE_DETAILS = {"name": "remote.zarr", "path": "s3://bucket/atlas/remote.zarr", "remote": True, "readable": True, "error": None,
                  "cells": 1234, "genes": 56, "format": "zarr format 3", "zarr_format": 3, "rel_path": None,
                  "store_check": {"ran": False, "reason": "not_requested", "complete": None, "budget_reached": None}}


def test_a_remote_store_gets_a_check_button_and_its_check_only_on_a_click(server):
    s, calls, remote = _remote_page(server[0], REMOTE_DETAILS)
    page = s.page
    try:
        open_browser(page)
        assert "Remote" in page.inner_text("#dsb-places")
        browser_row(page, "remote.zarr").locator("td").first.click()
        page.wait_for_selector("#dsb-check-run", timeout=10_000)
        assert "1,234" in page.inner_text("#dsb-details")
        page.wait_for_timeout(500)
        assert all("check=0" in c for c in calls), "a remote store is never checked on its own"
        assert page.locator("#dsb-details .dsb-key").count() == 0, "a remote store lists no keys"
        page.click("#dsb-check-run")
        page.wait_for_function("document.querySelector('#dsb-check') && /X is chunked by cells only/.test(document.querySelector('#dsb-check').textContent)")
        assert any("check=1" in c for c in calls)
        link = page.locator("#dsb-check a")
        assert link.get_attribute("href").endswith("chunking.html") and link.get_attribute("rel") == "noopener"
        assert "dsb-note-warn" in page.get_attribute("#dsb-check", "class")
    finally:
        s.close()


def test_a_check_that_ran_out_of_its_budget_says_so_and_h5ad_needs_none(server):
    out_of_budget = {"ran": True, "reason": None, "complete": False, "budget_reached": True, "budget_s": 1.5, "worst": "ok",
                     "counts": {"info": 0, "warning": 0, "slow": 0}, "findings": [], "docs": "https://x.example/docs"}
    local = dict(REMOTE_DETAILS, remote=False)
    s, calls, remote = _remote_page(server[0], local, check=out_of_budget)
    page = s.page
    try:
        open_browser(page)
        browser_row(page, "remote.zarr").locator("td").first.click()
        page.wait_for_function("document.querySelector('#dsb-check') && /Checked part of the store in 1.5 s/.test(document.querySelector('#dsb-check').textContent)", timeout=10_000)
    finally:
        s.close()
    h5 = dict(REMOTE_DETAILS, remote=False, format="h5ad", store_check={"ran": False, "reason": "h5ad", "note": "An .h5ad file is read whole; no chunk check applies."})
    s, calls, remote = _remote_page(server[0], h5, check=h5["store_check"])
    page = s.page
    try:
        open_browser(page)
        browser_row(page, "remote.zarr").locator("td").first.click()
        page.wait_for_function("document.querySelector('#dsb-check') && /read whole/.test(document.querySelector('#dsb-check').textContent)", timeout=10_000)
        assert page.locator("#dsb-check-run").count() == 0
    finally:
        s.close()


def test_details_name_the_keys_the_open_panels_use_that_the_target_lacks(server):
    from annzarro.tests.browser.test_memory_guard import _link
    base, data = server
    s = Session(base)
    page = s.page
    try:
        page.goto(re.sub(r"dataset_path=[^#]*", "dataset_path=" + os.path.join(data, "short.zarr").replace("/", "%2F"), _link(base)))
        page.wait_for_selector('.tile[data-tile-id="cell-plot-a"] .js-plotly-plot', timeout=60_000)
        wait_for_open(page, "short.zarr")
        # the target is another store, said (by the server's details) to lack what the panel colours by
        def details_route(route):
            if "other_small.zarr" in route.request.url and "check=0" in route.request.url:
                route.fulfill(status=200, content_type="application/json", body=json.dumps({
                    "name": "other_small.zarr", "path": os.path.join(data, "other_small.zarr"), "remote": False, "readable": True, "error": None,
                    "cells": 200, "genes": 20, "format": "zarr format 2", "obs_columns": [{"name": "unrelated", "kind": "string"}], "obs_columns_total": 1,
                    "obsm_keys": [], "obsm_total": 0, "layers_keys": [], "layers_total": 0, "var_columns": [], "var_columns_total": 0,
                    "store_check": {"ran": False, "reason": "not_requested"}}))
            else:
                route.continue_()
        page.route("**/api/v1/datasets/details*", details_route)
        open_browser(page)
        browser_row(page, "other_small.zarr").first.locator("td").first.click()
        page.wait_for_selector("#dsb-missing-keys", timeout=10_000)
        text = page.inner_text("#dsb-missing-keys")
        assert "use keys this dataset lacks" in text and "missing" in text, text
        # and a target that has them says nothing
        browser_row(page, "short.zarr").first.locator("td").first.click()
        page.wait_for_selector("#dsb-details .dsb-fields dd")
        page.wait_for_timeout(800)
        assert page.locator("#dsb-missing-keys").count() == 0
        assert not s.errors, s.errors
    finally:
        s.close()


# ---- states, errors, the desktop hook ---------------------------------------------------------

def test_an_empty_data_directory_says_what_to_do_here(empty_server):
    s = Session(empty_server[0])
    try:
        open_browser(s.page)
        text = s.page.inner_text("#dsb-table-wrap")
        assert "Put a .zarr folder or .h5ad file there, then press Refresh." in text, text
    finally:
        s.close()


def test_a_folder_that_fails_to_list_shows_the_error_with_retry_and_the_rest_keeps_working(server):
    base, data = server
    s = Session(base)
    page = s.page
    try:
        open_browser(page)
        page.route("**/api/v1/datasets/folder*folder=*projects*", lambda route: route.fulfill(
            status=500, content_type="application/json", body=json.dumps({"error": "Failed to list the folder"})))
        browser_row(page, "/projects").locator(".dsb-name").click()
        page.wait_for_selector("#dsb-table-wrap [role=alert]")
        assert "Failed to list the folder" in page.inner_text("#dsb-table-wrap")
        # the places still work
        page.click("#dsb-places [data-place='pinned']")
        assert "Nothing pinned" in page.inner_text("#dsb-table-wrap")
        page.click("#dsb-places [data-place='root']")
        browser_row(page, "short.zarr").wait_for()
        browser_row(page, "/projects").locator(".dsb-name").click()
        page.wait_for_selector("#dsb-table-wrap [role=alert]")
        page.unroute("**/api/v1/datasets/folder*folder=*projects*")
        page.click("#dsb-table-wrap .btn:has-text('Retry')")
        browser_row(page, "/lung").wait_for()
    finally:
        s.close()


def _desktop(platform):
    """What the desktop app's preload gives the page (annzarro/desktop/electron/preload.js), as far as the page uses it."""
    return """(() => {
  const mark = () => document.documentElement.setAttribute('data-desktop', '');
  if (document.documentElement) mark(); else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); mark(); } }).observe(document, {childList: true});
  window.__calls = []; window.__opened = [];
  window.api = { platform: %r,
    openDatasetDialog: async (which) => { window.__calls.push(which === undefined ? null : which); return window.__nativePick || null; },
    datasetOpened: (p) => { window.__opened.push(p); } };
})()""" % platform


def test_the_desktop_app_adds_open_file_or_folder_to_the_browser_and_the_welcome_screen(server):
    base, data = server
    # the plain browser has no such button
    s = Session(base)
    try:
        open_browser(s.page)
        assert s.page.is_hidden("#dsb-open-native")
        assert s.page.locator(".welcome-native").is_hidden()
    finally:
        s.close()
    # macOS: one dialog takes a file or a folder
    s = Session(base, init_script=_desktop("darwin"))
    page = s.page
    try:
        assert page.is_visible(".welcome-open-dataset .welcome-native")
        open_browser(page)
        assert page.is_visible("#dsb-open-native") and "Open file or folder" in page.inner_text("#dsb-open-native")
        assert page.locator("[id^='dsb-open-native-']").count() == 0
        # cancelled in the native dialog: nothing opens, the browser stays
        page.click("#dsb-open-native")
        page.wait_for_function("window.__calls.length === 1")
        assert page.evaluate("window.__calls") == [None]
        assert page.locator(BROWSER).is_visible() and dataset_path(page) is None
        # a path picked there opens, and the app is told (proxy icon, recent documents)
        page.evaluate("p => { window.__nativePick = p; }", os.path.join(data, "short.zarr"))
        page.click("#dsb-open-native")
        wait_for_open(page, "short.zarr")
        page.wait_for_function("window.__opened.length > 0")
        assert page.evaluate("window.__opened.at(-1)") == os.path.join(data, "short.zarr")
        # the page's entry point for the app's menu, drops and the OS
        result = page.evaluate("(p) => window.annzarro.openDataset(p)", os.path.join(data, "other_small.zarr"))
        assert result["ok"] is True
        assert page.title().startswith("other_small.zarr")
        page.wait_for_function("window.__opened.at(-1).endsWith('other_small.zarr')")
        assert not s.errors, s.errors
    finally:
        s.close()
    # Windows and Linux: no dialog takes both, so one button each
    s = Session(base, init_script=_desktop("win32"))
    page = s.page
    try:
        assert page.locator(".welcome-open-dataset .welcome-native:visible").count() == 2
        open_browser(page)
        assert page.inner_text("#dsb-open-native").strip() == "Open .h5ad File\u2026"
        assert page.inner_text("#dsb-open-native-zarr").strip() == "Open .zarr Folder\u2026"
        page.click("#dsb-open-native-zarr")
        page.click("#dsb-open-native")
        page.wait_for_function("window.__calls.length === 2")
        assert page.evaluate("window.__calls") == ["zarr", "h5ad"]
    finally:
        s.close()


def test_the_app_menu_opens_the_browser_on_a_folder_and_can_show_a_message(server):
    base, data = server
    s = Session(base, init_script=_desktop("darwin"))
    page = s.page
    try:
        # "Open Dataset..." without a path: the browser; with a plain folder: that folder, and the app is told it was handled
        handled = page.evaluate("""() => { const e = new CustomEvent('annzarro:open-dataset-browser', {cancelable: true, detail: {}});
            document.dispatchEvent(e); return e.defaultPrevented; }""")
        assert handled is False
        page.locator(BROWSER).wait_for(state="visible")
        page.wait_for_function("document.activeElement && document.activeElement.id === 'dsb-search'")
        close_browser(page)
        folder = os.path.join(data, "projects", "lung")
        handled = page.evaluate("""(p) => { const e = new CustomEvent('annzarro:open-dataset-browser', {cancelable: true, detail: {path: p}});
            document.dispatchEvent(e); return e.defaultPrevented; }""", folder)
        assert handled is True
        browser_row(page, "lung_v2.zarr").wait_for(timeout=15_000)
        assert "lung" in page.inner_text("#dsb-crumbs")
        page.wait_for_function("document.activeElement && document.activeElement.id === 'dsb-search'")
        close_browser(page)
        # a message for the app (a refused drop): shown as a toast, true when shown
        assert page.evaluate("window.annzarro.notify('AnnZarro opens .zarr folders and .h5ad files', {level: 'warning'})") is True
        assert page.locator(".notification:has-text('opens .zarr folders')").count() == 1
        assert not s.errors, s.errors
    finally:
        s.close()


def test_an_open_that_something_else_starts_closes_the_browser(server):
    base, data = server
    s = Session(base)
    page = s.page
    try:
        open_browser(page)
        page.evaluate("(p) => { window.annzarro.openDataset(p); }", os.path.join(data, "short.zarr"))
        page.locator(BROWSER).wait_for(state="hidden", timeout=10_000)
        wait_for_open(page, "short.zarr")
    finally:
        s.close()
