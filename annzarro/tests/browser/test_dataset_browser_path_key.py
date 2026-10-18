"""`/` and `~` start a path in the dataset browser, in Chromium and in WebKit (Safari's engine).

Safari keeps Cmd+L for its address bar, so the hint shows `/` on every platform and the key works anywhere:
from the list, and from the search box while it is empty. A search box that already holds text keeps the
character (a search for `a/b`). Ctrl+L stays as a second chord where the browser delivers it.

Needs Playwright with the engine installed; skipped without it, or failed when ANNZARRO_REQUIRE_BROWSER=1.
"""
import pytest

from annzarro.tests.e2e.dsb_servers import Session, server  # noqa: F401  (fixture)
from annzarro.tests.ui_helpers import ROW, open_browser

ENGINES = ["chromium", "webkit"]


@pytest.fixture(params=ENGINES)
def page_session(request, server):
    s = Session(server[0], engine=request.param)
    yield s
    s.close()


def _active(page):
    return page.evaluate("document.activeElement.id")


def test_the_hint_names_slash_on_every_platform(page_session):
    page = page_session.page
    open_browser(page)
    assert page.inner_text("#dsb-hint-path").strip() == "/"
    assert page.inner_text(".dsb-crumb-hint").strip() == "Type a path or URL: /"
    assert "(/)" in page.get_attribute(".dsb-crumb-edit", "title")


@pytest.mark.parametrize("key", ["/", "~"])
def test_the_key_opens_the_path_field_prefilled_from_the_list(page_session, key):
    page = page_session.page
    open_browser(page)
    page.focus(f"{ROW}[data-kind='store'] .dsb-name")
    page.keyboard.press(key)
    assert page.is_visible("#dsb-path") and _active(page) == "dsb-path"
    assert page.input_value("#dsb-path") == key
    page.keyboard.type("data")                 # typing carries on after the character
    assert page.input_value("#dsb-path") == key + "data"
    page.keyboard.press("Escape")
    assert page.is_visible("#dsb-crumbs")
    assert not page_session.errors, page_session.errors


@pytest.mark.parametrize("key", ["/", "~"])
def test_the_key_opens_the_path_field_from_an_empty_search_box(page_session, key):
    page = page_session.page
    open_browser(page)
    assert _active(page) == "dsb-search" and page.input_value("#dsb-search") == ""
    page.keyboard.press(key)
    assert _active(page) == "dsb-path" and page.input_value("#dsb-path") == key
    assert page.input_value("#dsb-search") == ""


def test_the_key_stays_in_a_search_box_that_holds_text(page_session):
    page = page_session.page
    open_browser(page, query="a")
    page.focus("#dsb-search")
    page.keyboard.press("End")
    page.keyboard.press("/")
    page.keyboard.press("~")
    assert _active(page) == "dsb-search" and page.input_value("#dsb-search") == "a/~"
    assert page.is_hidden("#dsb-path")


def test_ctrl_l_still_opens_an_empty_path_field(page_session):
    page = page_session.page
    open_browser(page)
    page.keyboard.press("Control+l")
    assert _active(page) == "dsb-path" and page.input_value("#dsb-path") == ""
