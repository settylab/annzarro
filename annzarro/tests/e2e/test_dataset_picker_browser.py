"""The dataset picker (#change-dataset-modal) opened from the dropdown's "Browse...".

The dropdown stays the quick switcher. Its open list has a Browse button
right of the search field (kept through a re-fill, never doubled) that closes
it and opens the picker with the typed search carried over. In that normal
case the picker says "Open a dataset", searches by substring or regex, sorts,
lists a data directory's subfolders lazily, copes with 2,000 stores, is usable
by keyboard, and choosing a store ends in exactly the state choosing it in the
dropdown does (same handler).

Needs Playwright with Chromium; skipped without it, or failed when
ANNZARRO_REQUIRE_BROWSER=1. Starts the server on a free 127.0.0.1 port.
"""
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

import pytest

REQUIRE = os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1"


def _skip_or_fail(reason):
    if REQUIRE:
        pytest.fail(f"{reason} (ANNZARRO_REQUIRE_BROWSER=1)")
    pytest.skip(reason)


try:
    from playwright import sync_api
except ImportError:  # pragma: no cover - depends on the environment
    sync_api = None

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(os.path.dirname(HERE), "data", "fixture_small.zarr")
SHOTS = os.environ.get("DATASET_SHOTS")
LONG = "tahoe_panel_95.6M_plot_" + "liver-met_v3_sharded_csc_float32_" * 2 + "final.zarr"
MODAL = "#change-dataset-modal"
BOX = "#dataset-selector + .select2-container"


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _start(tmp, data):
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(tmp / "home"), ANNZARRO_HEADLESS="1")
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1",
                             "--port", str(port), "--data-dir", str(data), "--no-browser", "--auth-disabled"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env, cwd=tmp)
    base = f"http://127.0.0.1:{port}"
    for _ in range(300):
        try:
            urllib.request.urlopen(base + "/api/v1/config", timeout=1)
            return base, proc
        except OSError:
            time.sleep(0.1)
    proc.kill()
    pytest.fail("server did not start")


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    if sync_api is None:
        _skip_or_fail("Playwright is not installed")
    tmp = tmp_path_factory.mktemp("picker")
    data = tmp / "data"
    for rel in ("short.zarr", LONG, "other_small.zarr", "projects/liver/deep_store.zarr", "projects/lung/lung_v2.zarr"):
        (data / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(FIXTURE, data / rel)
    (data / "broken.zarr").mkdir()
    base, proc = _start(tmp, data)
    yield base, str(data)
    proc.terminate()
    proc.wait(20)


@pytest.fixture(scope="module")
def big_server(tmp_path_factory):
    if sync_api is None:
        _skip_or_fail("Playwright is not installed")
    tmp = tmp_path_factory.mktemp("picker_big")
    data = tmp / "data"
    data.mkdir()
    for i in range(2000):
        os.symlink(FIXTURE, data / f"store_{i:04d}.zarr")
    base, proc = _start(tmp, data)
    yield base, str(data)
    proc.terminate()
    proc.wait(20)


class Session:
    def __init__(self, base, width=1280, height=900):
        self.pw = sync_api.sync_playwright().start()
        try:
            self.browser = self.pw.chromium.launch()
        except Exception as exc:  # no browser binary
            self.pw.stop()
            _skip_or_fail(f"Chromium cannot start: {exc}")
        self.page = self.browser.new_page(viewport={"width": width, "height": height})
        self.page.goto(base + "/")
        self.page.wait_for_selector(BOX, timeout=60_000)
        self.page.wait_for_function("document.querySelectorAll('#dataset-selector option').length >= 2")

    def close(self):
        self.browser.close()
        self.pw.stop()

    def open_dropdown(self):
        self.page.click(BOX)
        self.page.wait_for_selector(".select2-dropdown.dataset-select-dropdown .select2-search__field")

    def browse(self, query=None):
        self.open_dropdown()
        if query:
            self.page.fill(".select2-search__field", query)
        self.page.click(".dataset-browse")
        self.page.wait_for_selector(MODAL, state="visible")
        self.page.wait_for_selector(f"{MODAL} .change-dataset-item, {MODAL} .change-dataset-status")
        self.page.wait_for_function("document.activeElement && document.activeElement.id === 'change-dataset-search'", timeout=5000)


@pytest.fixture
def session(server):
    s = Session(server[0])
    yield s
    s.close()


def test_browse_button_is_in_the_open_dropdown_once_and_survives_a_refill(session):
    page = session.page
    session.open_dropdown()
    assert page.locator(".dataset-select-dropdown .dataset-browse").count() == 1
    search = page.locator(".dataset-select-dropdown .select2-search__field").bounding_box()
    btn = page.locator(".dataset-browse").bounding_box()
    assert btn["x"] >= search["x"] + search["width"] - 1 and abs(btn["y"] - search["y"]) < 12, "right of the search field"
    page.fill(".select2-search__field", "short")                # the list is re-filled
    page.fill(".select2-search__field", "")
    assert page.locator(".dataset-browse").count() == 1
    page.keyboard.press("Escape")
    session.open_dropdown()                                       # re-opened
    assert page.locator(".dataset-browse").count() == 1
    page.keyboard.press("Escape")
    page.click("#refresh-dataset")                                # Select2 destroyed and created again
    page.wait_for_timeout(1500)
    session.open_dropdown()
    assert page.locator(".dataset-browse").count() == 1, "kept after _fillDatasetPicker"


def test_search_text_carries_over_and_the_normal_case_is_worded(session):
    session.browse("short")
    page = session.page
    assert page.input_value("#change-dataset-search") == "short"
    assert page.inner_text("#change-dataset-title") == "Open a dataset"
    assert re.match(r"Showing datasets like .+ first$", page.inner_text("#change-dataset-saved"))
    assert "This view was saved on" not in page.inner_text(MODAL)
    page.wait_for_function("document.activeElement && document.activeElement.id === 'change-dataset-search'", timeout=5000)  # focus is in the search field
    assert page.locator(f"{MODAL} .change-dataset-item").count() >= 1
    names = page.eval_on_selector_all(f"{MODAL} #change-dataset-list .change-dataset-name", "els => els.map(e => e.textContent.trim())")
    assert names and all("short" in n.lower() for n in names)
    assert page.locator(f"{MODAL} mark").count() >= 1, "matches are highlighted"
    assert not page.is_visible("#btn-change-dataset"), "the no-data button stays hidden"


def test_regex_toggle_and_invalid_regex(session):
    session.browse()
    page = session.page
    page.fill("#change-dataset-search", "^short\\.zarr$")
    assert page.locator(f"{MODAL} #change-dataset-list .change-dataset-item").count() == 0, "literal text: no match"
    page.click("#change-dataset-regex")
    assert page.get_attribute("#change-dataset-regex", "aria-pressed") == "true"
    assert page.locator(f"{MODAL} #change-dataset-list .change-dataset-item").count() == 1
    page.fill("#change-dataset-search", "(")
    assert "Invalid regular expression" in page.inner_text("#change-dataset-search-error")
    page.fill("#change-dataset-search", "")
    page.wait_for_selector(f"{MODAL} #change-dataset-list .change-dataset-item")


def test_rows_show_details_and_wrap_long_names(session):
    session.browse()
    page = session.page
    rows = page.eval_on_selector_all(f"{MODAL} #change-dataset-list .change-dataset-item", """els => els.map(e => ({
        path: e.dataset.path, text: e.innerText,
        clipped: [...e.querySelectorAll('.dataset-name')].some(n => n.scrollWidth > n.clientWidth || getComputedStyle(n).textOverflow === 'ellipsis')}))""")
    assert len(rows) >= 3
    assert not any(r["clipped"] for r in rows), "names are wrapped, never cut"
    short = next(r for r in rows if r["path"].endswith("/short.zarr"))
    assert "200 cells x 20 genes" in short["text"] and "zarr format " in short["text"] and "modified 20" in short["text"]
    long_row = next(r for r in rows if LONG in r["text"].replace("\n", ""))
    assert long_row
    # a folder's listing shows an unreadable store, with its reason, instead of dropping it
    page.click(f"{MODAL} .change-dataset-folder[data-folder='']")
    page.wait_for_selector(f"{MODAL} #change-dataset-tree .change-dataset-unreadable")
    broken = page.inner_text(f"{MODAL} #change-dataset-tree .change-dataset-unreadable")
    assert "broken.zarr" in broken and "Not readable" in broken


def test_header_line_shows_the_relative_path_with_the_absolute_one_in_the_tooltip(session):
    session.browse()
    page = session.page
    text = page.inner_text("#change-dataset-saved")
    tip = page.get_attribute("#change-dataset-saved", "title")
    assert os.path.isabs(tip) and tip.endswith(".zarr")
    assert tip not in text, "the absolute path is only in the tooltip"
    assert re.match(r"Showing datasets like [^/]+\.zarr \(200 cells x 20 genes\) first$", text), text


def test_rows_tell_same_named_stores_apart_by_their_folder(session):
    session.browse()
    page = session.page
    top = f"{MODAL} #change-dataset-list .change-dataset-item[data-path$='/short.zarr']"
    assert page.locator(top + " .change-dataset-rel").count() == 0, "no folder line at the top level"
    page.click(f"{MODAL} .change-dataset-folder[data-folder='']")
    page.click(f"{MODAL} .change-dataset-folder[data-folder$='projects']")
    page.click(f"{MODAL} .change-dataset-folder[data-folder$='lung']")
    row = f"{MODAL} #change-dataset-tree .change-dataset-item[data-path$='lung_v2.zarr']"
    page.wait_for_selector(row)
    assert page.inner_text(row + " .change-dataset-rel").strip() == "projects/lung/"


def test_search_finds_stores_in_unexpanded_subfolders_with_one_debounced_request(session):
    page = session.page
    session.browse()
    requests = []
    page.on("request", lambda r: requests.append(r.url) if "/datasets/search" in r.url else None)
    page.click("#change-dataset-search")
    page.keyboard.type("lung_v2", delay=40)
    group = f"{MODAL} .change-dataset-group[aria-label='In subfolders']"
    page.wait_for_selector(group + " .change-dataset-item")
    row = page.locator(group + " .change-dataset-item")
    assert row.count() == 1 and "projects/lung/" in row.inner_text()
    assert len(requests) == 1, f"typing sent {len(requests)} requests: {requests}"
    assert page.locator(f"{MODAL} #change-dataset-tree .change-dataset-item").count() == 0, "found without expanding"
    page.click(group + " .change-dataset-item")
    page.wait_for_selector(MODAL, state="hidden", timeout=10_000)
    page.wait_for_function("document.getElementById('dataset-selector').value.endsWith('lung_v2.zarr')", timeout=20_000)


def test_regex_filters_the_listed_stores_and_is_not_sent_to_the_subfolder_search(session):
    session.browse()
    page = session.page
    requests = []
    page.on("request", lambda r: requests.append(r.url) if "/datasets/search" in r.url else None)
    group = f"{MODAL} .change-dataset-group[aria-label='In subfolders']"
    page.click("#change-dataset-regex")
    page.fill("#change-dataset-search", "^short\\.zarr$")
    assert "Subfolder search uses plain text; regex applies to the listed datasets" in page.inner_text(group)
    assert page.locator(f"{MODAL} #change-dataset-list .change-dataset-item").count() == 1, "the regex filters the listed stores"
    page.wait_for_timeout(900)    # longer than the debounce
    assert requests == [], "a regex is not sent to the server"
    page.click("#change-dataset-regex")      # plain text again: the subfolder search runs
    page.fill("#change-dataset-search", "lung_v2")
    page.wait_for_selector(group + " .change-dataset-item")
    assert len(requests) == 1 and "mode=substring" in requests[0]
    page.fill("#change-dataset-search", "a" * 201)
    page.wait_for_selector(group + " .text-danger")
    assert "at most" in page.inner_text(group)


def test_a_click_anywhere_on_a_row_opens_it_like_enter(server):
    base, _ = server
    ends = []
    for how in ("click-name", "click-meta", "enter"):
        s = Session(base)
        try:
            page = s.page
            s.browse("other_small")
            if how == "enter":
                page.keyboard.press("Enter")
            else:
                page.click(f"{MODAL} #change-dataset-list .change-dataset-item[data-path$='other_small.zarr'] "
                           + (".change-dataset-name" if how == "click-name" else ".change-dataset-meta"))
            page.wait_for_selector(MODAL, state="hidden", timeout=10_000)
            page.wait_for_function("document.getElementById('dataset-selector').value.endsWith('other_small.zarr')", timeout=20_000)
            ends.append(_state(page))
        finally:
            s.close()
    assert ends[0] == ends[1] == ends[2], ends


@pytest.mark.parametrize("width,limit", [(1024, (700, 820)), (1920, (1080, 1200))])
def test_the_modal_is_wider_on_a_wide_window(server, width, limit):
    s = Session(server[0], width=width)
    try:
        s.browse()
        w = s.page.locator(f"{MODAL} .modal-content").bounding_box()["width"]
        assert limit[0] <= w <= limit[1], w
    finally:
        s.close()


def test_sort_by_cells_name_and_modified(session):
    session.browse()
    page = session.page
    page.select_option("#change-dataset-sort", "name")
    names = page.eval_on_selector_all(f"{MODAL} #change-dataset-list .change-dataset-group:last-of-type .change-dataset-name",
                                      "els => els.map(e => e.textContent.trim())")
    assert names == sorted(names, key=str.lower)
    page.select_option("#change-dataset-sort", "modified")
    page.select_option("#change-dataset-sort", "cells")
    assert page.locator(f"{MODAL} .change-dataset-item").count() >= 3


def test_keyboard_navigation_opens_the_highlighted_store(session):
    session.browse("short")
    page = session.page
    assert page.get_attribute("#change-dataset-search", "aria-activedescendant")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("ArrowUp")
    active = page.eval_on_selector(f"{MODAL} .change-dataset-item.active", "e => e.dataset.path")
    assert active.endswith("short.zarr")
    assert page.get_attribute("#change-dataset-list", "role") == "listbox"
    assert page.get_attribute(f"{MODAL} .change-dataset-item", "role") == "option"
    page.keyboard.press("Enter")
    page.wait_for_selector(MODAL, state="hidden", timeout=10_000)
    page.wait_for_function("document.getElementById('dataset-selector').value.endsWith('short.zarr')", timeout=20_000)


def test_escape_closes_and_tab_reaches_regex_sort_and_path(session):
    session.browse()
    page = session.page
    seen = []
    for _ in range(4):
        page.keyboard.press("Tab")
        seen.append(page.evaluate("document.activeElement.id"))
    assert "change-dataset-regex" in seen and "change-dataset-sort" in seen
    page.focus("#change-dataset-search")
    page.keyboard.press("Escape")
    page.wait_for_selector(MODAL, state="hidden", timeout=10_000)


def test_subfolder_store_opens_from_the_lazy_tree(session):
    session.browse()
    page = session.page
    page.click(f"{MODAL} .change-dataset-folder[data-folder='']")
    page.click(f"{MODAL} .change-dataset-folder[data-folder$='projects']")
    page.click(f"{MODAL} .change-dataset-folder[data-folder$='liver']")
    row = f"{MODAL} #change-dataset-tree .change-dataset-item[data-path$='deep_store.zarr']"
    page.wait_for_selector(row)
    assert "200 cells x 20 genes" in page.inner_text(row)
    page.click(row + " button")
    page.wait_for_selector(MODAL, state="hidden", timeout=10_000)
    page.wait_for_function("document.getElementById('dataset-selector').value.endsWith('deep_store.zarr')", timeout=20_000)


def test_the_typed_path_field_shows_the_servers_reason(session):
    session.browse()
    page = session.page
    page.fill("#change-dataset-path", "/definitely/not/here.zarr")
    page.press("#change-dataset-path", "Enter")
    page.wait_for_selector("#change-dataset-error:not([hidden])", timeout=20_000)
    assert page.inner_text("#change-dataset-error").strip()


def test_recently_opened_comes_first(session):
    page = session.page
    session.open_dropdown()
    page.click(".dataset-select-dropdown .select2-results__option:has-text('other_small.zarr')")
    page.wait_for_function("document.getElementById('dataset-selector').value.endsWith('other_small.zarr') && document.getElementById('cell-count').textContent !== 'Loading...' && document.getElementById('cell-count').textContent !== '-'", timeout=30_000)
    session.browse()
    groups = page.eval_on_selector_all(f"{MODAL} #change-dataset-list .change-dataset-group h6", "els => els.map(e => e.textContent)")
    assert groups[0] == "Recently opened"
    assert page.locator(f"{MODAL} .change-dataset-item[data-path$='other_small.zarr']").count() == 1, "listed once"
    assert page.locator(f"{MODAL} .change-dataset-current").count() == 1


def _state(page):
    page.wait_for_timeout(2500)
    return page.evaluate("""() => ({
        dataset: document.getElementById('dataset-selector').value,
        label: document.getElementById('dataset-path').textContent,
        cells: document.getElementById('cell-count').textContent,
        panels: window.PanelManager.getActivePanels().map(p => p.getId()),
        tiles: [...document.querySelectorAll('.tile[data-tile-id]')].map(t => t.dataset.tileId)})""")


def _plot_link(base, data, name):
    from annzarro.tests.browser.test_memory_guard import _link
    return re.sub(r"dataset_path=[^#]*", "dataset_path=" + os.path.join(data, name).replace("/", "%2F"), _link(base))


def _choose(base, data, route):
    s = Session(base)
    try:
        page = s.page
        page.goto(_plot_link(base, data, "short.zarr"))
        page.wait_for_selector('.tile[data-tile-id="cell-plot-a"] .js-plotly-plot', timeout=60_000)
        page.wait_for_function("document.getElementById('dataset-selector') && document.getElementById('dataset-selector').value.endsWith('short.zarr')")
        assert _state(page)["panels"] == ["cell-plot-a"]
        if route == "dropdown":
            s.open_dropdown()
            page.click(".dataset-select-dropdown .select2-results__option:has-text('other_small.zarr')")
        else:
            s.browse("other_small")
            page.click(f"{MODAL} .change-dataset-item[data-path$='other_small.zarr'] button")
            page.wait_for_selector(MODAL, state="hidden", timeout=10_000)
        return _state(page)
    finally:
        s.close()


def test_choosing_in_the_picker_ends_where_the_dropdown_does(server):
    base, data = server
    via_dropdown = _choose(base, data, "dropdown")
    via_picker = _choose(base, data, "picker")
    assert via_dropdown["dataset"].endswith("other_small.zarr")
    assert via_dropdown["panels"] == ["cell-plot-a"], "the open panel stays, as with the dropdown"
    assert via_picker == via_dropdown


@pytest.mark.parametrize("width", [1024, 1920])
def test_two_thousand_stores_render_in_pages_and_search_stays_quick(big_server, width):
    base, _ = big_server
    s = Session(base, width=width, height=900)
    try:
        page = s.page
        page.wait_for_function("document.querySelectorAll('#dataset-selector option').length >= 2000", timeout=120_000)
        s.browse()
        assert page.locator(f"{MODAL} #change-dataset-list .change-dataset-item").count() == 200, "rendered in pages"
        assert "1800 not shown" in page.inner_text(f"{MODAL} .change-dataset-more")
        t0 = time.time()
        page.fill("#change-dataset-search", "store_1999")
        page.wait_for_function("document.querySelectorAll('#change-dataset-list .change-dataset-item').length === 1")
        assert time.time() - t0 < 3
        page.fill("#change-dataset-search", "")
        page.click(f"{MODAL} .change-dataset-more")
        assert page.locator(f"{MODAL} #change-dataset-list .change-dataset-item").count() == 400
        if SHOTS:
            os.makedirs(SHOTS, exist_ok=True)
            page.screenshot(path=os.path.join(SHOTS, f"picker-2000-{page.viewport_size['width']}.png"))
    finally:
        s.close()


@pytest.mark.parametrize("width", [1024, 1920])
def test_picker_screenshots(server, width):
    if not SHOTS:
        pytest.skip("DATASET_SHOTS not set")
    s = Session(server[0], width=width, height=900)
    try:
        page = s.page
        s.open_dropdown()
        page.click(f".dataset-select-dropdown .select2-results__option:has-text('{LONG[:20]}')")
        page.wait_for_timeout(2500)
        s.browse()
        page.click(f"{MODAL} .change-dataset-folder[data-folder='']")
        page.click(f"{MODAL} .change-dataset-folder[data-folder$='projects']")
        page.wait_for_timeout(600)
        os.makedirs(SHOTS, exist_ok=True)
        page.screenshot(path=os.path.join(SHOTS, f"picker-{width}.png"))
        page.fill("#change-dataset-search", "lung_v2")
        page.wait_for_selector(f"{MODAL} .change-dataset-group[aria-label='In subfolders'] .change-dataset-item")
        page.wait_for_timeout(300)
        page.screenshot(path=os.path.join(SHOTS, f"picker-search-{width}.png"))
    finally:
        s.close()
