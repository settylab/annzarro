"""Field-name hits in the dataset browser, in a real (headless) browser (plan step T2, SCH-4, SCH-8, SCH-14, SCH-15).

The server's text-search answer is held to the frozen reply of plan 1.5 (``tests/data/text_search_fields_reply.json``)
with ``page.route``, so these tests do not depend on the server step that produces it. The open dataset's own fields
are matched in the browser, from the structure the page holds, whatever the server answers.

Needs Playwright with Chromium; skipped without it, or failed when ANNZARRO_REQUIRE_BROWSER=1.
"""
import json
import os

import pytest

from annzarro.tests.browser.test_dataset_browser_text_search import (  # noqa: F401  (fresh_caches is an autouse fixture)
    PASSWORD, _stop, fresh_caches, serve)
from annzarro.tests.e2e.dsb_servers import _require
from annzarro.tests.ui_helpers import BROWSER, open_browser, open_dataset

TEXT_REQUEST = "**/api/v1/datasets/text-search*"
ROWS = "#dsb-table tbody tr.dsb-row"
INFO = "#dataset-info-modal"
HERE = os.path.dirname(os.path.abspath(__file__))
FROZEN = json.load(open(os.path.join(HERE, "..", "data", "text_search_fields_reply.json"), encoding="utf-8"))


@pytest.fixture
def world(tmp_path):
    _require()
    w, server, thread = serve(tmp_path)
    yield w
    _stop(server, thread)


def _answer(page, results, index=None):
    body = json.dumps({"results": results, "more": 0, "partial": False, "index": index or {"complete": True, "names": {"state": "ready"}}})
    page.route(TEXT_REQUEST, lambda route: route.fulfill(status=200, content_type="application/json", body=body))


def _hit(world, name, **extra):
    path = f"{world.data}/{name}"
    return {"name": name, "path": path, "rel_path": name, "title": "", "score": 5, "matched": [], "snippet": None,
            "format": "zarr", "cells": 10, "genes": 5, **extra}


def _open_with(world, name, user="carol", **kwargs):
    s = world.session(user, **kwargs)
    open_dataset(s.page, f"{world.data}/{name}")
    return s


def _type(page, text):
    page.fill("#dsb-search", "")
    page.fill("#dsb-search", text)


def _lines(page, path_end):
    return page.eval_on_selector_all(
        f"{ROWS}[data-path$='{path_end}'] .dsb-fields",
        "els => els.map(e => ({label: e.querySelector('.dsb-snippet-field').textContent, text: e.textContent.replace(e.querySelector('.dsb-snippet-field').textContent, '').trim()}))")


def test_the_open_dataset_matches_by_its_fields_before_the_crawl_reaches_it(world):
    s = _open_with(world, "bm_aging.zarr")
    try:
        page = s.page
        _answer(page, [], {"complete": False, "names": {"state": "building", "read": 0, "total": 8}})
        open_browser(page)
        _type(page, "leiden")
        row = page.locator(f"{ROWS}[data-path$='bm_aging.zarr']")
        row.locator(".dsb-fields").first.wait_for(timeout=20_000)
        assert row.locator(".dsb-badge-open").count() == 1
        assert page.eval_on_selector_all(f"{ROWS}", "rows => rows[0].dataset.path.endsWith('bm_aging.zarr')")
        assert _lines(page, "bm_aging.zarr") == [{"label": "obs column", "text": "leiden"}]
        assert row.locator(".dsb-fields mark").first.inner_text() == "leiden"
        assert not s.errors, s.errors
    finally:
        s.close()


def test_a_query_with_terms_in_two_kinds_gives_one_line_each(world):
    s = _open_with(world, "bm_aging.zarr")
    try:
        page = s.page
        _answer(page, [])
        open_browser(page)
        _type(page, "umap gene")
        page.locator(f"{ROWS}[data-path$='bm_aging.zarr'] .dsb-fields").first.wait_for(timeout=20_000)
        assert [l["label"] for l in _lines(page, "bm_aging.zarr")] == ["var column", "embedding (obsm)"]
    finally:
        s.close()


def test_show_field_opens_structure_with_the_term_filled_in(world):
    s = _open_with(world, "bm_aging.zarr")
    try:
        page = s.page
        _answer(page, [])
        open_browser(page)
        _type(page, "leiden")
        button = page.get_by_role("button", name="Show leiden in the structure of bm_aging.zarr")
        button.wait_for(timeout=20_000)
        assert button.get_attribute("tabindex") in (None, "0")
        button.click()
        page.locator(INFO).wait_for(state="visible", timeout=20_000)
        page.wait_for_function("() => document.querySelector('#dsi-tab-structure').classList.contains('active')", timeout=10_000)
        page.wait_for_function("() => { const i = document.querySelector('#dsi-pane-structure .dsi-search-input'); return !!i && i.value === 'leiden'; }", timeout=20_000)
        page.wait_for_function("() => /1 match/.test(document.querySelector('#dsi-pane-structure .dsi-search-status').textContent)", timeout=10_000)
        assert page.locator(f"{BROWSER}").is_hidden()
        assert not s.errors, s.errors
    finally:
        s.close()


def test_show_field_is_reached_by_the_keyboard(world):
    s = _open_with(world, "bm_aging.zarr")
    try:
        page = s.page
        _answer(page, [])
        open_browser(page)
        _type(page, "leiden")
        button = page.get_by_role("button", name="Show leiden in the structure of bm_aging.zarr")
        button.wait_for(timeout=20_000)
        button.focus()
        page.keyboard.press("Enter")
        page.locator(INFO).wait_for(state="visible", timeout=20_000)
    finally:
        s.close()


def test_a_server_hit_shows_its_lines_more_and_the_shortened_marker(world):
    s = _open_with(world, "bm_aging.zarr")
    try:
        page = s.page
        hit = _hit(world, "readme_hit.zarr", matched=["description", "obs", "uns"], fields=[
            {"kind": "obs", "names": ["donor_id", "donor_sex"], "more": 0, "cut": False},
            {"kind": "uns", "names": ["donor_metadata/age"], "more": 3, "cut": True}])
        _answer(page, [hit], FROZEN["index"])
        open_browser(page)
        _type(page, "donor")
        page.locator(f"{ROWS}[data-path$='readme_hit.zarr'] .dsb-fields").first.wait_for(timeout=20_000)
        assert _lines(page, "readme_hit.zarr") == [
            {"label": "obs column", "text": "donor_id · donor_sex"},
            {"label": "uns", "text": "donor_metadata/age · +3 more (field list shortened)"}]
        assert page.locator("#dsb-text-state").inner_text() == "Field names are still being indexed: 41 of 212 datasets read. Results may be incomplete."
        # a hit of another dataset: Show field names its first field
        assert page.get_by_role("button", name="Show donor_id in the structure of readme_hit.zarr").count() == 1
    finally:
        s.close()


def test_no_hit_while_the_index_is_building_and_after(world):
    s = _open_with(world, "bm_aging.zarr")
    try:
        page = s.page
        _answer(page, [], {"complete": False, "names": {"state": "building", "read": 3, "total": 8}})
        open_browser(page)
        _type(page, "donr")
        page.wait_for_function("() => /No dataset matches yet: field names are still being indexed/.test(document.querySelector('#dsb-table-wrap').innerText)", timeout=20_000)
        page.unroute(TEXT_REQUEST)
        _answer(page, [])
        _type(page, "donrr")
        page.wait_for_function("() => document.querySelector('#dsb-table-wrap').innerText.includes(\"No dataset has a name, description or field matching 'donrr'.\")", timeout=20_000)
    finally:
        s.close()


def test_the_placeholder_and_the_toggle_name_what_is_searched(world):
    s = _open_with(world, "bm_aging.zarr")
    try:
        page = s.page
        open_browser(page)
        assert page.get_attribute("#dsb-search", "placeholder") == "Search names, descriptions, READMEs and field names (columns, layers, embeddings)"
        assert page.get_attribute("#dsb-text", "title") == "Also search descriptions, READMEs and field names (Alt+D)"
        assert page.inner_text("#dsb-text .dsb-text-label") == "Descriptions"
        page.click("#dsb-text")
        assert page.get_attribute("#dsb-search", "placeholder") == "Search name or path"
    finally:
        s.close()


def test_a_narrow_window_has_the_short_placeholder_and_no_sideways_scroll(world):
    s = _open_with(world, "bm_aging.zarr", width=600, height=900)
    try:
        page = s.page
        _answer(page, [])
        open_browser(page)
        assert page.get_attribute("#dsb-search", "placeholder") == "Search names, descriptions and fields"
        _type(page, "leiden")
        page.get_by_role("button", name="Show leiden in the structure of bm_aging.zarr").wait_for(timeout=20_000)
        assert page.evaluate("() => { const w = document.querySelector('#dsb-table-wrap'); return w.scrollWidth <= w.clientWidth + 1; }")
    finally:
        s.close()


def test_show_field_on_another_dataset_opens_it_and_then_the_structure(world):
    s = _open_with(world, "bm_aging.zarr")
    try:
        page = s.page
        hit = _hit(world, "title_hit.zarr", matched=["obs"], fields=[{"kind": "obs", "names": ["leiden"], "more": 0, "cut": False}])
        _answer(page, [hit])
        open_browser(page)
        _type(page, "leiden")
        page.get_by_role("button", name="Show leiden in the structure of title_hit.zarr").click(timeout=20_000)
        page.wait_for_function("() => { const s = window.annzarro.getDataset(); return s.status === 'open' && s.path.endsWith('title_hit.zarr'); }", timeout=60_000)
        page.locator(INFO).wait_for(state="visible", timeout=30_000)
        page.wait_for_function("() => { const i = document.querySelector('#dsi-pane-structure .dsi-search-input'); return !!i && i.value === 'leiden'; }", timeout=30_000)
    finally:
        s.close()
