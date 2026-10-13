"""Panels the administrator disabled, in a real browser (policy client, slice P2).

GET /api/v1/policy/effective is stubbed with Playwright request interception
(the server side of the policy registry is another slice; this server answers
404, which is the "no policy" fallback the first test also checks).

1. Without a policy endpoint nothing changes: the menu offers every panel type.
2. A policy that disables Gene Set Analysis: the panel menu lacks it; a link
   holding a gene-set panel opens with the "Disabled by the administrator"
   placeholder while the gene table works; saving the layout again keeps the
   panel's JSON; nothing leaves the browser.
3. A tab opened before the administrator turned external services off sends
   nothing at its next Run and says so.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import json
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_gene_set_panel import (  # noqa: E402
    GS, TABLE, Services, _link, _ready, bar, until,
)
from annzarro.tests.browser.test_memory_guard import _serve  # noqa: E402

ALL_TYPES = ["cell-plot", "gene-plot", "cell-table", "gene-table", "gene-set"]


class PolicyStub:
    """Answers GET /api/v1/policy/effective; `reply` is None for a server without the endpoint."""

    def __init__(self, reply=None):
        self.reply = reply
        self.reads = 0

    def handle(self, route):
        self.reads += 1
        if self.reply is None:
            return route.fulfill(status=404, body='{"error": "not found"}', headers={"Content-Type": "application/json"})
        return route.fulfill(status=200, body=json.dumps(self.reply),
                             headers={"Content-Type": "application/json", "X-AnnZarro-Policy": self.reply["version"]})


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    root, proc = _serve(tmp_path_factory)
    yield root
    proc.terminate()
    proc.wait(10)


@pytest.fixture(scope="module")
def browser():
    with playwright.sync_playwright() as p:
        b = p.chromium.launch()
        yield b
        b.close()


@pytest.fixture
def env(browser, server):
    context = browser.new_context(viewport={"width": 1500, "height": 1100})
    page = context.new_page()
    services = Services(server)
    page.route("**/*", services.handle)
    policy = PolicyStub()
    page.route("**/api/v1/policy/effective*", policy.handle)  # later routes win
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    yield page, services, policy, server
    assert not errors, errors
    assert not services.unmocked, f"unmocked external requests: {services.unmocked}"
    context.close()


def menu(page):
    return page.locator(".panel-type-option").evaluate_all("els => els.map(e => e.dataset.type)")


def test_no_policy_endpoint_changes_nothing(env):
    page, services, policy, root = env
    page.goto(_link(root))
    _ready(page)
    assert policy.reads >= 1
    assert menu(page) == ALL_TYPES
    assert page.locator(f"{GS} .gs-run").count() == 1
    assert page.locator(".panel-no-data").count() == 0


def test_disabled_panel_is_a_placeholder_and_not_in_the_menu(env):
    page, services, policy, root = env
    policy.reply = {"version": "v7", "values": {"panel.gene-set.enabled": False}}
    gs = {"autoUpdate": False, "taxonomyId": "10090", "sections": {"string-enrichment": {"visible": True, "params": {"category": "KEGG"}}},
          "futureField": {"kept": [1, 2, 3]}}
    page.goto(_link(root, gs=gs))
    page.wait_for_selector(f"{TABLE} .dataTables_scrollBody tbody tr", timeout=30000)
    until(page, "() => !!document.querySelector('.panel-no-data[data-disabled-by-policy]')")
    box = page.locator(f'{GS} .panel-no-data')
    assert "Disabled by the administrator" in box.inner_text()
    assert page.locator(f"{GS} .gs-run").count() == 0
    assert "gene-set" not in menu(page)
    assert menu(page) == [t for t in ALL_TYPES if t != "gene-set"]

    # saving the layout again loses nothing of the disabled panel
    saved = page.evaluate("() => window.PanelManager.saveLayout().panelConfigs['gene-set-G']")
    assert saved["id"] == "gene-set-G"
    assert saved["tableFilter"] == "gene-table-A"
    assert saved["futureField"] == {"kept": [1, 2, 3]}
    assert saved["sections"]["string-enrichment"]["params"] == {"category": "KEGG"}
    assert saved["taxonomyId"] == "10090"
    # and nothing was sent anywhere
    assert services.calls == []


def test_open_tab_stops_at_its_next_run_after_outbound_is_switched_off(env):
    page, services, policy, root = env
    policy.reply = {"version": "v1", "values": {"outbound.allow_external": True}}
    page.goto(_link(root))
    _ready(page)
    assert page.locator(f"{GS} .gs-links__focus a").count() >= 8

    # the administrator switches external hosts off; this tab has not heard of it
    policy.reply = {"version": "v2", "values": {"outbound.allow_external": False}}
    reads = policy.reads
    page.click(f"{GS} .gs-run")
    until(page, "() => /turned off by the administrator/.test(document.querySelector('.tile[data-tile-id=\"gene-set-G\"] .gs-bar__text')?.textContent || '')")
    assert policy.reads > reads, "the Run read the policy"
    assert "nothing was sent" in bar(page)
    page.wait_for_timeout(1000)
    assert services.calls == [], services.calls
    assert page.locator(f"{GS} .gs-consent:not([hidden])").count() == 0
    # the Links section is gone with the switch
    assert page.locator(f"{GS} .gs-links__focus").count() == 0
