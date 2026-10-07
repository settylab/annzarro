"""The Gene Set Analysis panel in a real browser, every external service mocked.

Headless Chromium on the committed 200-cell fixture (genes GENE000-GENE019):
a Gene Table searched for "GENE00" (10 genes) and a Gene Set Analysis panel
following it. Every request that does not go to the local server is
recorded; the known services (STRING, g:Profiler, MyGene.info, the Human
Protein Atlas, Enrichr, Reactome) answer from the replies recorded in
annzarro/tests/js/gene-set-fixtures/, anything else is aborted and fails
the test. A page error fails the test.

1. Opening a link with the panel makes no external request: the bar says
   "Not run yet", the Links show the focused gene, safely.
2. Run asks first (external_requests: ask), Send fetches the visible
   sections; the strips say what each service did not know; the network is a
   blob: image.
3. A changed selection makes the panel stale without a request; Refresh
   fetches each visible section once.
4. Auto-update: five selection changes in half a second make one refresh.
5. A hidden section is not fetched; shown again, it fetches.
6. A failing service (no connection, then 503) fails its section only, with
   Retry; the table still works; Retry fetches it.
7. Clicking a gene in the table moves the Links to it.
8. The saved config has only the panel's settings; reopened, nothing is
   fetched.
9. external_requests: off: Run sends nothing, the Links work.
10. A closed source table: its frozen selection is used; one restored closed
    (no selection) is said to be unknown.
11. With cross-origin isolation on, the network image still shows (blob:).
12. Species: a local name, a typed taxonomy id, and NCBI Taxonomy's
    suggestions only when asked for (mocked); a new species makes the panel
    stale.
13. Offline: Run sends nothing and says why; the Links still work.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import base64
import json
import os
import re
import urllib.parse

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests.browser.test_memory_guard import STORE, _serve  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(os.path.dirname(HERE), "js", "gene-set-fixtures")
GS = '.tile[data-tile-id="gene-set-G"]'
TABLE = '.tile[data-tile-id="gene-table-A"]'

# service endpoint (regex on the URL) -> recorded reply
REPLIES = [
    ("string-ids", r"string-db\.org/api/json/get_string_ids$", "string-get_string_ids.json", "application/json"),
    ("string-enrichment", r"string-db\.org/api/json/enrichment$", "string-enrichment.json", "application/json"),
    ("string-ppi", r"string-db\.org/api/json/ppi_enrichment$", "string-ppi_enrichment.json", "application/json"),
    ("string-svg", r"string-db\.org/api/svg/network$", "string-network.svg", "image/svg+xml"),
    ("string-partners", r"string-db\.org/api/json/interaction_partners$", "string-interaction_partners.json", "application/json"),
    ("gprofiler", r"biit\.cs\.ut\.ee/gprofiler/api/gost/profile/$", "gprofiler-profile.json", "application/json"),
    ("mygene-card", r"mygene\.info/v3/query\?", "mygene-card.json", "application/json"),
    ("mygene-lookup", r"mygene\.info/v3/query$", None, "application/json"),
    ("hpa", r"proteinatlas\.org/api/search_download\.php", "hpa-search.json", "application/json"),
    ("enrichr-add", r"maayanlab\.cloud/Enrichr/addList$", "enrichr-addList.json", "application/json"),
    ("enrichr", r"maayanlab\.cloud/Enrichr/enrich\?", "enrichr-enrich.json", "application/json"),
    ("reactome", r"reactome\.org/AnalysisService/identifiers/projection", "reactome-projection.json", "application/json"),
    ("ncbi-taxon", r"api\.ncbi\.nlm\.nih\.gov/datasets/v2/taxonomy/taxon_suggest/", "ncbi-taxon_suggest.json", "application/json"),
]


def _read(name):
    with open(os.path.join(FIX, name), "rb") as fh:
        return fh.read()


class Services:
    """Every non-local request: answered from a recording, failed on purpose, or recorded as unmocked."""

    def __init__(self, root):
        self.root = root
        self.calls = []        # (endpoint, method, url)
        self.unmocked = []
        self.fail = {}         # endpoint -> list of outcomes to use first: 'timedout', 'net', 'blocked', 503, ...
        self.probes = []       # the panel's no-cors checks of a failed host's root
        self.hosts_answer = set()  # hosts whose root answers that check
        self.bodies = {}       # endpoint -> reply body to use instead of the recording

    def handle(self, route):
        req = route.request
        url = req.url
        if url.startswith(self.root) or url.startswith(("data:", "blob:")):
            return route.continue_()
        root = re.match(r"^https://([^/]+)/$", url)
        if root:
            self.probes.append(root.group(1))
            if root.group(1) in self.hosts_answer:
                return route.fulfill(status=200, body="")
            return route.abort("internetdisconnected")
        for endpoint, pattern, name, ctype in REPLIES:
            if re.search(pattern, url):
                self.calls.append((endpoint, req.method, url))
                queued = self.fail.get(endpoint)
                if queued:
                    outcome = queued.pop(0)
                    if outcome == "timedout":
                        return route.abort("timedout")
                    if outcome == "net":
                        return route.abort("internetdisconnected")
                    if outcome == "blocked":
                        # the browser keeps the request from the page (as for a missing CORS
                        # header or an extension): fetch fails, the host itself answers
                        return route.abort("blockedbyclient")
                    return route.fulfill(status=outcome, body="", headers={"Access-Control-Allow-Origin": "*"})
                if endpoint in self.bodies:
                    return route.fulfill(status=200, body=self.bodies[endpoint],
                                         headers={"Content-Type": ctype, "Access-Control-Allow-Origin": "*"})
                if endpoint == "mygene-lookup":
                    name = "mygene-query-alias.json" if "scopes=alias" in (req.post_data or "") else "mygene-query-symbol.json"
                return route.fulfill(status=200, body=_read(name), headers={"Content-Type": ctype, "Access-Control-Allow-Origin": "*"})
        self.unmocked.append(url)
        return route.abort()

    def count(self, endpoint=None):
        return len([c for c in self.calls if endpoint is None or c[0] == endpoint])

    def counts(self):
        out = {}
        for endpoint, _, _ in self.calls:
            out[endpoint] = out.get(endpoint, 0) + 1
        return out


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


def _open(browser, root):
    context = browser.new_context(viewport={"width": 1500, "height": 1100})
    page = context.new_page()
    services = Services(root)
    page.route("**/*", services.handle)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    return context, page, services, errors


@pytest.fixture
def env(browser, server):
    context, page, services, errors = _open(browser, server)
    yield page, services, server
    assert not errors, errors
    assert not services.unmocked, f"unmocked external requests: {services.unmocked}"
    context.close()


def _link(root, gs=None, search="GENE00", focus="GENE003", table_open=True, taxonomy="9606", with_panel=True):
    cfgs = {
        "gene-table-A": {"id": "gene-table-A", "title": "Gene Table 1", "searchText": search,
                         "columns": [{"type": "var", "key": "gene_name", "column": ""}]},
        "gene-set-G": {"id": "gene-set-G", "title": "Gene Set Analysis 1", "tableFilter": "gene-table-A", **(gs or {})},
    }
    tiles = [{"type": "tile", "id": "gene-set-G"}] if with_panel else []
    if not with_panel:
        del cfgs["gene-set-G"]
    if table_open:
        tiles.insert(0, {"type": "tile", "id": "gene-table-A"})
    hierarchy = tiles if len(tiles) == 1 else [{"type": "split", "direction": "horizontal", "height": 1000,
                                                "panes": [{"percentage": 35}, {"percentage": 65}], "children": tiles}]
    view = {"v": 1, "constants": {"focusedGene": focus, "taxonomyId": taxonomy},
            "layout": {"v": 1, "hierarchy": hierarchy, "controlState": {}, "panelConfigs": cfgs}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={enc}"


def until(page, js, arg=None, timeout=30.0):
    """Poll with page.wait_for_timeout (not time.sleep: route handlers run only while Playwright waits)."""
    steps = int(timeout * 10)
    for _ in range(steps):
        value = page.evaluate(js, arg)
        if value:
            return value
        page.wait_for_timeout(100)
    raise AssertionError(f"timed out waiting for: {js[:160]}")


STATE = "() => window.PanelManager.getPanel('gene-set-G')._debugState()"


def state(page):
    return page.evaluate(STATE)


def runs(page):
    return {k: v["status"] for k, v in state(page)["runs"].items()}


def bar(page):
    return " ".join(page.inner_text(f"{GS} .gs-bar__text").split())


VISIBLE = ["mygene-card", "string-enrichment", "gprofiler-gost", "string-network", "mygene-mapping"]
# MyGene's recorded lookup is of TP53 etc., none of the fixture's GENE ids: that section's
# answer is "none found" (an error of kind unmapped), which counts as settled here
SETTLED_KINDS = ["unmapped"]


def _ready(page):
    page.wait_for_selector(f"{TABLE} .dataTables_scrollBody tbody tr", timeout=30000)
    until(page, "() => { const p = window.PanelManager.getPanel('gene-set-G'); return p && p._debugState().source.status === 'open' && p._debugState().source.count > 0; }")


def _all_ok(page, ids=VISIBLE):
    """Every section in `ids` answered: ok, or (MyGene's lookup here) knew none of the genes."""
    until(page, f"() => {{ const r = window.PanelManager.getPanel('gene-set-G')._debugState().runs; "
                f"return {json.dumps(ids)}.every(id => r[id].status === 'ok' || "
                f"(r[id].status === 'error' && {json.dumps(SETTLED_KINDS)}.includes(r[id].error.kind))); }}")


def _run_and_send(page):
    page.click(f"{GS} .gs-run")
    page.wait_for_selector(f"{GS} .gs-consent:not([hidden])")
    page.click(f"{GS} .gs-consent button:has-text('Send')")
    _all_ok(page)


def _search(page, text):
    page.fill(f'{TABLE} input[type="search"]', text)


def test_opening_makes_no_request_and_links_are_safe(env):
    page, services, root = env
    page.goto(_link(root))
    _ready(page)
    page.wait_for_timeout(1500)
    assert services.calls == [], services.calls
    s = state(page)
    assert s["gate"] is None and s["snapshot"] is None and s["armed"] is False
    assert all(r == "idle" for r in runs(page).values())
    assert bar(page).startswith("Not run yet. Run sends 10 gene ids to")
    links = page.locator(f'{GS} .gs-links__focus a')
    assert " ".join(page.inner_text(f"{GS} .gs-links__focus .gs-links__title").split()).startswith("Focused gene GENE003")
    assert links.count() >= 8
    for i in range(links.count()):
        a = links.nth(i)
        assert a.get_attribute("href").startswith("https://")
        assert a.get_attribute("target") == "_blank"
        assert "noopener" in a.get_attribute("rel")
        assert a.get_attribute("referrerpolicy") == "no-referrer"
        assert "opens in a new tab" in a.get_attribute("aria-label")
    ncbi = page.get_attribute(f'{GS} .gs-links__focus a:has-text("NCBI Gene")', "href")
    assert ncbi == "https://www.ncbi.nlm.nih.gov/gene/?term=GENE003%5Bsym%5D%20AND%209606%5Btaxid%5D"
    # hidden sections say so; nothing was fetched for them
    assert "hidden, not fetched" in page.inner_text(f'{GS} .gs-section[data-section="enrichr"] .gs-badge')


def test_run_asks_then_fetches_and_states_coverage(env):
    page, services, root = env
    page.goto(_link(root))
    _ready(page)
    page.click(f"{GS} .gs-run")
    page.wait_for_selector(f"{GS} .gs-consent:not([hidden])")
    consent = page.inner_text(f"{GS} .gs-consent")
    # the one request beyond those listed is named before anything is sent
    assert "asks that service once for its home page (a bare GET, nothing of yours in it)" in " ".join(consent.split())
    for host in ("version-12-5.string-db.org", "biit.cs.ut.ee", "mygene.info"):
        assert host in consent
    assert services.calls == [], "nothing before the answer"
    page.click(f"{GS} .gs-consent button:has-text('Send')")
    _all_ok(page)
    counts = services.counts()
    # the selection, and the dataset's 20 genes as the default background: each mapped once,
    # shared by STRING's sections
    assert counts["string-ids"] == 2, counts
    assert counts["gprofiler"] == 1
    assert all(c[1] == "POST" for c in services.calls if c[0] != "mygene-card")
    for _, _, url in services.calls:
        assert "GENE00" not in url or url.startswith("https://mygene.info/v3/query?q=symbol"), f"a gene list in a URL: {url}"
    # what each service did not know is stated in its section's strip
    strip = page.get_attribute(f'{GS} .gs-section[data-section="string-enrichment"] .plot-status', "data-summary")
    assert strip.startswith("5 of 10 genes shown"), strip
    assert "STRING: not found by the service (5 genes)" in strip
    gp = page.get_attribute(f'{GS} .gs-section[data-section="gprofiler-gost"] .plot-status', "data-summary")
    assert gp.startswith("9 of 10 genes shown"), gp
    src = page.get_attribute(f'{GS} .gs-section[data-section="string-network"] img.gs-image', "src")
    assert src.startswith("blob:")
    alt = page.get_attribute(f'{GS} .gs-section[data-section="string-network"] img.gs-image', "alt")
    assert re.match(r"STRING network, 5 genes, \d+ interactions", alt)
    assert bar(page).startswith('✓ Results for 10 genes from "Gene Table 1" · Homo sapiens')
    # the term named as HTML is text
    page.click(f'{GS} .gs-section[data-section="string-enrichment"] button:has-text("Show all")')
    assert "<img src=x onerror=alert(1)>" in page.inner_text(f'{GS} .gs-section[data-section="string-enrichment"]')
    # the gene card's ids make the focused gene's links direct
    assert page.get_attribute(f'{GS} .gs-links__focus a:has-text("NCBI Gene")', "href") == "https://www.ncbi.nlm.nih.gov/gene/7157"


def test_a_changed_selection_is_stale_without_a_request_and_refresh_fetches_once(env):
    page, services, root = env
    page.goto(_link(root))
    _ready(page)
    _run_and_send(page)
    before = len(services.calls)
    _search(page, "GENE01")
    until(page, "() => /Selection changed/.test(document.querySelector('%s .gs-bar__text').textContent)" % GS)
    assert 'Selection changed: "Gene Table 1" now has 10 genes; results are for 10' in bar(page)
    page.wait_for_timeout(1200)
    assert len(services.calls) == before, "auto-update is off: nothing is fetched"
    for sid in ("string-enrichment", "gprofiler-gost", "string-network", "mygene-mapping"):
        assert "stale" in page.inner_text(f'{GS} .gs-section[data-section="{sid}"] .gs-badge'), sid
        assert "gs-section--stale" in page.get_attribute(f'{GS} .gs-section[data-section="{sid}"]', "class")
    page.click(f'{GS} .gs-bar__actions button:has-text("Refresh")')
    _all_ok(page)
    until(page, "() => /^✓ Results for 10 genes/.test(document.querySelector('%s .gs-bar__text').textContent)"
          " && window.PanelManager.getPanel('gene-set-G')._debugState().stale === null" % GS)
    new = {}
    for endpoint, _, _ in services.calls[before:]:
        new[endpoint] = new.get(endpoint, 0) + 1
    # each set section once (MyGene's lookup is two: symbols, then the misses as aliases); the
    # dataset background is mapped once a page, not again; the focused gene did not change,
    # so its card is not asked again
    assert new == {"string-ids": 1, "string-enrichment": 1, "string-ppi": 1, "string-svg": 1, "gprofiler": 1, "mygene-lookup": 2}, new


def test_auto_update_makes_one_refresh_for_a_burst_of_changes(env):
    page, services, root = env
    page.goto(_link(root))
    _ready(page)
    _run_and_send(page)
    page.click(f"{GS} .gs-auto")
    assert page.get_attribute(f"{GS} .gs-auto", "aria-pressed") == "true"
    page.wait_for_timeout(500)
    before = len(services.calls)
    for text in ("GENE01", "GENE0", "GENE1", "GENE00", "GENE01"):
        _search(page, text)
        page.wait_for_timeout(90)
    until(page, "() => /^✓ Results for 10 genes/.test(document.querySelector('%s .gs-bar__text').textContent)"
          " && window.PanelManager.getPanel('gene-set-G')._debugState().stale === null" % GS)
    _all_ok(page)
    page.wait_for_timeout(1500)
    new = {}
    for endpoint, _, _ in services.calls[before:]:
        new[endpoint] = new.get(endpoint, 0) + 1
    assert new == {"string-ids": 1, "string-enrichment": 1, "string-ppi": 1, "string-svg": 1, "gprofiler": 1, "mygene-lookup": 2}, new


def test_a_hidden_section_is_not_fetched_and_fetches_when_shown(env):
    page, services, root = env
    page.goto(_link(root))
    _ready(page)
    _run_and_send(page)
    page.click(f'{GS} .gs-section[data-section="string-network"] .gs-section__toggle')
    assert page.get_attribute(f'{GS} .gs-section[data-section="string-network"] .gs-section__toggle', "aria-expanded") == "false"
    _search(page, "GENE0")
    until(page, "() => /Selection changed/.test(document.querySelector('%s .gs-bar__text').textContent)" % GS)
    before = len(services.calls)
    page.click(f'{GS} .gs-bar__actions button:has-text("Refresh")')
    _all_ok(page, ["string-enrichment", "gprofiler-gost", "mygene-mapping"])
    page.wait_for_timeout(1500)
    endpoints = [c[0] for c in services.calls[before:]]
    assert "string-svg" not in endpoints and "string-ppi" not in endpoints, endpoints
    # shown again (through the Sections menu): it fetches, for the current snapshot
    page.click(f"{GS} .gs-sections-btn")
    page.click(f'{GS} .gs-menu [data-section="string-network"]')
    _all_ok(page, ["string-network"])
    endpoints = [c[0] for c in services.calls[before:]]
    assert endpoints.count("string-svg") == 1 and endpoints.count("string-ppi") == 1


def test_a_failing_service_fails_its_section_only(env):
    page, services, root = env
    page.goto(_link(root))
    _ready(page)
    services.fail["string-enrichment"] = ["timedout", 503]
    page.click(f"{GS} .gs-run")
    page.wait_for_selector(f"{GS} .gs-consent:not([hidden])")
    page.click(f"{GS} .gs-consent button:has-text('Send')")
    until(page, "() => window.PanelManager.getPanel('gene-set-G')._debugState().runs['string-enrichment'].status === 'error'")
    _all_ok(page, ["string-network", "gprofiler-gost", "mygene-mapping", "mygene-card"])
    s = state(page)["runs"]["string-enrichment"]
    assert s["error"]["kind"] == "down" and s["error"]["status"] == 503 and s["error"]["attempts"] == 2, s
    section = f'{GS} .gs-section[data-section="string-enrichment"]'
    text = page.inner_text(section)
    assert "Could not get enrichment from STRING. Other sections are not affected." in text
    assert "HTTP 503" in text and "2 attempts" in text
    assert page.locator(f"{section} .coverage-placeholder--error").count() == 1
    # the table still filters while the section is failed
    _search(page, "GENE01")
    page.wait_for_selector(f'{TABLE} td:has-text("GENE015")')
    _search(page, "GENE00")
    page.wait_for_selector(f'{TABLE} td:has-text("GENE005")')
    page.click(f'{section} .gs-placeholder-do button:has-text("Retry")')
    _all_ok(page, ["string-enrichment"])
    assert services.count("string-enrichment") == 3


def test_each_failure_is_named_and_offers_retry(env):
    """No connection (route abort), a request the browser blocks while its
    host answers, and a 404 that is not STRING's "no matches": each section says
    which happened, offers Retry, and none calls it "not found"."""
    page, services, root = env
    page.goto(_link(root))
    _ready(page)
    services.fail["string-enrichment"] = ["net", "net"]
    services.fail["gprofiler"] = ["blocked"]
    services.hosts_answer.add("biit.cs.ut.ee")
    services.fail["mygene-card"] = [404]
    page.click(f"{GS} .gs-run")
    page.wait_for_selector(f"{GS} .gs-consent:not([hidden])")
    page.click(f"{GS} .gs-consent button:has-text('Send')")
    for sid in ("string-enrichment", "gprofiler-gost", "mygene-card"):
        until(page, f"() => window.PanelManager.getPanel('gene-set-G')._debugState().runs['{sid}'].status === 'error'")
    runs_ = state(page)["runs"]
    assert runs_["string-enrichment"]["error"]["kind"] == "unreachable", runs_["string-enrichment"]
    assert runs_["string-enrichment"]["error"]["attempts"] == 2
    assert runs_["gprofiler-gost"]["error"]["kind"] == "blocked", runs_["gprofiler-gost"]
    assert runs_["mygene-card"]["error"]["kind"] == "endpoint", runs_["mygene-card"]
    said = {
        "string-enrichment": "could not connect to version-12-5.string-db.org: no network, the address did not resolve, "
                             "or the service is down",
        "gprofiler-gost": "biit.cs.ut.ee answered, but the browser blocked its reply: the service does not allow "
                          "requests from this page (CORS)",
        "mygene-card": "mygene.info has no such address (HTTP 404)",
    }
    for sid, text in said.items():
        section = f'{GS} .gs-section[data-section="{sid}"]'
        shown = " ".join(page.inner_text(section).split())
        assert text in shown, shown
        assert "knows none" not in shown and "not found" not in shown.lower(), shown
        assert page.locator(f'{section} .gs-placeholder-do button:has-text("Retry")').count() == 1
    assert "version-12-5.string-db.org" in services.probes and "biit.cs.ut.ee" in services.probes
    # Retry, with the network back: the section fetches and shows its result
    page.click(f'{GS} .gs-section[data-section="string-enrichment"] .gs-placeholder-do button:has-text("Retry")')
    _all_ok(page, ["string-enrichment"])


def test_clicking_a_gene_moves_the_links(env):
    page, services, root = env
    page.goto(_link(root))
    _ready(page)
    page.click(f'{TABLE} .entity-index-value:has-text("GENE007")')
    until(page, "() => /GENE007/.test(document.querySelector('%s .gs-links__focus').textContent)" % GS)
    href = page.get_attribute(f'{GS} .gs-links__focus a:has-text("GeneCards")', "href")
    assert href == "https://www.genecards.org/cgi-bin/carddisp.pl?gene=GENE007"
    # the list of the selection: a gene there is a button that focuses it
    page.click(f'{GS} .gs-links__list button:has-text("Show list")')
    page.click(f'{GS} .gs-links__table button[aria-label="Focus GENE002"]')
    until(page, "() => /GENE002/.test(document.querySelector('%s .gs-links__focus').textContent)" % GS)
    assert page.locator(f'{GS} .gs-links__table tbody tr').count() == 10
    assert services.calls == []


def test_the_saved_config_holds_settings_only_and_reopens_without_a_request(env, browser):
    page, services, root = env
    page.goto(_link(root, gs={"sections": {"string-network": {"visible": False, "params": {}}}}))
    _ready(page)
    saved = page.evaluate("() => window.PanelManager.saveLayout()")
    cfg = saved["panelConfigs"]["gene-set-G"]
    assert set(cfg) <= {"id", "title", "tableFilter", "idColumn", "idType", "consent", "autoUpdate", "sections",
                        "sectionOrder", "links", "controlsVisible"}, set(cfg)
    assert "consent" not in cfg, "nothing was agreed to, so the link carries no consent"
    assert cfg["tableFilter"] == "gene-table-A"
    assert cfg["sections"]["string-network"]["visible"] is False
    assert len(json.dumps(cfg)) < 1024
    view = {"v": 1, "constants": {"focusedGene": "GENE003", "taxonomyId": "9606"}, "layout": saved}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    page.goto("about:blank")
    page.goto(f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={enc}")
    _ready(page)
    page.wait_for_timeout(1500)
    s = state(page)
    assert s["settings"]["sections"]["string-network"]["visible"] is False
    assert all(r == "idle" for r in runs(page).values())
    assert services.calls == []


def test_a_closed_source_uses_its_frozen_selection(env):
    page, services, root = env
    page.goto(_link(root))
    _ready(page)
    page.evaluate("() => window.PanelManager.closePanel('gene-table-A')")
    until(page, "() => window.PanelManager.getPanel('gene-set-G')._debugState().source.status === 'closed'")
    assert "source table closed" in bar(page)
    assert page.locator(f'{GS} .gs-bar__actions button:has-text("Reopen table")').count() == 1
    assert state(page)["source"]["count"] == 10
    page.click(f"{GS} .gs-run")
    page.click(f"{GS} .gs-consent button:has-text('Send')")
    _all_ok(page)
    assert state(page)["snapshot"]["count"] == 10
    # a table restored closed from a panel set has no selection: said so, nothing sent
    page.evaluate("""() => {
        window.PanelManager.registerClosedPanel('gene-table', {id: 'gene-table-Z', title: 'Restored closed'});
        window.PanelManager.updateSourcePanelSelection();
    }""")
    page.select_option(f"{GS} #gs-source-gene-set-G", "gene-table-Z")
    until(page, "() => window.PanelManager.getPanel('gene-set-G')._debugState().gate === 'closed-unknown'")
    assert 'Source table "Restored closed" is closed and its selection is not known; reopen it.' in bar(page)


@pytest.fixture(scope="module")
def off_server(tmp_path_factory):
    root, proc = _serve(tmp_path_factory, 'integrations:\n  external_requests: "off"\n')
    yield root
    proc.terminate()
    proc.wait(10)


def test_external_requests_off_sends_nothing_and_links_work(browser, off_server):
    context, page, services, errors = _open(browser, off_server)
    try:
        page.goto(_link(off_server))
        _ready(page)
        assert "External services are turned off on this server" in bar(page)
        page.click(f"{GS} .gs-run")
        page.wait_for_timeout(1000)
        placeholder = page.inner_text(f'{GS} .gs-section[data-section="string-enrichment"] .coverage-placeholder')
        assert "External services are turned off on this server; the Links section still works." in placeholder
        assert page.locator(f"{GS} .gs-consent:not([hidden])").count() == 0
        assert page.locator(f'{GS} .gs-links__focus a').count() >= 8
        # the species search offers no remote lookup either
        page.fill(f"{GS} #gs-species-gene-set-G", "zebra")
        page.wait_for_timeout(400)
        assert "Search NCBI" not in page.inner_text(f"{GS} .gs-species")
        assert services.calls == [] and services.unmocked == []
        assert not errors, errors
    finally:
        context.close()


@pytest.fixture(scope="module")
def coep_server(tmp_path_factory):
    root, proc = _serve(tmp_path_factory, 'server:\n  cross_origin_isolation: "on"\n')
    yield root
    proc.terminate()
    proc.wait(10)


def test_cross_origin_isolation_keeps_the_network_image(browser, coep_server):
    context, page, services, errors = _open(browser, coep_server)
    console = []
    page.on("console", lambda m: console.append(m.text) if m.type == "error" else None)
    try:
        page.goto(_link(coep_server))
        _ready(page)
        assert page.evaluate("() => self.crossOriginIsolated") is True
        _run_and_send(page)
        img = f'{GS} .gs-section[data-section="string-network"] img.gs-image'
        assert page.get_attribute(img, "src").startswith("blob:")
        until(page, "(sel) => { const i = document.querySelector(sel); return i && i.complete && i.naturalWidth > 0; }", img)
        assert not [c for c in console if "Cross-Origin" in c or "COEP" in c or "blocked" in c.lower()], console
        assert not errors and not services.unmocked
    finally:
        context.close()


def test_species_from_the_picker_makes_the_panel_stale(env):
    page, services, root = env
    page.goto(_link(root))
    _ready(page)
    _run_and_send(page)
    species = f"{GS} #gs-species-gene-set-G"
    page.click(species)
    page.fill(species, "mouse")
    page.wait_for_selector(f'{GS} .name-picker-option:has-text("Mus musculus")')
    page.click(f'{GS} .name-picker-option:has-text("Mus musculus")')
    until(page, "() => /Species changed to Mus musculus/.test(document.querySelector('%s .gs-bar__text').textContent)" % GS)
    assert page.evaluate("async () => (await import('/static/js/data-manager.js')).DataManager.getTaxonomyId()") == "10090"
    # human-only links are gone for mouse; MGI is there
    labels = page.locator(f"{GS} .gs-links__focus a").all_inner_texts()
    assert "MGI" in labels and "GeneCards" not in labels and "HPA" not in labels
    # a taxonomy id typed directly
    page.click(species)
    page.fill(species, "7955")
    page.wait_for_selector(f'{GS} .name-picker-option:has-text("Danio rerio")')
    page.keyboard.press("Enter")
    until(page, "async () => (await import('/static/js/data-manager.js')).DataManager.getTaxonomyId() === '7955'")
    assert services.counts().get("mygene-card", 0) == 1, "no request while picking"


def test_a_species_from_ncbi_only_when_asked(env):
    page, services, root = env
    page.goto(_link(root))
    _ready(page)
    species = f"{GS} #gs-species-gene-set-G"
    page.click(species)
    page.fill(species, "zebraf")
    page.wait_for_selector(f'{GS} .name-picker-option:has-text("Search NCBI Taxonomy")')
    assert services.calls == [], "typing sends nothing"
    page.click(f'{GS} .name-picker-option:has-text("Search NCBI Taxonomy")')
    # NCBI's answer: a name only it knows is listed
    page.wait_for_selector(f'{GS} .name-picker-option:has-text("Zebrafish picornavirus 1 · 2563826")')
    assert services.count("ncbi-taxon") == 1
    assert services.calls[0][2].endswith("/taxon_suggest/zebraf")
    page.click(f'{GS} .name-picker-option:has-text("Danio rerio (zebrafish) · 7955")')
    until(page, "async () => (await import('/static/js/data-manager.js')).DataManager.getTaxonomyId() === '7955'")
    labels = page.locator(f"{GS} .gs-links__focus a").all_inner_texts()
    assert "ZFIN" not in labels, "no ZFIN link without a ZFIN id"
    assert "NCBI Gene" in labels and "Alliance" in labels


def test_offline_sends_nothing_and_links_work(env):
    page, services, root = env
    page.goto(_link(root))
    _ready(page)
    page.context.set_offline(True)
    until(page, "() => navigator.onLine === false")
    page.click(f"{GS} .gs-run")
    page.wait_for_timeout(800)
    assert page.locator(f"{GS} .gs-consent:not([hidden])").count() == 0
    placeholder = page.inner_text(f'{GS} .gs-section[data-section="string-enrichment"] .coverage-placeholder')
    assert "This browser is offline. Links still work" in placeholder
    assert "This browser is offline" in bar(page)
    assert page.locator(f"{GS} .gs-links__focus a").count() >= 8
    assert services.calls == []
    page.context.set_offline(False)


# --------------------------------------------------------------------------- APPROVALS Y3

def _link_without_table(root, gs=None):
    view = {"v": 1, "constants": {"focusedGene": "GENE003", "taxonomyId": "9606"},
            "layout": {"v": 1, "hierarchy": [{"type": "tile", "id": "gene-set-G"}], "controlState": {},
                       "panelConfigs": {"gene-set-G": {"id": "gene-set-G", "title": "Gene Set Analysis 1", **(gs or {})}}}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(STORE, safe='/')}#view={enc}"


def test_no_gene_table_says_so_and_binds_to_the_first_one_made(env):
    page, services, root = env
    page.goto(_link_without_table(root))
    until(page, "() => !!window.PanelManager.getPanel('gene-set-G')")
    until(page, "() => /No gene table yet/.test(document.querySelector('%s .gs-bar__text').textContent)" % GS)
    assert "Create New Panel" in bar(page) and "Gene Table" in bar(page)
    assert page.inner_text(f"{GS} #gs-source-gene-set-G") == "No gene table yet"
    assert page.is_disabled(f"{GS} #gs-source-gene-set-G")
    page.evaluate("""() => window.PanelManager.createPanelInLayout('gene-table', {id: 'gene-table-N', title: 'New genes',
        searchText: 'GENE00', columns: [{type: 'var', key: 'gene_name', column: ''}]})""")
    until(page, "() => { const s = window.PanelManager.getPanel('gene-set-G')._debugState(); "
                "return s.settings.tableFilter === 'gene-table-N' && s.source.status === 'open' && s.source.count === 10; }")
    assert bar(page).startswith("Not run yet. Run sends 10 gene ids")
    assert services.calls == []


def test_the_id_column_is_found_and_its_type_can_be_switched(env):
    page, services, root = env
    page.goto(_link(root))
    _ready(page)
    s = state(page)
    assert s["settings"]["idColumn"] == "auto" and s["idColumn"] == "gene_name", "gene_name found in var"
    assert s["idType"] == "symbol"
    assert page.inner_text(f'{GS} #gs-ids-gene-set-G option[value="auto"]') == "Auto: gene_name"
    assert page.inner_text(f'{GS} #gs-idtype-gene-set-G option[value="auto"]') == "Auto: gene names (symbols)"
    _run_and_send(page)
    # read as Entrez ids: stale, and g:Profiler is then told the namespace
    page.select_option(f"{GS} #gs-idtype-gene-set-G", "entrez")
    until(page, "() => /IDs changed to gene_name as Entrez ids/.test(document.querySelector('%s .gs-bar__text').textContent)" % GS)
    before = len(services.calls)
    page.click(f'{GS} .gs-bar__actions button:has-text("Refresh")')
    until(page, "() => window.PanelManager.getPanel('gene-set-G')._debugState().runs['gprofiler-gost'].status !== 'loading'"
                " && window.PanelManager.getPanel('gene-set-G')._debugState().stale === null")
    _all_ok(page, ["gprofiler-gost"])
    gp = [c for c in services.calls[before:] if c[0] == "gprofiler"]
    assert len(gp) == 1
    # both settings are saved
    cfg = page.evaluate("() => window.PanelManager.getPanel('gene-set-G').getConfig()")
    assert cfg["idType"] == "entrez" and cfg["idColumn"] == "auto"
    page.select_option(f"{GS} #gs-ids-gene-set-G", "_index")
    until(page, "() => window.PanelManager.getPanel('gene-set-G').getConfig().idColumn === '_index'")


def test_gprofiler_is_told_the_entrez_namespace(env):
    page, services, root = env
    bodies = []
    page.on("request", lambda r: bodies.append(r.post_data) if "gost/profile" in r.url else None)
    page.goto(_link(root, gs={"idType": "entrez"}))
    _ready(page)
    _run_and_send(page)
    assert bodies and all('"numeric_namespace":"ENTREZGENE_ACC"' in (b or "").replace(" ", "") for b in bodies), bodies


def test_over_the_limit_is_not_sent_until_try_anyway_and_the_refusal_is_shown(env):
    page, services, root = env
    page.goto(_link(root, with_panel=False))
    page.wait_for_selector(f"{TABLE} .dataTables_scrollBody tbody tr", timeout=30000)
    # a section that takes at most 5 genes, registered before the panel is made
    page.evaluate("""async () => {
        const r = await import('/static/js/panels/gene-set-utilities/registry.js');
        r.registerAdapter({ id: 'test-limit', version: '1', label: 'Small', kind: 'set', defaultVisible: true,
            provider: { name: 'STRING', host: 'string-db.org', home: 'https://string-db.org' },
            hostsFor: () => ['version-12-5.string-db.org'],
            limits: { minGenes: 1, maxGenes: 5 }, supportsSpecies: () => 'unknown',
            async fetch(input, io) { return io.fetchJson('https://version-12-5.string-db.org/api/json/too_large', { form: { identifiers: input.genes.join('\\r') } }); },
            render(result, el, ctx) { el.append(ctx.el('p', { text: 'drawn' })); } });
        window.PanelManager.createPanelInLayout('gene-set', { id: 'gene-set-G', title: 'Limits', tableFilter: 'gene-table-A',
            sections: Object.fromEntries(['mygene-card', 'string-enrichment', 'gprofiler-gost', 'string-network', 'mygene-mapping']
                .map(id => [id, { visible: false, params: {} }])) });
    }""")
    _ready(page)
    page.route("**/api/json/too_large", lambda route: route.fulfill(status=400, headers={"Access-Control-Allow-Origin": "*"},
               body='[{"Error":"input too large","ErrorMessage":"STRING website does not support networks larger than 2000 nodes"}]'))
    page.click(f"{GS} .gs-run")
    section = f'{GS} .gs-section[data-section="test-limit"]'
    page.wait_for_selector(f'{section} button:has-text("Try anyway")')
    text = " ".join(page.inner_text(section).split())
    assert "10 genes; STRING small accepts at most 5. Filter the table to fewer genes, or try anyway." in text
    assert page.locator(f"{GS} .gs-consent:not([hidden])").count() == 0, "nothing to ask: nothing is sent"
    page.click(f'{section} button:has-text("Try anyway")')
    page.click(f"{GS} .gs-consent button:has-text('Send')")
    until(page, "() => window.PanelManager.getPanel('gene-set-G')._debugState().runs['test-limit'].status === 'error'"
                " && window.PanelManager.getPanel('gene-set-G')._debugState().runs['test-limit'].error.kind === 'http'")
    text = " ".join(page.inner_text(section).split())
    assert "input too large: STRING website does not support networks larger than 2000 nodes" in text, text
    page.unroute("**/api/json/too_large")


def test_the_dataset_is_the_default_background_and_the_genome_an_option(env):
    page, services, root = env
    bodies = []
    page.on("request", lambda r: bodies.append((r.url, r.post_data or "")) if "string-db.org/api/json/enrichment" in r.url or "gost/profile" in r.url else None)
    page.goto(_link(root))
    _ready(page)
    _run_and_send(page)
    enr = [b for u, b in bodies if "enrichment" in u]
    assert enr and "background_string_identifiers=" in enr[-1]
    gp = json.loads([b for u, b in bodies if "gost" in u][-1])
    assert gp["domain_scope"] == "custom" and len(gp["background"]) == 20, "all 20 genes of the dataset"
    assert "background: 5 of the dataset's genes" in page.inner_text(f'{GS} .gs-section[data-section="string-enrichment"]')
    # the whole genome, in the section's settings: fetched again without a background
    page.click(f'{GS} .gs-section[data-section="string-enrichment"] button[aria-label$="settings"]')
    page.select_option(f'{GS} #gs-p-string-enrichment-background-gene-set-G', "genome")
    until(page, "() => /background: whole genome/.test(document.querySelector('%s .gs-section[data-section=\"string-enrichment\"]').textContent)" % GS)
    assert "background_string_identifiers=" not in [b for u, b in bodies if "enrichment" in u][-1]


def _selection_hash(page, genes):
    return page.evaluate("async (g) => (await import('/static/js/panels/gene-set-utilities/state.js')).setHash(g)", genes)


def test_consent_rides_in_the_link_for_its_selection_only(env, browser):
    page, services, root = env
    page.goto(_link(root))
    _ready(page)
    _run_and_send(page)
    cfg = page.evaluate("() => window.PanelManager.getPanel('gene-set-G').getConfig()")
    ten = [f"GENE00{i}" for i in range(10)]
    assert cfg["consent"]["selection"] == _selection_hash(page, ten)
    assert set(cfg["consent"]["hosts"]) == {"version-12-5.string-db.org", "biit.cs.ut.ee", "mygene.info"}
    consent = cfg["consent"]

    def opened(gs, search="GENE00"):
        context, p2, s2, errors = _open(browser, root)
        p2.goto(_link(root, gs=gs, search=search))
        p2.wait_for_selector(f"{TABLE} .dataTables_scrollBody tbody tr", timeout=30000)
        until(p2, "() => window.PanelManager.getPanel('gene-set-G') && window.PanelManager.getPanel('gene-set-G')._debugState().source.count > 0")
        return context, p2, s2, errors

    # a fresh browser (no stored answers): auto-update on with the link's consent for this
    # selection fetches on opening, without asking
    context, p2, s2, errors = opened({"autoUpdate": True, "consent": consent})
    try:
        _all_ok(p2)
        assert p2.locator(f"{GS} .gs-consent:not([hidden])").count() == 0
        assert not errors and not s2.unmocked
    finally:
        context.close()
    # the same link with auto-update off: nothing on opening; Run sends without asking
    context, p2, s2, errors = opened({"autoUpdate": False, "consent": consent})
    try:
        p2.wait_for_timeout(1500)
        assert s2.calls == []
        p2.click(f"{GS} .gs-run")
        _all_ok(p2)
        assert p2.locator(f"{GS} .gs-consent:not([hidden])").count() == 0
    finally:
        context.close()
    # another selection: the link's consent does not cover it; nothing on opening, Run asks
    context, p2, s2, errors = opened({"autoUpdate": True, "consent": consent}, search="GENE01")
    try:
        p2.wait_for_timeout(2000)
        assert s2.calls == [], "another selection: not covered"
        p2.click(f"{GS} .gs-run")
        p2.wait_for_selector(f"{GS} .gs-consent:not([hidden])")
        assert s2.calls == []
    finally:
        context.close()


def test_never_is_kept_by_the_browser_and_wins_over_a_link(env, browser):
    page, services, root = env
    page.goto(_link(root))
    _ready(page)
    page.click(f"{GS} .gs-run")
    page.wait_for_selector(f"{GS} .gs-consent:not([hidden])")
    page.click(f"{GS} .gs-consent button:has-text('Never')")
    section = f'{GS} .gs-section[data-section="string-enrichment"]'
    until(page, "() => window.PanelManager.getPanel('gene-set-G')._debugState().runs['string-enrichment'].error?.kind === 'declined'")
    assert "You chose not to send gene ids to version-12-5.string-db.org (in this browser)." in " ".join(page.inner_text(section).split())
    assert services.calls == []
    stored = page.evaluate("() => JSON.parse(localStorage.getItem('annzarro:external-ok'))")
    assert stored["version-12-5.string-db.org"] == "deny"
    # a link whose author agreed for this very selection: the user's Never still holds
    ten = [f"GENE00{i}" for i in range(10)]
    consent = {"selection": _selection_hash(page, ten), "hosts": ["version-12-5.string-db.org"]}
    page.goto("about:blank")
    page.goto(_link(root, gs={"consent": consent}))
    _ready(page)
    page.click(f"{GS} .gs-run")
    until(page, "() => window.PanelManager.getPanel('gene-set-G')._debugState().runs['string-network'].error?.kind === 'declined'")
    assert services.count("string-ids") == 0
    # Ask again forgets the Never for that service; the link's consent for this selection then
    # applies, so STRING is asked without a question
    page.click(f'{section} button:has-text("Ask again")')
    _all_ok(page, ["string-enrichment"])
    assert services.count("string-ids") >= 1
    assert "version-12-5.string-db.org" not in (page.evaluate("() => localStorage.getItem('annzarro:external-ok')") or "")


# --------------------------------------------------------------------------- the species, when not chosen

def _widen(path, n):
    """A copy of the fixture with n genes (GENE000...): var rewritten, X an empty sparse matrix."""
    import shutil
    import numpy as np
    import zarr
    shutil.copytree(STORE, path)
    g = zarr.open_group(str(path), mode="r+", zarr_format=2)
    names = np.array([f"GENE{i:03d}" for i in range(n)], dtype=object)
    for col in ("_index", "gene_name"):
        old = g["var"][col]
        attrs = dict(old.attrs)
        a = g["var"].create_array(col, shape=(n,), dtype=str, overwrite=True)
        a[:] = names
        a.attrs.update(attrs)
    x = g["X"]
    x.attrs["shape"] = [200, n]
    for key, values in (("data", np.zeros(0, dtype="float32")), ("indices", np.zeros(0, dtype="int32")),
                        ("indptr", np.zeros(n + 1, dtype="int32"))):
        arr = x.create_array(key, shape=values.shape, dtype=values.dtype, overwrite=True)
        if values.size:
            arr[:] = values
    zarr.consolidate_metadata(str(path), zarr_format=2)


def _species_stores(tmp_path_factory):
    """Copies of the fixture: mouse Ensembl ids in gene_name; and symbols with uns["organism"]."""
    import shutil
    import numpy as np
    import zarr
    root = tmp_path_factory.mktemp("species-data")
    mouse = root / "mouse_ens.zarr"
    shutil.copytree(STORE, mouse)
    g = zarr.open_group(str(mouse), mode="r+", zarr_format=2)
    g["var"]["gene_name"][:] = np.array([f"ENSMUSG000000{33845 + i}" for i in range(20)], dtype=object)
    wide = root / "wide.zarr"
    _widen(wide, 170)
    org = root / "organism.zarr"
    shutil.copytree(STORE, org)
    g = zarr.open_group(str(org), mode="r+", zarr_format=2)
    # as tests/server/test_uns_scalars.py writes a string scalar (zarr 3 API, format 2)
    a = g["uns"].create_array("organism", shape=(), dtype=str)
    a[()] = "Danio rerio"
    # the fixture's metadata is consolidated: list the new entry there too
    zarr.consolidate_metadata(str(org), zarr_format=2)
    return root


@pytest.fixture(scope="module")
def species_server(tmp_path_factory):
    import subprocess
    import sys
    import time
    import urllib.request
    from annzarro.tests.browser.test_memory_guard import REPO, _free_port
    data = _species_stores(tmp_path_factory)
    home = tmp_path_factory.mktemp("species-home")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--host", "127.0.0.1", "--port", str(port),
                             "--data-dir", str(data), "--no-browser", "--auth-disabled"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for _ in range(120):
        try:
            urllib.request.urlopen(root + "/api/v1/config", timeout=1)
            break
        except OSError:
            time.sleep(0.25)
    yield root, data
    proc.terminate()
    proc.wait(10)


def _species_link(root, store, taxonomy=None):
    cfgs = {"gene-table-A": {"id": "gene-table-A", "title": "Gene Table 1", "searchText": "",
                             "columns": [{"type": "var", "key": "gene_name", "column": ""}]},
            "gene-set-G": {"id": "gene-set-G", "title": "Gene Set Analysis 1", "tableFilter": "gene-table-A"}}
    tiles = [{"type": "tile", "id": "gene-table-A"}, {"type": "tile", "id": "gene-set-G"}]
    constants = {"focusedGene": "GENE003"}
    if taxonomy:
        constants["taxonomyId"] = taxonomy
    view = {"v": 1, "constants": constants, "layout": {"v": 1, "hierarchy": [{"type": "split", "direction": "horizontal",
            "height": 1000, "panes": [{"percentage": 35}, {"percentage": 65}], "children": tiles}],
            "controlState": {}, "panelConfigs": cfgs}}
    enc = base64.urlsafe_b64encode(json.dumps(view).encode()).decode().rstrip("=")
    return f"{root}/?dataset_path={urllib.parse.quote(str(store), safe='/')}#view={enc}"


SPECIES_FIELD = f"{GS} #gs-species-gene-set-G"


def _taxonomy(page):
    return page.evaluate("async () => { const {DataManager} = await import('/static/js/data-manager.js');"
                         " return [DataManager.getTaxonomyId(), DataManager.getTaxonomySource()]; }")


def test_species_from_ensembl_ids_when_nobody_chose_it(browser, species_server):
    root, data = species_server
    context, page, services, errors = _open(browser, root)
    try:
        page.goto(_species_link(root, data / "mouse_ens.zarr"))
        _ready(page)
        until(page, "(sel) => document.querySelector(sel).value === 'Auto: Mus musculus (from Ensembl IDs)'", SPECIES_FIELD)
        assert _taxonomy(page) == ["10090", "inferred"]
        assert state(page)["idType"] == "ensembl"
        # the links follow: mouse resources, not human ones
        labels = page.locator(f"{GS} .gs-links__focus a").all_inner_texts()
        assert "Ensembl" in labels and "GeneCards" not in labels and "HPA" not in labels
        # saved as inferred, so reopened it is inferred again (not frozen as a choice)
        constants = page.evaluate("() => window.sessionManager.captureView().constants")
        assert constants["taxonomyId"] == "10090" and constants["taxonomySource"] == "inferred"
        # a user's pick wins over the inference
        page.click(SPECIES_FIELD)
        page.fill(SPECIES_FIELD, "rat")
        page.click(f'{GS} .name-picker-option:has-text("Rattus norvegicus")')
        until(page, "async () => { const {DataManager} = await import('/static/js/data-manager.js'); return DataManager.getTaxonomySource() === 'explicit'; }")
        assert _taxonomy(page) == ["10116", "explicit"]
        page.click(f"{TABLE} .dataTables_scrollBody")  # move the focus off the field
        until(page, "(sel) => document.querySelector(sel).value === 'Rattus norvegicus (rat) · 10116'", SPECIES_FIELD)
        assert services.calls == [] and not errors and not services.unmocked
    finally:
        context.close()


def test_species_from_uns_and_an_unconfirmed_default(browser, species_server):
    root, data = species_server
    context, page, services, errors = _open(browser, root)
    try:
        page.goto(_species_link(root, data / "organism.zarr"))
        _ready(page)
        until(page, """(sel) => document.querySelector(sel).value === 'Auto: Danio rerio (from uns["organism"])'""", SPECIES_FIELD)
        assert _taxonomy(page) == ["7955", "inferred"]
        # symbols, no uns entry: the server's default, said to be unchecked; not saved in a link
        page.goto("about:blank")
        page.goto(_species_link(root, STORE))
        _ready(page)
        until(page, "(sel) => document.querySelector(sel).value === 'Homo sapiens (human) · 9606 (default, not checked)'", SPECIES_FIELD)
        hint = page.inner_text(f"{GS} #gs-species-err-gene-set-G")
        assert "does not say its species" in hint and "Check it" in hint
        assert _taxonomy(page) == ["9606", "default"]
        assert "taxonomyId" not in page.evaluate("() => window.sessionManager.captureView().constants")
        # a link that names the species is a choice: kept, not inferred over
        page.goto("about:blank")
        page.goto(_species_link(root, data / "mouse_ens.zarr", taxonomy="10116"))
        _ready(page)
        page.wait_for_timeout(800)
        assert _taxonomy(page) == ["10116", "explicit"]
        assert page.input_value(SPECIES_FIELD) == "Rattus norvegicus (rat) · 10116"
        assert services.calls == [] and not errors and not services.unmocked
    finally:
        context.close()


# --------------------------------------------------------------------------- operator review, batch 2

def _wide_link(root, data):
    return _species_link(root, data / "wide.zarr", taxonomy="9606")


def test_the_sections_label_follows_hiding_and_showing(env):
    page, services, root = env
    page.goto(_link(root))
    _ready(page)
    label = lambda: page.inner_text(f"{GS} .gs-sections-btn")
    assert label().startswith("Sections 6/10")
    page.click(f'{GS} .gs-section[data-section="string-network"] .gs-section__toggle')
    until(page, "() => /Sections 5\\/10/.test(document.querySelector('%s .gs-sections-btn').textContent)" % GS)
    page.click(f"{GS} .gs-sections-btn")
    page.click(f'{GS} .gs-menu [data-section="gprofiler-gost"]')
    until(page, "() => /Sections 4\\/10/.test(document.querySelector('%s .gs-sections-btn').textContent)" % GS)
    page.click(f'{GS} .gs-menu [data-section="gprofiler-gost"]')
    until(page, "() => /Sections 5\\/10/.test(document.querySelector('%s .gs-sections-btn').textContent)" % GS)
    assert services.calls == []


def test_a_long_links_list_can_be_hidden_from_its_end(browser, species_server):
    root, data = species_server
    context, page, services, errors = _open(browser, root)
    try:
        page.goto(_wide_link(root, data))
        _ready(page)
        until(page, "() => window.PanelManager.getPanel('gene-set-G')._debugState().source.count === 170")
        page.click(f'{GS} .gs-list-toggle:has-text("Show list")')
        page.wait_for_selector(f"{GS} .gs-links__table tbody tr")
        scroll = f"{GS} .gs-links__scroll"
        box = page.evaluate("(sel) => { const e = document.querySelector(sel); return [e.scrollHeight, e.clientHeight, getComputedStyle(e).overflowY]; }", scroll)
        assert box[2] == "auto" and box[0] > box[1], f"the table scrolls on its own: {box}"
        page.evaluate("(sel) => { const e = document.querySelector(sel); e.scrollTop = e.scrollHeight; }", scroll)
        # the title row's Hide list stays in view; the one under the table hides it too
        assert page.inner_text(f"{GS} .gs-list-toggle") == "Hide list"
        page.click(f"{GS} .gs-list-hide")
        until(page, "() => !document.querySelector('%s .gs-links__table')" % GS)
        assert page.evaluate("() => document.activeElement && document.activeElement.textContent") == "Show list"
        assert page.get_attribute(f"{GS} .gs-list-toggle", "aria-expanded") == "false"
        assert services.calls == [] and not errors and not services.unmocked
    finally:
        context.close()


def test_every_gene_string_did_not_know_is_in_the_breakdown(browser, species_server):
    root, data = species_server
    context, page, services, errors = _open(browser, root)
    try:
        page.goto(_wide_link(root, data))
        _ready(page)
        until(page, "() => window.PanelManager.getPanel('gene-set-G')._debugState().source.count === 170")
        page.click(f"{GS} .gs-sections-btn")
        for sid in ("gprofiler-gost", "string-network", "mygene-mapping", "mygene-card"):
            page.click(f'{GS} .gs-menu [data-section="{sid}"]')
        page.click(f"{GS} .gs-sections-btn")
        page.click(f"{GS} .gs-run")
        page.click(f"{GS} .gs-consent button:has-text('Send')")
        _all_ok(page, ["string-enrichment"])
        section = f'{GS} .gs-section[data-section="string-enrichment"]'
        assert "not found in STRING" not in page.inner_text(f"{section} .gs-section__result"), "said once, in the strip"
        assert page.get_attribute(f"{section} .plot-status", "data-summary").startswith("5 of 170 genes shown")
        page.click(f"{section} .plot-status .ps-summary")
        page.wait_for_selector(f"{section} .ps-names-list")
        assert page.locator(f"{section} .ps-names-list li").count() == 165
        assert page.inner_text(f"{section} [data-ps-copy]") == "Copy 165"
        page.fill(f"{section} .ps-names-find", "GENE16")
        assert page.locator(f"{section} .ps-names-list li:not([hidden])").count() == 10
        assert not errors and not services.unmocked
    finally:
        context.close()


def test_string_finding_nothing_is_an_answer_that_names_the_species(browser, species_server):
    root, data = species_server
    context, page, services, errors = _open(browser, root)
    body = open(os.path.join(FIX, "string-404-nothing-found.json")).read()
    page.route("**/api/json/get_string_ids", lambda route: route.fulfill(status=404, body=body,
               headers={"Access-Control-Allow-Origin": "*", "Content-Type": "application/json"}))
    try:
        # a mouse dataset (Ensembl ids), with human chosen in the link
        page.goto(_species_link(root, data / "mouse_ens.zarr", taxonomy="9606"))
        _ready(page)
        page.click(f"{GS} .gs-run")
        page.click(f"{GS} .gs-consent button:has-text('Send')")
        until(page, "() => window.PanelManager.getPanel('gene-set-G')._debugState().runs['string-enrichment'].error?.kind === 'unmapped'")
        section = f'{GS} .gs-section[data-section="string-enrichment"]'
        text = " ".join(page.inner_text(section).split())
        assert "none found" in text
        assert ("STRING knows none of these 20 genes for Homo sapiens (taxon 9606). Is the species right? "
                "The dataset's genes look like Mus musculus (taxon 10090).") in text, text
        assert "not found by the service" in text
        assert "&nbsp;" not in text and "<br" not in text and "Sorry" not in text
        assert not errors
    finally:
        context.close()


ENRICH = f'{GS} .gs-section[data-section="string-enrichment"]'


def _refresh_after_change(page, text):
    _search(page, text)
    until(page, "() => /Selection changed/.test(document.querySelector('%s .gs-bar__text').textContent)" % GS)
    page.click(f'{GS} .gs-bar__actions button:has-text("Refresh")')
    _all_ok(page)
    until(page, "() => window.PanelManager.getPanel('gene-set-G')._debugState().stale === null")
    page.wait_for_timeout(300)


def _enrichment_view(page):
    return page.evaluate("""(sel) => { const s = document.querySelector(sel);
        const f = s.querySelector('.gs-filter');
        const cats = [...s.querySelectorAll('.gs-long tbody tr')].map(r => r.cells[0].textContent);
        const note = s.querySelector('.gs-category-reset');
        const more = s.querySelector('.gs-more button');
        return { filter: f ? f.value : null, rows: cats.length, cats: [...new Set(cats)],
                 note: note ? note.textContent : null, more: more ? more.textContent : null }; }""", ENRICH)


def test_a_rerun_keeps_the_category_and_the_full_table(env):
    """A rerun (Refresh after the selection changed) redraws STRING's enrichment. It used to come
    back on "All categories" and on the first 25 rows, so the reader picked GO Process again."""
    page, services, root = env
    page.goto(_link(root))
    _ready(page)
    _run_and_send(page)

    # the full table, then a rerun: still the full table
    page.click(f'{ENRICH} button:has-text("Show all")')
    full = _enrichment_view(page)
    assert full["rows"] > 25 and full["more"] == "Show fewer", full
    _refresh_after_change(page, "GENE01")
    v = _enrichment_view(page)
    assert (v["rows"], v["more"], v["filter"]) == (full["rows"], "Show fewer", ""), v

    # a category, then a rerun: still that category
    page.select_option(f"{ENRICH} .gs-filter", "Process")
    v = _enrichment_view(page)
    assert v["filter"] == "Process" and v["cats"] == ["GO Process"], v
    _refresh_after_change(page, "GENE00")
    v = _enrichment_view(page)
    assert v["filter"] == "Process" and v["cats"] == ["GO Process"] and v["note"] is None, v

    # results without that category: all categories, and the panel says why
    rows = json.loads(_read("string-enrichment.json"))
    services.bodies["string-enrichment"] = json.dumps([r for r in rows if r["category"] != "Process"]).encode()
    _refresh_after_change(page, "GENE0")          # a new selection: results already fetched are reused
    v = _enrichment_view(page)
    assert v["filter"] == "" and "GO Process" not in v["cats"] and len(v["cats"]) > 1, v
    assert v["note"] == "GO Process is not among these results: showing all categories.", v

    # and back: the choice was kept, so it applies again when the category is back
    del services.bodies["string-enrichment"]
    _refresh_after_change(page, "GENE00")
    v = _enrichment_view(page)
    assert v["filter"] == "Process" and v["note"] is None, v
    assert not services.unmocked, services.unmocked
