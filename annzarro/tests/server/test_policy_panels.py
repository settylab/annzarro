"""The panel and outbound keys (slice P1): declared from panel-types.json, with
the defaults, scopes and rules the design gives them."""
import json

import pytest

from annzarro.server.core import create_app
from annzarro.server.policy import REGISTRY, load_declarations
from annzarro.server.policy.panels import EXTERNAL_REQUESTS, panel_types
from annzarro.tests.server.policy_helpers import make_engine

load_declarations()


def test_every_panel_type_has_its_switch():
    types = [e["type"] for e in panel_types()]
    assert {"cell-plot", "gene-plot", "cell-table", "gene-table", "gene-set"} <= set(types)
    for t in types:
        key = REGISTRY.get(f"panel.{t}.enabled")
        assert key is not None and key.default is True and key.scope == "user" and key.combine == "restrict"
    assert {k.name for k in REGISTRY if k.name.startswith("panel.") and k.name.endswith(".enabled")} == \
        {f"panel.{t}.enabled" for t in types}


def test_the_outbound_keys_restrict():
    for name in ("outbound.allow_external", "panel.gene-set.external_requests", "panel.gene-set.services",
                 "panel.gene-set.species_search", "panel.gene-set.links"):
        key = REGISTRY.get(name)
        assert key.combine == "restrict" and key.scope == "user" and key.area == "outbound", name
    assert [i for i in REGISTRY.get("panel.gene-set.external_requests").type.ids] == list(EXTERNAL_REQUESTS)


def test_the_config_keys_are_the_ones_the_yaml_has_always_had():
    assert REGISTRY.get("panel.gene-set.external_requests").config_path == "integrations.external_requests"
    assert REGISTRY.get("panel.gene-set.services").config_path == "integrations.gene_set.services"


def test_external_requests_restricts_across_layers():
    eng = make_engine(REGISTRY, config={"integrations": {"external_requests": "on"}}, overlay={"panel.gene-set.external_requests": "off"})
    assert eng.effective(None)["panel.gene-set.external_requests"] == "off"
    eng.overlay_store["panel.gene-set.external_requests"] = "on"
    eng.set_source("user", lambda u: {"panel.gene-set.external_requests": "none"}, stamp=lambda: "x")
    assert eng.effective("a")["panel.gene-set.external_requests"] == "none"
    assert eng.effective("a")["panel.gene-set.links"] is False


def test_an_overlay_cannot_widen_what_the_config_narrowed():
    eng = make_engine(REGISTRY, config={"integrations": {"external_requests": "off"}})
    update = eng.apply_update("overlay", {}, {"panel.gene-set.external_requests": "on"})
    assert update.errors == {"panel.gene-set.external_requests": "config_ceiling"}


def test_the_client_config_reports_none(tmp_path, monkeypatch):
    (tmp_path / "data").mkdir()
    monkeypatch.setenv("ANNZARRO_EXTERNAL_REQUESTS", "none")
    app = create_app({"TESTING": True, "host": "127.0.0.1", "data_dir": str(tmp_path / "data"),
                      "log_file": str(tmp_path / "t.log")})
    c = app.test_client()
    assert c.get("/api/v1/config").get_json()["integrations"]["external_requests"] == "none"
    values = c.get("/api/v1/policy/effective").get_json()["values"]
    assert values["panel.gene-set.external_requests"] == "none" and values["panel.gene-set.links"] is False


def test_the_schema_accepts_none():
    from annzarro.utils.config_manager import ConfigManager
    schema = ConfigManager.SCHEMA_PATH
    import yaml
    with open(schema) as fh:
        enum = yaml.safe_load(fh)["integrations"]["properties"]["external_requests"]["enum"]
    assert enum == ["ask", "on", "off", "none"]
