"""Searching what the datasets say about themselves, from the dataset browser, in a real (headless) browser.

A server with stores that carry attribution and READMEs (``annzarro store annotate``'s writer), three users
(``alice`` an admin, ``carol`` unrestricted, ``bob`` restricted to the folder ``sub``) and the index built by
the server's own crawl. Covered: a word only a README holds finds the store under the name matches; a title
hit ranks above a README hit; text from a README is shown as text; selecting a hit opens the README on the
first highlight; the policy switch hides the toggle; a restricted user sees nothing outside the grants; the
progress line while the index is built; Refresh asks for the index again; Alt+D; regex mode; one request per
pause in typing; dark mode and a phone width without horizontal scrolling.

Set DATASET_SHOTS to a folder to keep screenshots of the results section. Needs Playwright with Chromium;
skipped without it, or failed when ANNZARRO_REQUIRE_BROWSER=1.
"""
import os
import shutil
import socket
import threading

import pytest

from annzarro.server import access, text_index
from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app
from annzarro.server.routes import data_routes
from annzarro.tests.e2e.dsb_servers import FIXTURE, SHOTS, Session, _require
from annzarro.tests.server.test_text_index import annotate
from annzarro.tests.ui_helpers import BROWSER, BUTTON, ROW, close_browser, open_browser

PASSWORD = "pw-for-browser-tests"
TEXT_ROW = f"{ROW}.dsb-text-hit"
SECTION = f"{BROWSER} #dsb-table tbody tr.dsb-section-row"
TEXT_REQUEST = "/api/v1/datasets/text-search"
STATE_LINE = "#dsb-text-state-text"

STORES = {
    "bm_aging.zarr": ({"title": "Bone marrow ageing"}, "# Notes\n\nPreprocessing followed by clustering of the marrow.\n"),
    "title_hit.zarr": ({"title": "Preprocessing benchmark", "description": "A reference run."}, "# Run\n\nNothing else.\n"),
    "readme_hit.zarr": ({"title": "Other atlas"}, "We describe preprocessing at length, and preprocessing again.\n"),
    "preprocessing_names.zarr": None,
    "markup.zarr": ({"title": "Markup store"}, "Look at <img src=x onerror=alert(1)> uniquemarkupword end.\n"),
    "accent.zarr": ({"title": "Accents"}, "Zoë Müller measured 🧬 cells.\n"),
    "out.zarr": ({"title": "Secret kidney"}, "kidneysecret lives here.\n"),
    "sub/granted.zarr": ({"title": "Granted heart"}, "grantedword and preprocessing of the heart.\n"),
}


class World:
    def __init__(self, base, data, app):
        self.base, self.data, self.app = base, data, app

    def session(self, user="carol", **kwargs):
        return Session(self.base, login=(user, PASSWORD), **kwargs)


def serve(tmp_path, **config):
    data = tmp_path / "data"
    for rel, spec in STORES.items():
        (data / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(FIXTURE, data / rel)
        if spec:
            annotate(data / rel, *spec)
    manager = AuthManager(user_file=str(tmp_path / "users.json"))
    for name, admin in (("alice", True), ("bob", False), ("carol", False)):
        manager.add_user(name, PASSWORD, is_admin=admin)
    app = create_app({"TESTING": True, "host": "127.0.0.1", "data_dir": str(data), "log_file": str(tmp_path / "t.log"),
                      "auth_enabled": True, "user_file": str(tmp_path / "users.json"), "secret_key": "browser-test",
                      "text_index_min_interval_s": 0, **config})
    access.add_grant(app.config, "bob", "dir", str(data / "sub"), actor="alice")
    access.set_restricted(app.config, "bob", True)
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    from werkzeug.serving import make_server
    server = make_server("127.0.0.1", port, app, threaded=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return World(f"http://127.0.0.1:{port}", str(data), app), server, thread


@pytest.fixture(autouse=True)
def fresh_caches():
    data_routes._LISTING_PROBE_CACHE.clear()
    text_index._loaded.clear()
    yield
    data_routes._LISTING_PROBE_CACHE.clear()
    text_index._loaded.clear()


def _stop(server, thread):
    server.shutdown()
    thread.join(10)


@pytest.fixture
def world(tmp_path):
    _require()
    w, server, thread = serve(tmp_path)
    yield w
    _stop(server, thread)


def _shot(page, name, settled=True):
    if SHOTS:
        if settled:
            page.wait_for_function("() => /in descriptions/.test(document.getElementById('dsb-status').innerText)", timeout=5_000)
        os.makedirs(SHOTS, exist_ok=True)
        page.screenshot(path=os.path.join(SHOTS, name))


def _type(page, text, delay=None):
    page.fill("#dsb-search", "")
    if delay:
        page.type("#dsb-search", text, delay=delay)
    else:
        page.fill("#dsb-search", text)


def _text_names(page):
    return page.eval_on_selector_all(f"{TEXT_ROW} .dsb-name-text", "els => els.map(e => e.textContent.replace(/\\s+/g, ''))")


def _wait_hits(page, count=1):
    page.wait_for_function(f"() => document.querySelectorAll('#dsb-table tbody tr.dsb-text-hit').length >= {count}", timeout=30_000)


def _open(world, user="carol", query=None, **kwargs):
    s = world.session(user, **kwargs)
    open_browser(s.page, query=query)
    return s


def test_a_word_only_a_readme_holds_finds_the_store_under_the_name_matches(world):
    s = _open(world)
    try:
        page = s.page
        assert page.is_visible("#dsb-text") and page.get_attribute("#dsb-text", "aria-pressed") == "true"
        _type(page, "preprocessing")
        _wait_hits(page, 3)
        order = page.eval_on_selector_all(
            "#dsb-table tbody tr", "rows => rows.map(r => r.classList.contains('dsb-section-row') ? 'section' : r.classList.contains('dsb-text-hit') ? 'text' : r.dataset.kind)")
        assert order.index("section") > 0 and order[:order.index("section")] == ["store"], "the name match comes first, once"
        assert page.inner_text(SECTION).strip().lower() == "found in titles, attribution and readmes"
        names = _text_names(page)
        assert {"bm_aging.zarr", "readme_hit.zarr", "title_hit.zarr", "granted.zarr"} <= set(names)
        assert "preprocessing_names.zarr" not in names, "a store found by name is not listed twice"
        row = page.locator(f"{TEXT_ROW}[data-path$='bm_aging.zarr']")
        assert "Preprocessing" in row.locator(".dsb-snippet mark").first.inner_text()
        assert row.locator(".dsb-snippet-field").inner_text() == "README"
        assert "Bone marrow ageing" in row.locator(".dsb-title").inner_text()
        _shot(page, "text-search-light.png")
    finally:
        s.close()


def _footer(page):
    return page.inner_text("#dsb-status").strip()


def test_the_footer_counts_names_and_descriptions_once_both_answers_are_in(world):
    s = _open(world, query="preprocessing")
    try:
        page = s.page
        _wait_hits(page, 3)
        page.wait_for_function("() => /in descriptions/.test(document.getElementById('dsb-status').innerText)", timeout=5_000)
        assert _footer(page) == "1 name match, 4 in descriptions"
        # the text answer last: hold it while the name answer lands
        page.fill("#dsb-search", "")
        page.wait_for_timeout(400)
        held = []
        page.route("**/api/v1/datasets/text-search*", lambda route: held.append(route))
        page.fill("#dsb-search", "clustering")
        for _ in range(50):
            if held:
                break
            page.wait_for_timeout(100)
        page.wait_for_timeout(500)
        assert "in descriptions" not in _footer(page)
        for route in held:
            route.continue_()
        page.unroute("**/api/v1/datasets/text-search*")
        page.wait_for_function("() => document.getElementById('dsb-status').innerText === '0 name matches, 1 in descriptions'", timeout=5_000)
    finally:
        s.close()


def test_a_title_hit_ranks_above_a_readme_hit(world):
    s = _open(world, query="preprocessing")
    try:
        _wait_hits(s.page, 3)
        names = _text_names(s.page)
        assert names.index("title_hit.zarr") < names.index("readme_hit.zarr")
        assert names.index("title_hit.zarr") < names.index("bm_aging.zarr")
        title_row = s.page.locator(f"{TEXT_ROW}[data-path$='title_hit.zarr']")
        assert title_row.locator(".dsb-title mark").count() == 1, "the title carries the highlight"
    finally:
        s.close()


def test_text_from_a_readme_is_shown_as_text_not_markup(world):
    s = _open(world, query="uniquemarkupword")
    try:
        page = s.page
        _wait_hits(page)
        snippet = page.locator(f"{TEXT_ROW} .dsb-snippet")
        assert "<img src=x" in snippet.inner_text()
        assert page.locator("#dsb-table img").count() == 0
        page.click(f"{TEXT_ROW} .dsb-name")  # opens the dataset: the dialog closes
        assert not s.errors, s.errors
    finally:
        s.close()


def test_non_ascii_text_is_found_without_accents_and_highlighted_in_place(world):
    s = _open(world, query="zoe muller")
    try:
        page = s.page
        _wait_hits(page)
        marks = page.eval_on_selector_all(f"{TEXT_ROW}[data-path$='accent.zarr'] .dsb-snippet mark", "els => els.map(e => e.textContent)")
        assert marks == ["Zoë", "Müller"]
    finally:
        s.close()


def test_selecting_a_hit_fills_the_details_and_the_readme_opens_on_the_first_highlight(world):
    s = _open(world, query="clustering")
    try:
        page = s.page
        _wait_hits(page)
        page.click(f"{TEXT_ROW}[data-path$='bm_aging.zarr'] .dsb-namecell", position={"x": 4, "y": 4})
        page.wait_for_selector("#dsb-details .dsb-about-more[data-part=readme][open]", timeout=20_000)
        mark = page.locator("#dsb-details .dsb-about-more[data-part=readme] mark.dsi-mark").first
        mark.wait_for(timeout=20_000)
        assert mark.inner_text().lower() == "clustering"
        assert mark.evaluate("m => { const r = m.getBoundingClientRect(), p = document.getElementById('dsb-details').getBoundingClientRect(); return r.top >= p.top - 1 && r.bottom <= p.bottom + 1; }")
        assert page.is_visible("#dsb-details-open")
    finally:
        s.close()


def test_a_hit_opens_like_any_row(world):
    s = _open(world, query="clustering")
    try:
        page = s.page
        _wait_hits(page)
        page.click(f"{TEXT_ROW}[data-path$='bm_aging.zarr'] .dsb-name")
        page.locator(BROWSER).wait_for(state="hidden", timeout=20_000)
        page.wait_for_function("() => document.querySelector('#dataset-button .dataset-button-name').innerText.includes('bm_aging')", timeout=30_000)
    finally:
        s.close()


def test_the_policy_off_hides_the_toggle_and_asks_nothing(tmp_path):
    _require()
    w, server, thread = serve(tmp_path, text_index_enabled=False)
    s = w.session()
    try:
        requests = []
        s.page.on("request", lambda r: requests.append(r.url) if "/datasets/text-" in r.url else None)
        open_browser(s.page)
        assert s.page.is_hidden("#dsb-text")
        _type(s.page, "preprocessing")
        s.page.wait_for_timeout(1000)
        assert requests == [], requests
        assert s.page.locator(".dsb-section-row").count() == 0
        assert s.page.is_hidden("#dsb-text-state")
    finally:
        s.close()
        _stop(server, thread)


def test_a_restricted_user_sees_hits_inside_the_grants_only(world):
    s = _open(world, user="bob")
    try:
        page = s.page
        _type(page, "kidneysecret")
        page.wait_for_timeout(1500)
        assert page.locator(TEXT_ROW).count() == 0
        assert "kidneysecret" not in page.inner_text("#dsb-table-wrap").lower() or "No dataset" in page.inner_text("#dsb-table-wrap")
        _type(page, "grantedword")
        _wait_hits(page)
        assert _text_names(page) == ["granted.zarr"]
        text = page.inner_text(BROWSER)
        assert world.data not in text and os.path.dirname(world.data) not in text
        assert not s.errors, s.errors
    finally:
        s.close()


def test_a_restricted_user_opens_a_hit(world):
    s = _open(world, user="bob", query="grantedword")
    try:
        page = s.page
        _wait_hits(page)
        page.click(f"{TEXT_ROW} .dsb-name")
        page.locator(BROWSER).wait_for(state="hidden", timeout=20_000)
        page.wait_for_function("() => document.querySelector('#dataset-button .dataset-button-name').innerText.includes('granted')", timeout=30_000)
    finally:
        s.close()


def test_the_progress_line_shows_while_the_index_is_built_and_the_hits_arrive_when_it_is_done(tmp_path, monkeypatch):
    _require()
    gate = threading.Event()
    real = text_index.read_text
    monkeypatch.setattr(text_index, "read_text", lambda path, n: (gate.wait(60), real(path, n))[1])
    w, server, thread = serve(tmp_path, text_index_store_timeout_s=60)
    s = w.session()
    try:
        page = s.page
        polls = []
        page.on("request", lambda r: polls.append(r.url) if "text-index/status" in r.url else None)
        open_browser(page)
        _type(page, "preprocessing")
        page.wait_for_function("() => /^Indexing descriptions/.test(document.getElementById('dsb-text-state-text').textContent)", timeout=20_000)
        assert page.is_visible("#dsb-text-progress")
        assert page.locator(TEXT_ROW).count() == 0
        _shot(page, "text-search-indexing.png", settled=False)
        page.wait_for_timeout(2000)
        assert len(polls) >= 2, "the status is read while the crawl runs"
        gate.set()
        _wait_hits(page, 3)
        page.wait_for_function("() => document.getElementById('dsb-text-progress').hidden", timeout=20_000)
        assert not page.inner_text(STATE_LINE).startswith("Indexing")
        assert "datasets indexed" in page.inner_text(STATE_LINE)
        seen = len(polls)
        page.wait_for_timeout(2000)
        assert len(polls) == seen, "polling stopped with the crawl"
    finally:
        gate.set()
        s.close()
        _stop(server, thread)


def test_polling_stops_when_the_dialog_closes(tmp_path, monkeypatch):
    _require()
    gate = threading.Event()
    real = text_index.read_text
    monkeypatch.setattr(text_index, "read_text", lambda path, n: (gate.wait(60), real(path, n))[1])
    w, server, thread = serve(tmp_path, text_index_store_timeout_s=60)
    s = w.session()
    try:
        page = s.page
        polls = []
        page.on("request", lambda r: polls.append(r.url) if "text-index/status" in r.url else None)
        open_browser(page, query="preprocessing")
        page.wait_for_function("() => /^Indexing descriptions/.test(document.getElementById('dsb-text-state-text').textContent)", timeout=20_000)
        page.wait_for_timeout(1700)
        assert polls
        close_browser(page)
        page.wait_for_timeout(300)
        seen = len(polls)
        page.wait_for_timeout(2000)
        assert len(polls) == seen
    finally:
        gate.set()
        s.close()
        _stop(server, thread)


def test_refresh_asks_the_server_to_read_the_descriptions_again(world):
    s = _open(world, query="preprocessing")
    try:
        page = s.page
        _wait_hits(page, 3)
        posts = []
        page.on("request", lambda r: posts.append(r) if r.method == "POST" and "text-index/refresh" in r.url else None)
        page.click("#dsb-refresh")
        page.wait_for_function("() => document.getElementById('dsb-refresh').getAttribute('aria-busy') === 'false'", timeout=30_000)
        assert len(posts) == 1
        # with the toggle off the button leaves the index alone
        page.keyboard.press("Alt+d")
        assert page.get_attribute("#dsb-text", "aria-pressed") == "false"
        page.click("#dsb-refresh")
        page.wait_for_function("() => document.getElementById('dsb-refresh').getAttribute('aria-busy') === 'false'", timeout=30_000)
        assert len(posts) == 1
    finally:
        s.close()


def test_alt_d_toggles_the_search_of_descriptions(world):
    s = _open(world, query="preprocessing")
    try:
        page = s.page
        _wait_hits(page, 3)
        page.keyboard.press("Alt+d")
        assert page.get_attribute("#dsb-text", "aria-pressed") == "false"
        assert page.locator(TEXT_ROW).count() == 0 and page.locator(".dsb-section-row").count() == 0
        assert page.locator(f"{ROW}[data-path$='preprocessing_names.zarr']").count() == 1, "the name match stays"
        page.keyboard.press("Alt+d")
        assert page.get_attribute("#dsb-text", "aria-pressed") == "true"
        _wait_hits(page, 3)
        page.click("#dsb-text")
        assert page.get_attribute("#dsb-text", "aria-pressed") == "false"
    finally:
        s.close()


def test_regular_expression_mode_turns_the_descriptions_off(world):
    s = _open(world, query="preprocessing")
    try:
        page = s.page
        _wait_hits(page, 3)
        requests = []
        page.on("request", lambda r: requests.append(r.url) if "text-search" in r.url else None)
        page.click("#dsb-regex")
        assert page.get_attribute("#dsb-text", "aria-pressed") == "false"
        page.wait_for_timeout(800)
        assert page.locator(TEXT_ROW).count() == 0 and not requests
        page.click("#dsb-text")        # asking for descriptions again ends regular expression mode
        assert page.get_attribute("#dsb-regex", "aria-pressed") == "false"
        _wait_hits(page, 3)
    finally:
        s.close()


def test_typing_asks_once_per_pause_and_an_empty_query_asks_nothing(world):
    s = _open(world, query="preprocessing")
    try:
        page = s.page
        _wait_hits(page, 3)          # the first search builds the index and asks again when it is done
        page.fill("#dsb-search", "")
        page.wait_for_timeout(500)
        requests = []
        page.on("request", lambda r: requests.append(r.url) if TEXT_REQUEST in r.url else None)
        page.type("#dsb-search", "preprocessing", delay=40)
        page.wait_for_timeout(1200)
        _wait_hits(page, 3)
        assert len(requests) == 1, requests
        page.fill("#dsb-search", "")
        page.wait_for_timeout(1000)
        assert len(requests) == 1
        page.fill("#dsb-search", "   ")
        page.wait_for_timeout(1000)
        assert len(requests) == 1
    finally:
        s.close()


def test_a_slower_answer_for_an_old_query_does_not_replace_the_new_one(world):
    s = _open(world)
    try:
        page = s.page
        held = []

        def hold(route):
            if "q=clustering" in route.request.url:
                held.append(route)
            else:
                route.continue_()
        page.route("**/api/v1/datasets/text-search*", hold)
        _type(page, "clustering")
        page.wait_for_function("() => true")
        for _ in range(50):
            if held:
                break
            page.wait_for_timeout(100)
        assert held
        _type(page, "uniquemarkupword")
        _wait_hits(page)
        assert _text_names(page) == ["markup.zarr"]
        for route in held:
            route.continue_()
        page.wait_for_timeout(500)
        assert _text_names(page) == ["markup.zarr"]
    finally:
        s.close()


def test_a_dataset_that_is_gone_is_not_opened_from_a_hit(world):
    s = _open(world, query="clustering")
    try:
        page = s.page
        _wait_hits(page)
        shutil.rmtree(os.path.join(world.data, "bm_aging.zarr"))
        page.click(f"{TEXT_ROW}[data-path$='bm_aging.zarr'] .dsb-name")
        page.wait_for_function("() => !document.querySelector('#dsb-table tr.dsb-text-hit[data-path$=\"bm_aging.zarr\"]')", timeout=20_000)
        assert page.locator(BROWSER).is_visible()
        page.wait_for_function("() => document.getElementById('dsb-status').innerText.includes('no longer available')", timeout=5_000)
    finally:
        s.close()


@pytest.mark.parametrize("scheme,width,shot", [("dark", 1280, "text-search-dark.png"), ("dark", 390, "text-search-dark-phone.png"),
                                                ("light", 390, "text-search-light-phone.png")])
def test_dark_mode_and_a_phone_width_do_not_scroll_sideways(world, scheme, width, shot):
    s = _open(world, query="preprocessing", scheme=scheme, width=width, height=900)
    try:
        page = s.page
        _wait_hits(page, 3)
        page.wait_for_timeout(500)
        wide = page.evaluate("""() => {
            const out = [];
            for (const sel of ['#dataset-browser .modal-content', '#dsb-table-wrap', '.dsb-toolbar', '#dsb-text-state']) {
                const el = document.querySelector(sel);
                if (el && el.scrollWidth > el.clientWidth + 1) out.push(sel + ' ' + el.scrollWidth + '>' + el.clientWidth);
            }
            if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push('page');
            return out;
        }""")
        assert wide == []
        assert page.is_visible("#dsb-text")
        look = page.evaluate("""() => ['dsb-regex', 'dsb-text'].map(id => { const e = document.getElementById(id), c = getComputedStyle(e);
            return [Math.round(e.getBoundingClientRect().height), c.borderTopWidth, c.borderTopColor, c.paddingTop]; })""")
        assert look[0][0] == look[1][0] and look[0][1] == look[1][1] and look[0][3] == look[1][3], look     # a matching pair
        page.locator(SECTION).scroll_into_view_if_needed()
        _shot(page, shot)
        if SHOTS:
            page.evaluate("() => document.activeElement.blur()")
            page.locator(".dsb-toolbar").screenshot(path=os.path.join(SHOTS, shot.replace(".png", "-toolbar.png")))
        if scheme == "dark":
            # text on the highlight keeps a readable contrast: the mark is dark-on-light or light-on-dark, never equal
            colours = page.evaluate("() => { const m = document.querySelector('.dsb-snippet mark'); const c = getComputedStyle(m); return [c.color, c.backgroundColor]; }")
            assert colours[0] != colours[1]
    finally:
        s.close()
