"""What an administrator turns off stays off in a real browser (admin slice 6, design 10.7).

A server with login on, signed in through the login page, the policy changed
through the real admin API. No real internet: Playwright's `page.route` answers
the external services from the recordings of test_gene_set_panel and RECORDS
EVERY REQUEST WHOSE HOST IS NOT THE APP'S, so "off" means that list is empty.
The Content-Security-Policy the server puts on the page is what stops a
request; the app's own checks are not what these tests rely on, except where a
test says it is (a tab opened before the change).

1. Positive control: with everything on, a Run, a focus change and a species
   search reach the stub hosts.
2. For each way of turning the panel's outbound traffic off (the "No external
   hosts" switch, `none`, `off`, no services, the panel itself, a per-user
   override): driving the UI sends nothing anywhere. A user the setting does not
   apply to still reaches the hosts.
3. For each host, taking its services out of the list: that host gets nothing,
   the others are still reached.
4. A fetch from the page to a disabled host is rejected by the browser, a
   `securitypolicyviolation` event names `connect-src` and the host, and
   nothing is recorded. The app's own `data:` and `blob:` fetches raise no
   violation.
5. A disabled panel is missing from the menu and a saved set holding one opens
   with the placeholder and keeps the panel's JSON; enabling restores it.
6. A tab opened before the administrator turns external hosts off sends
   nothing at its next Run and says so.
7. `links: false` removes the Links section.

Needs Playwright with Chromium; skipped otherwise, unless
ANNZARRO_REQUIRE_BROWSER=1 (set in CI), where a missing Playwright is an error.
"""
import os
import socket
import subprocess
import sys
import time
import urllib.parse
import urllib.request

import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.server.auth import AuthManager  # noqa: E402
from annzarro.tests.browser.test_gene_set_panel import (  # noqa: E402
    GS, TABLE, Services, _link, _ready, bar, until,
)
from annzarro.tests.browser.test_memory_guard import DATA_DIR  # noqa: E402
from annzarro.tests.server.multiworker_helpers import PASSWORD, Client  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))

#: panel.gene-set.services ids, grouped by the host they send to
HOSTS = {
    "version-12-5.string-db.org": ["string-enrichment", "string-network", "string-partners"],
    "biit.cs.ut.ee": ["gprofiler-gost"],
    "mygene.info": ["mygene-mapping", "mygene-card"],
    "www.proteinatlas.org": ["hpa"],
    "maayanlab.cloud": ["enrichr"],
    "reactome.org": ["reactome"],
}
ALL_SERVICES = [s for group in HOSTS.values() for s in group]
SPECIES_HOST = "api.ncbi.nlm.nih.gov"
KEYS = ["outbound.allow_external", "panel.gene-set.enabled", "panel.gene-set.external_requests",
        "panel.gene-set.services", "panel.gene-set.species_search", "panel.gene-set.links"]
#: the optional sections are hidden by default; show them so every host is asked
SECTIONS = {"sections": {sid: {"visible": True, "params": {}} for sid in ("hpa", "enrichr", "reactome")}}
SPECIES = f"{GS} #gs-species-gene-set-G"


class Recorder(Services):
    """Services that also records the host of every request that is not the app's."""

    def __init__(self, root):
        super().__init__(root)
        self.external = []

    def handle(self, route):
        url = route.request.url
        if not url.startswith(self.root) and not url.startswith(("data:", "blob:")):
            self.external.append(urllib.parse.urlsplit(url).hostname)
        return super().handle(route)


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def server(tmp_path_factory):
    home = tmp_path_factory.mktemp("home")
    users = home / "users" / "users.json"
    users.parent.mkdir()
    manager = AuthManager(user_file=str(users))
    for name, admin in (("root", True), ("alice", False), ("bob", False)):
        manager.create_user(name, PASSWORD, is_admin=admin)
    (home / "config.yaml").write_text(
        f"auth:\n  enabled: true\n  user_file: \"{users}\"\nserver:\n  admin_rate_per_minute: 1000\n")
    port = _free_port()
    env = dict(os.environ, ANNZARRO_HOME=str(home), ANNZARRO_HEADLESS="1",
               PYTHONPATH=REPO + os.pathsep + os.environ.get("PYTHONPATH", ""))
    proc = subprocess.Popen([sys.executable, "-m", "annzarro.cli", "start", "--config", str(home / "config.yaml"),
                             "--host", "127.0.0.1", "--port", str(port), "--data-dir", DATA_DIR, "--no-browser"],
                            env=env, cwd=REPO, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
    root = f"http://127.0.0.1:{port}"
    for _ in range(120):
        try:
            urllib.request.urlopen(root + "/login", timeout=1)
            break
        except OSError:
            time.sleep(0.25)
    else:
        proc.kill()
        pytest.fail("server did not start")
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
def admin(server):
    """The admin API, as root; every setting this file changes is removed afterwards."""
    client = Client(server).sign_in("root", admin_page=True)

    class Admin:
        def set(self, **changes):
            reply = client.put("/api/v1/admin/policy", changes)
            assert reply.status == 200, reply.body

        def user(self, name, **changes):
            reply = client.put(f"/api/v1/admin/users/{name}/policy", changes)
            assert reply.status == 200, reply.body

    yield Admin()
    nothing = {key: None for key in KEYS}
    assert client.put("/api/v1/admin/policy", nothing).status == 200
    for name in ("alice", "bob"):
        assert client.put(f"/api/v1/admin/users/{name}/policy", nothing).status == 200


def _set_everything_on(admin):
    """Every service on (Enrichr and Reactome are off by default on a hosted server), asking no questions."""
    admin.set(**{"panel.gene-set.external_requests": "on", "panel.gene-set.services": ALL_SERVICES})


class Session:
    """A signed-in browser page whose every external request is recorded."""

    def __init__(self, browser, root, username):
        self.root = root
        self.context = browser.new_context(viewport={"width": 1500, "height": 1100})
        self.page = self.context.new_page()
        self.services = Recorder(root)
        self.errors = []
        self.page.route("**/*", self.services.handle)
        self.page.on("pageerror", lambda e: self.errors.append(str(e)))
        self.page.add_init_script(
            "window.__violations = []; document.addEventListener('securitypolicyviolation', "
            "e => window.__violations.push({directive: e.effectiveDirective, uri: e.blockedURI}));")
        self.page.goto(root + "/login")
        self.page.fill("#username", username)
        self.page.fill("#password", PASSWORD)
        self.page.click("button[type=submit]")
        self.page.wait_for_url(lambda u: "/login" not in u, timeout=30000)

    def open(self, **gs):
        self.page.goto("about:blank")      # the same link again would only be a hash change, not a load
        self.page.goto(_link(self.root, gs={**SECTIONS, **gs}))
        self.page.wait_for_selector(f"{TABLE} .dataTables_scrollBody tbody tr", timeout=30000)
        self.page.wait_for_selector(f"{GS} .gs-run, {GS} .panel-no-data", timeout=30000)
        if self.page.locator(f"{GS} .gs-run").count():
            _ready(self.page)
        return self

    @property
    def hosts(self):
        return set(self.services.external)

    def csp(self):
        return self.page.evaluate("async () => (await fetch(location.href)).headers.get('content-security-policy')")

    def drive(self):
        """Run, change the focus, type a species: everything that could send something."""
        page = self.page
        if page.locator(f"{GS} .gs-run").count():
            page.click(f"{GS} .gs-run")
        page.click(f'{TABLE} .entity-index-value:has-text("GENE007")')
        if page.locator(SPECIES).count():
            page.click(SPECIES)
            page.fill(SPECIES, "zebraf")
            option = f'{GS} .name-picker-option:has-text("Search NCBI Taxonomy")'
            page.wait_for_timeout(500)
            if page.locator(option).count():
                page.click(option)
        page.wait_for_timeout(2500)
        return self

    def reach(self, hosts, timeout=20.0):
        """Wait until every host in ``hosts`` has been asked (the positive controls)."""
        for _ in range(int(timeout * 5)):
            if set(hosts) <= self.hosts:
                return
            self.page.wait_for_timeout(200)
        raise AssertionError(f"never reached {sorted(set(hosts) - self.hosts)}; reached {sorted(self.hosts)}")

    def close(self):
        assert not self.errors, self.errors
        self.context.close()


@pytest.fixture
def sign_in(browser, server):
    opened = []

    def make(username="alice"):
        session = Session(browser, server, username)
        opened.append(session)
        return session

    yield make
    for session in opened:
        session.close()


def test_with_everything_on_a_run_a_focus_and_a_species_search_reach_the_stub_hosts(admin, sign_in):
    _set_everything_on(admin)
    s = sign_in().open().drive()
    s.reach(list(HOSTS) + [SPECIES_HOST])
    assert s.page.evaluate("() => window.__violations") == []


WAYS = {
    "no external hosts": lambda admin: admin.set(**{"outbound.allow_external": False}),
    "external requests none": lambda admin: admin.set(**{"panel.gene-set.external_requests": "none"}),
    "external requests off": lambda admin: admin.set(**{"panel.gene-set.external_requests": "off"}),
    "the panel is disabled": lambda admin: admin.set(**{"panel.gene-set.enabled": False}),
    "this user only": lambda admin: admin.user("alice", **{"outbound.allow_external": False}),
}


@pytest.mark.parametrize("way", sorted(WAYS))
def test_driving_the_ui_sends_nothing_anywhere(admin, sign_in, way):
    _set_everything_on(admin)
    WAYS[way](admin)
    s = sign_in("alice").open().drive()
    assert s.services.external == [], f"{way}: {s.services.external}"
    assert s.page.evaluate("() => window.__violations") == [], "the app itself tried a host the policy forbids"


def test_a_user_the_setting_does_not_apply_to_still_reaches_the_hosts(admin, sign_in):
    _set_everything_on(admin)
    admin.user("alice", **{"outbound.allow_external": False})
    alice = sign_in("alice").open().drive()
    bob = sign_in("bob").open().drive()
    bob.reach(list(HOSTS) + [SPECIES_HOST])
    assert alice.services.external == []


@pytest.mark.parametrize("host", sorted(HOSTS))
def test_taking_a_hosts_services_out_stops_that_host_and_only_that_host(admin, sign_in, host):
    admin.set(**{"panel.gene-set.external_requests": "on",
                 "panel.gene-set.services": [s for s in ALL_SERVICES if s not in HOSTS[host]]})
    s = sign_in().open().drive()
    others = [h for h in HOSTS if h != host]
    s.reach(others + [SPECIES_HOST])
    assert host not in s.hosts, f"{host} was asked although its services are off: {s.services.external}"
    assert f"https://{host}" not in s.csp()


def test_no_services_stops_every_service_host_and_leaves_the_taxonomy_lookup(admin, sign_in):
    admin.set(**{"panel.gene-set.external_requests": "on", "panel.gene-set.services": []})
    s = sign_in().open().drive()
    s.reach([SPECIES_HOST])
    assert s.hosts.isdisjoint(HOSTS), s.services.external


def test_species_search_off_stops_the_taxonomy_lookup(admin, sign_in):
    _set_everything_on(admin)
    admin.set(**{"panel.gene-set.species_search": False})
    s = sign_in().open().drive()
    s.reach(list(HOSTS))
    assert SPECIES_HOST not in s.hosts and "www.ebi.ac.uk" not in s.hosts


def test_the_browser_refuses_a_fetch_to_a_disabled_host_and_names_the_directive(admin, sign_in):
    _set_everything_on(admin)
    admin.set(**{"outbound.allow_external": False})
    s = sign_in().open()
    page = s.page
    for host in list(HOSTS) + [SPECIES_HOST]:
        answer = page.evaluate("""async (host) => {
            try { await fetch('https://' + host + '/'); return 'sent'; } catch (e) { return 'rejected'; }
        }""", host)
        assert answer == "rejected", host
    page.wait_for_timeout(300)
    violations = page.evaluate("() => window.__violations")
    assert {v["directive"] for v in violations} == {"connect-src"}, violations
    blocked = " ".join(v["uri"] for v in violations)
    for host in list(HOSTS) + [SPECIES_HOST]:
        assert host in blocked, (host, violations)
    assert s.services.external == []
    # the app's own data: and blob: fetches (plot export) are not violations
    page.evaluate("() => { window.__violations = []; }")
    own = page.evaluate("""async () => {
        const data = await (await fetch('data:text/plain,hello')).text();
        const blob = await (await fetch(URL.createObjectURL(new Blob(['x'])))).text();
        return [data, blob];
    }""")
    assert own == ["hello", "x"]
    assert page.evaluate("() => window.__violations") == []


def _menu(page):
    return page.locator(".panel-type-option").evaluate_all("els => els.map(e => e.dataset.type)")


def test_a_disabled_panel_is_a_placeholder_that_keeps_its_json_and_enabling_restores_it(admin, sign_in):
    gs = {"autoUpdate": False, "taxonomyId": "10090", "futureField": {"kept": [1, 2, 3]}}
    admin.set(**{"panel.gene-set.enabled": False})
    s = sign_in().open(**gs)
    page = s.page
    until(page, "() => !!document.querySelector('.panel-no-data[data-disabled-by-policy]')")
    assert "Disabled by the administrator" in page.inner_text(f"{GS} .panel-no-data")
    assert page.locator(f"{GS} .gs-run").count() == 0
    assert page.locator(f"{TABLE} .dataTables_scrollBody tbody tr").count() > 0, "the other panels render"
    assert "gene-set" not in _menu(page)
    saved = page.evaluate("() => window.PanelManager.saveLayout().panelConfigs['gene-set-G']")
    assert saved["futureField"] == {"kept": [1, 2, 3]} and saved["taxonomyId"] == "10090"
    assert s.services.external == []

    admin.set(**{"panel.gene-set.enabled": None})
    s.open(**gs)
    assert page.locator(f"{GS} .gs-run").count() == 1
    assert page.locator(".panel-no-data[data-disabled-by-policy]").count() == 0


def test_a_tab_opened_before_the_switch_sends_nothing_at_its_next_run_and_says_so(admin, sign_in):
    _set_everything_on(admin)
    s = sign_in().open()
    page = s.page
    assert s.services.external == []
    admin.set(**{"outbound.allow_external": False})
    page.click(f"{GS} .gs-run")
    until(page, "() => /turned off by the administrator/.test(document.querySelector('.tile[data-tile-id=\"gene-set-G\"] .gs-bar__text')?.textContent || '')")
    assert "nothing was sent" in bar(page)
    page.wait_for_timeout(1500)
    assert s.services.external == []


def test_links_off_removes_the_links_section(admin, sign_in):
    _set_everything_on(admin)
    s = sign_in().open()
    assert s.page.locator(f"{GS} .gs-links__focus a").count() >= 8
    admin.set(**{"panel.gene-set.links": False})
    s.open()
    assert s.page.locator(f"{GS} .gs-links__focus").count() == 0
