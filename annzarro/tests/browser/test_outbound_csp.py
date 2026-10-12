"""The Content-Security-Policy stops a script, not just the UI (slice P1).

A server whose configuration leaves one gene-set service off: a fetch to that
service's host from the page's console is refused by the browser with a CSP
violation and no request leaves, while an allowed service's host is reached
(a positive control, so the block is not a broken test). The app's own
``data:`` and ``blob:`` fetches (plot export) raise no violation.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import os

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_memory_guard import _serve  # noqa: E402

ALLOWED = "https://mygene.info/v3/gene/7157"
BLOCKED = "https://biit.cs.ut.ee/gprofiler/api/gost/profile/"

FORCED_FETCH = """async (url) => {
    const violations = [];
    document.addEventListener('securitypolicyviolation', e => violations.push(
        { directive: e.effectiveDirective, blocked: e.blockedURI }));
    let outcome;
    try {
        const r = await fetch(url, { mode: 'cors', credentials: 'omit' });
        outcome = 'status ' + r.status;
    } catch (e) {
        outcome = 'rejected';
    }
    await new Promise(r => setTimeout(r, 100));
    return { outcome, violations };
}"""


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    root, proc = _serve(tmp_path_factory, 'integrations:\n  gene_set:\n    services: ["mygene", "string"]\n')
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
def page(browser):
    context = browser.new_context()
    page = context.new_page()
    yield page
    context.close()


def stub_external(page, reached):
    def handle(route):
        host = route.request.url.split("/")[2]
        if host.startswith("127.0.0.1"):
            return route.continue_()
        reached.append(route.request.url)
        return route.fulfill(status=200, body="{}", headers={"Content-Type": "application/json",
                                                             "Access-Control-Allow-Origin": "*"})
    page.route("**/*", handle)


def test_the_page_carries_the_hosts_of_the_allowed_services_only(page, server):
    response = page.goto(server + "/")
    csp = response.headers["content-security-policy"]
    assert csp.startswith("connect-src 'self' data: blob:")
    assert "https://mygene.info" in csp and "https://version-12-5.string-db.org" in csp
    assert "biit.cs.ut.ee" not in csp and "maayanlab.cloud" not in csp


def test_a_forced_fetch_to_a_disabled_service_is_blocked_by_the_csp(page, server):
    reached = []
    stub_external(page, reached)
    page.goto(server + "/")
    page.wait_for_function("() => !!window.PanelManager", timeout=30000)

    allowed = page.evaluate(FORCED_FETCH, ALLOWED)
    assert allowed["outcome"] == "status 200" and allowed["violations"] == []
    assert reached == [ALLOWED]

    blocked = page.evaluate(FORCED_FETCH, BLOCKED)
    assert blocked["outcome"] == "rejected"
    assert [v["directive"] for v in blocked["violations"]] == ["connect-src"]
    assert "biit.cs.ut.ee" in blocked["violations"][0]["blocked"]
    assert reached == [ALLOWED], "nothing left the browser for the disabled service"


def test_the_apps_own_data_and_blob_fetches_are_allowed(page, server):
    page.goto(server + "/")
    page.wait_for_function("() => !!window.PanelManager", timeout=30000)
    got = page.evaluate("""async () => {
        const violations = [];
        document.addEventListener('securitypolicyviolation', e => violations.push(e.effectiveDirective));
        const d = await (await fetch('data:text/plain,hello')).text();
        const b = await (await fetch(URL.createObjectURL(new Blob(['blob'])))).text();
        return { d, b, violations };
    }""")
    assert got == {"d": "hello", "b": "blob", "violations": []}
