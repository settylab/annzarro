"""Searching by field name, from the crawl to the hit, through the real routes (plan step T3).

Nothing is stubbed: a server with login on and two stores, one of which has an obs column, a layer and a ``uns``
path that the other lacks. The administrator's **Rebuild now** starts the crawl (``POST /api/v1/admin/text-index/rebuild``),
the dataset browser searches (``GET /api/v1/datasets/text-search``), and **Show field** on the hit opens the
dataset's information dialog on Structure with the term in its filter.

Needs Playwright with Chromium; skipped without it, or failed when ANNZARRO_REQUIRE_BROWSER=1.
"""
import shutil
import threading

import pytest

from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app
from annzarro.tests.browser.waits import expect_stays
from annzarro.tests.e2e.dsb_servers import Session, _require
from annzarro.tests.server.rich_store import FIXTURE
from annzarro.tests.server.test_text_index_fields import add_names
from annzarro.tests.ui_helpers import open_browser

PASSWORD = "pw-for-field-search"
ROWS = "#dsb-table tbody tr.dsb-row"
INFO = "#dataset-info-modal"


@pytest.fixture
def served(tmp_path):
    _require()
    data = tmp_path / "data"
    data.mkdir()
    shutil.copytree(FIXTURE, data / "plain.zarr")
    shutil.copytree(FIXTURE, data / "pooled.zarr")
    add_names(data / "pooled.zarr", obs=["donor_id"], layers=["ambient_counts"], uns=["donor_metadata/age"])
    manager = AuthManager(user_file=str(tmp_path / "users.json"))
    manager.add_user("alice", PASSWORD, is_admin=True)
    app = create_app({"TESTING": True, "host": "127.0.0.1", "data_dir": str(data), "log_file": str(tmp_path / "t.log"),
                      "auth_enabled": True, "user_file": str(tmp_path / "users.json"), "secret_key": "e2e-field-search"})
    from werkzeug.serving import make_server
    server = make_server("127.0.0.1", 0, app, threaded=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()
    thread.join(10)


def _lines(page, path_end):
    """The field lines of a row as ``{label, text}``, without the Show field button."""
    return page.eval_on_selector_all(
        f"{ROWS}[data-path$='{path_end}'] .dsb-fields",
        """els => els.map(e => { const c = e.cloneNode(true); const label = c.querySelector('.dsb-snippet-field').textContent;
            c.querySelectorAll('button, .dsb-snippet-field').forEach(n => n.remove());
            return {label, text: c.textContent.replace(/\\s+/g, ' ').trim()}; })""")


def test_a_crawl_a_search_and_a_hit_by_field_name(served):
    s = Session(served, login=("alice", PASSWORD))
    page = s.page
    try:
        # the crawl: the administrator's own button, then the state the page itself reports
        page.goto(served + "/admin#health")
        page.locator("#admin-description-rebuild").click()
        page.wait_for_function("() => document.getElementById('admin-description-state').textContent === 'Up to date'", timeout=60_000)
        assert page.inner_text("#admin-description-counts").startswith("2 searchable"), page.inner_text("#admin-description-counts")

        # the search: the real route answers, and only the store that has the name is a hit
        page.goto(served + "/")
        page.wait_for_function("() => window.annzarro && window.annzarro.ready")
        open_browser(page)
        with page.expect_response(lambda r: "/datasets/text-search" in r.url and "donor_id" in r.url) as reply:
            page.fill("#dsb-search", "donor_id")
        body = reply.value.json()
        assert [r["name"] for r in body["results"]] == ["pooled.zarr"]
        assert body["results"][0]["fields"] == [{"kind": "obs", "names": ["donor_id"], "more": 0, "cut": False}]
        assert body["index"]["complete"] is True

        row = page.locator(f"{ROWS}[data-path$='pooled.zarr']")
        row.locator(".dsb-fields").first.wait_for(timeout=20_000)
        assert _lines(page, "pooled.zarr") == [{"label": "obs column", "text": "donor_id"}]
        assert row.locator(".dsb-fields mark").first.inner_text() == "donor_id"
        expect_stays(lambda: page.locator(f"{ROWS}[data-path$='plain.zarr']").count() == 0,
                     "a store without the name must stay out of the hits, and no event announces its absence", page=page)

        # a layer and a uns path are found the same way, each under its own label
        page.fill("#dsb-search", "ambient donor_metadata")
        page.wait_for_function(
            "() => document.querySelectorAll('#dsb-table tbody tr.dsb-row .dsb-fields').length === 2", timeout=20_000)
        assert [line["label"] for line in _lines(page, "pooled.zarr")] == ["layer", "uns"]

        # the hit: Show field opens Structure with the term in the filter
        page.fill("#dsb-search", "donor_id")
        button = page.get_by_role("button", name="Show donor_id in the structure of pooled.zarr")
        button.wait_for(timeout=20_000)
        button.click()
        page.locator(INFO).wait_for(state="visible", timeout=30_000)
        page.wait_for_function("() => document.querySelector('#dsi-tab-structure').classList.contains('active')", timeout=10_000)
        page.wait_for_function(
            "() => { const i = document.querySelector('#dsi-pane-structure .dsi-search-input'); return !!i && i.value === 'donor_id'; }",
            timeout=20_000)
        page.wait_for_function(
            "() => /1 match/.test(document.querySelector('#dsi-pane-structure .dsi-search-status').textContent)", timeout=10_000)
        assert not s.errors, s.errors
    finally:
        s.close()
