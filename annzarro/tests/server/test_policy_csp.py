"""The Content-Security-Policy built from the policy keys (slice P1).

``connect-src`` is the control that holds even against a modified client, so
these tests hold it to the keys: turning a key off at any layer removes
exactly the hosts only that key accounted for, and the policy allows no host
that no key accounts for. Parametrized over ``REGISTRY.with_outbound_hosts()``,
so a key declared later with ``outbound_hosts`` is covered with no change here.
"""
import json
import os
import shutil
import subprocess

import pytest

from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app
from annzarro.server.policy import REGISTRY, engine as app_engine, load_declarations
from annzarro.server.policy.csp import BASE_SOURCES, connect_src, csp_hosts
from annzarro.server.policy.panels import GENE_SET_SERVICES, SPECIES_HOSTS, service_hosts
from annzarro.server.policy.resolver import CONFIG, OVERLAY, USER
from annzarro.tests.server.policy_helpers import make_engine, set_path

load_declarations()
OUTBOUND = REGISTRY.with_outbound_hosts()
NODE = shutil.which("node")
JS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "js")
ENABLED_ALL = {"panel.gene-set.enabled": True}


def engine_with(layer=None, values=None, config=None):
    """An engine whose ``layer`` (config, overlay or user:alice) holds ``values``;
    the user layer answers for alice only."""
    config = dict(config or {})
    overlay, per_user = {}, {}
    for name, value in (values or {}).items():
        if layer == CONFIG:
            set_path(config, REGISTRY.get(name).config_path, value)
        elif layer == OVERLAY:
            overlay[name] = value
        elif layer == USER:
            per_user.setdefault("alice", {})[name] = value
    eng = make_engine(REGISTRY, config=config, overlay=overlay)
    eng.set_source(USER, lambda name: per_user.get(name, {}), stamp=lambda: repr(per_user))
    return eng


def layers_of(key):
    return [l for l in (CONFIG, OVERLAY, USER) if (l != CONFIG or key.config_path) and (l == CONFIG or key.scope != "config")]


def exclusive_hosts(key, others):
    """Hosts only ``key`` accounts for, at the defaults."""
    cfg = {}
    mine = {h for h in key.outbound_hosts(key.default_value(cfg), cfg)}
    theirs = {h for o in others if o is not key for h in o.outbound_hosts(o.default_value(cfg), cfg)}
    return mine - theirs


def test_the_defaults_allow_the_hosts_of_every_service_and_species_search():
    hosts = set(csp_hosts(engine_with()))
    assert {"mygene.info", "biit.cs.ut.ee", "version-12-5.string-db.org", *SPECIES_HOSTS} <= hosts


def test_there_are_outbound_keys_to_cover():
    assert {k.name for k in OUTBOUND} >= {"panel.gene-set.services", "panel.gene-set.species_search"}


@pytest.mark.parametrize("key", OUTBOUND, ids=lambda k: k.name)
@pytest.mark.parametrize("layer", [CONFIG, OVERLAY, USER])
def test_turning_a_key_off_removes_exactly_its_hosts(key, layer):
    if layer not in layers_of(key):
        pytest.skip(f"{key.name} cannot be set in the {layer} layer")
    permissive, restrictive = key.type.samples()
    assert list(key.outbound_hosts(restrictive, {})) == [], "its restrictive sample must allow no host"
    before = set(csp_hosts(engine_with(), "alice"))
    eng = engine_with(layer, {key.name: restrictive})
    after = set(csp_hosts(eng, "alice"))
    assert before - after == exclusive_hosts(key, OUTBOUND) and after < before
    if layer == USER:
        assert set(csp_hosts(eng, "bob")) == before, "an unaffected user keeps the hosts"


@pytest.mark.parametrize("off", [
    pytest.param((OVERLAY, {"outbound.allow_external": False}), id="no-external-hosts-overlay"),
    pytest.param((USER, {"outbound.allow_external": False}), id="no-external-hosts-user"),
    pytest.param((CONFIG, {"panel.gene-set.external_requests": "off"}), id="external-requests-off"),
    pytest.param((CONFIG, {"panel.gene-set.external_requests": "none"}), id="external-requests-none"),
    pytest.param((OVERLAY, {"panel.gene-set.external_requests": "off"}), id="external-requests-off-overlay"),
    pytest.param((USER, {"panel.gene-set.enabled": False}), id="gene-set-panel-off"),
    pytest.param((OVERLAY, {"panel.gene-set.enabled": False}), id="gene-set-panel-off-overlay"),
])
def test_a_gate_closes_every_outbound_host(off):
    layer, values = off
    if layer == CONFIG and "panel.gene-set.enabled" in values:
        pytest.skip("not configurable in YAML")
    eng = engine_with(layer, values)
    assert csp_hosts(eng, "alice") == []
    assert connect_src(eng, "alice") == "connect-src 'self' data: blob:"


def test_ask_and_on_keep_the_hosts():
    for mode in ("ask", "on"):
        assert set(csp_hosts(engine_with(CONFIG, {"panel.gene-set.external_requests": mode}))) == set(csp_hosts(engine_with()))


def test_no_external_hosts_is_a_constraint_over_every_outbound_key():
    resolved = engine_with(OVERLAY, {"outbound.allow_external": False}).resolve_all("alice")
    assert resolved["panel.gene-set.external_requests"].value == "none"
    assert resolved["panel.gene-set.services"].value == []
    assert resolved["panel.gene-set.species_search"].value is False
    assert resolved["panel.gene-set.links"].value is False
    assert resolved["panel.gene-set.enabled"].value is True, "the switch is about hosts, not panels"


def test_the_csp_allows_no_host_that_no_key_accounts_for():
    # the union of what every outbound key lets through at its most permissive value
    accounted = {h for k in OUTBOUND for h in k.outbound_hosts(k.type.samples()[0], {})}
    assert set(csp_hosts(engine_with())) <= accounted
    assert set(csp_hosts(engine_with(CONFIG, {"panel.gene-set.services": ["mygene-card"]}))) == {"mygene.info"} | set(SPECIES_HOSTS)


def test_data_and_blob_urls_are_allowed_for_plot_export():
    assert BASE_SOURCES == ("'self'", "data:", "blob:")
    assert connect_src(engine_with()).startswith("connect-src 'self' data: blob:")


def test_a_failure_in_the_computation_allows_no_host(caplog):
    class Broken:
        def resolve_all(self, user):
            raise RuntimeError("boom")
    assert connect_src(Broken()) == "connect-src 'self' data: blob:"
    assert connect_src(None) == "connect-src 'self' data: blob:"


# -- the service table -------------------------------------------------------

def test_string_hosts_follow_the_configured_base_url():
    for url, host in (("https://string.example.org:8443/api", "string.example.org:8443"),
                      ("https://string-db.org/api", "string-db.org")):
        cfg = set_path({}, "integrations.string_db.base_url", url)
        assert service_hosts(["string-network"], cfg) == [host]
        assert host in csp_hosts(engine_with(config=cfg))
        assert "version-12-5.string-db.org" not in csp_hosts(engine_with(config=cfg))


@pytest.mark.parametrize("url", ["http://string.example.org/api", "ftp://x.example.org", "https://nodots/api",
                                 "https://user@evil.example.org/api", 7])
def test_a_base_url_the_client_would_not_use_is_not_allowed(url):
    """The client falls back to STRING's versioned host unless the URL is https; the CSP follows."""
    cfg = set_path({}, "integrations.string_db.base_url", url)
    assert service_hosts(["string-network"], cfg) == ["version-12-5.string-db.org"]


def test_the_default_services_leave_out_enrichr_and_reactome_on_a_hosted_server():
    local = engine_with(config={"host": "127.0.0.1"})
    hosted = engine_with(config={"host": "0.0.0.0"})
    every = [s["id"] for s in GENE_SET_SERVICES]
    assert local.effective("alice")["panel.gene-set.services"] == every
    assert hosted.effective("alice")["panel.gene-set.services"] == [i for i in every if i not in ("enrichr", "reactome")]
    assert "maayanlab.cloud" in csp_hosts(local) and "reactome.org" in csp_hosts(local)
    assert "maayanlab.cloud" not in csp_hosts(hosted) and "reactome.org" not in csp_hosts(hosted)
    assert "mygene.info" in csp_hosts(hosted)


def test_an_operator_can_name_services_as_the_yaml_always_allowed():
    eng = engine_with(CONFIG, {"panel.gene-set.services": ["string", "gprofiler"]})
    assert eng.effective("alice")["panel.gene-set.services"] == ["string-enrichment", "string-network", "string-partners",
                                                                 "gprofiler-gost"]
    assert not eng.config_issues


@pytest.mark.parametrize("value, expected", [("none", "none"), ("off", "off"), (False, "off"), (True, "on"), (" ON ", "on")])
def test_external_requests_reads_every_spelling_the_yaml_allows(value, expected):
    eng = engine_with(CONFIG, {"panel.gene-set.external_requests": value})
    assert eng.effective("alice")["panel.gene-set.external_requests"] == expected and not eng.config_issues


def test_the_environment_variable_decides_external_requests_as_the_client_reads_it(monkeypatch):
    monkeypatch.setenv("ANNZARRO_EXTERNAL_REQUESTS", "off")
    eng = engine_with(CONFIG, {"panel.gene-set.external_requests": "on"})
    assert eng.effective("alice")["panel.gene-set.external_requests"] == "off" and csp_hosts(eng) == []


# -- one table, two languages ------------------------------------------------

@pytest.fixture(scope="module")
def js_table():
    if not NODE:
        pytest.skip("node is not installed")
    out = subprocess.run([NODE, os.path.join(JS_DIR, "outbound-hosts-table.mjs")], capture_output=True, text=True, check=True)
    return json.loads(out.stdout)


def test_the_js_adapters_and_the_server_table_name_the_same_services(js_table):
    assert sorted(i for i, _ in js_table["adapters"]["default"]) == sorted(s["id"] for s in GENE_SET_SERVICES)


def test_the_js_adapters_call_the_hosts_the_server_table_allows(js_table):
    configured = set_path({}, "integrations.string_db.base_url", js_table["customString"])
    for variant, cfg in (("default", {}), ("configured", configured)):
        for adapter_id, hosts in js_table["adapters"][variant]:
            assert service_hosts([adapter_id], cfg) == hosts, f"{adapter_id} ({variant})"


def test_the_js_species_search_calls_the_hosts_the_server_table_allows(js_table):
    assert js_table["species"] == list(SPECIES_HOSTS)


# -- the pages ---------------------------------------------------------------

def config(tmp_path, **extra):
    (tmp_path / "data").mkdir(exist_ok=True)
    return {"TESTING": True, "host": "127.0.0.1", "data_dir": str(tmp_path / "data"),
            "log_file": str(tmp_path / "test.log"), **extra}


def header_hosts(response):
    csp = response.headers["Content-Security-Policy"]
    assert csp.startswith("connect-src 'self' data: blob:") and ";" not in csp
    return {s[len("https://"):] for s in csp.split() if s.startswith("https://")}


def test_index_carries_the_csp_of_the_default_policy(tmp_path):
    app = create_app(config(tmp_path))
    response = app.test_client().get("/")
    assert response.status_code == 200
    assert header_hosts(response) == set(csp_hosts(app_engine(app)))
    assert response.headers["Cache-Control"] == "no-store" and "Cookie" in response.headers["Vary"]


def test_every_page_that_renders_the_app_carries_it(tmp_path):
    app = create_app(config(tmp_path))
    c = app.test_client()
    for path in ("/", "/some/client/route"):
        assert "Content-Security-Policy" in c.get(path).headers, path


def test_the_csp_follows_the_overlay_on_the_next_load(tmp_path):
    app = create_app(config(tmp_path))
    store = {}
    app_engine(app).set_source(OVERLAY, lambda: store, stamp=lambda: repr(store))
    c = app.test_client()
    assert "mygene.info" in header_hosts(c.get("/"))
    store["panel.gene-set.services"] = ["gprofiler-gost"]
    assert header_hosts(c.get("/")) == {"biit.cs.ut.ee", *SPECIES_HOSTS}
    store["outbound.allow_external"] = False
    assert header_hosts(c.get("/")) == set()


def test_the_csp_is_per_requester_and_the_login_page_allows_no_host(tmp_path):
    users = tmp_path / "users.json"
    manager = AuthManager(user_file=str(users))
    manager.create_user("alice", "pw")
    manager.create_user("bob", "pw")
    app = create_app(config(tmp_path, auth_enabled=True, user_file=str(users)))
    per_user = {"alice": {"outbound.allow_external": False}}
    app_engine(app).set_source(USER, lambda user: per_user.get(user, {}), stamp=lambda: repr(per_user))
    login = app.test_client().get("/login")
    assert login.headers["Content-Security-Policy"] == "connect-src 'self' data: blob:"

    def hosts_for(name):
        c = app.test_client()
        assert c.post("/login", data={"username": name, "password": "pw"}).status_code == 302
        return header_hosts(c.get("/"))

    assert hosts_for("alice") == set()
    assert "mygene.info" in hosts_for("bob")
    bad = app.test_client().post("/login", data={"username": "alice", "password": "wrong"})
    assert bad.headers["Content-Security-Policy"] == "connect-src 'self' data: blob:"
