"""
The schema's security tiers decide what is published and what is masked
(issue #32).

A guard clause in _parse_security_metadata returned at the schema root, so
no ``security:`` annotation was ever read; /api/v1/config then fell back to
a five-name denylist or a hand-written list (which published data_dir).
Every test here plants a unique value in keys of each tier and checks where
it may appear.
"""
import json
import os
import re

import pytest
import yaml

from annzarro import cli
from annzarro.server.core import create_app
from annzarro.utils.config_manager import ConfigManager


@pytest.fixture
def isolated(tmp_path, monkeypatch):
    for var in list(os.environ):
        if var.startswith("ANNZARRO_"):
            monkeypatch.delenv(var)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "home" / ".config"))
    monkeypatch.setattr(ConfigManager, "SYSTEM_CONFIG_PATH", str(tmp_path / "none.yaml"))
    (tmp_path / "cwd").mkdir()
    monkeypatch.chdir(tmp_path / "cwd")
    return tmp_path


def _leaves_by_tier():
    mgr = ConfigManager()
    tiers = {}
    for path in mgr._schema_key_paths():
        tiers.setdefault(mgr._get_security_level(".".join(path)), []).append(path)
    return tiers


def test_every_annotation_is_read():
    schema_text = open(ConfigManager.SCHEMA_PATH).read()
    annotated = len(re.findall(r"^\s+security:", schema_text, re.M))
    mgr = ConfigManager()
    mgr._load_schema()
    assert len(mgr._security_metadata) == annotated > 0


def test_section_annotation_is_inherited_and_unannotated_keys_are_internal():
    mgr = ConfigManager()
    assert mgr._get_security_level("branding.contact_info.email") == "public"
    assert mgr._get_security_level("ui.defaults.max_cells") == "public"
    assert mgr._get_security_level("auth.secret_key") == "sensitive"
    assert mgr._get_security_level("server.log_file") == "internal"
    assert mgr._get_security_level("server.debug") == "internal", "not in the schema at all"
    assert mgr._get_security_level("server.data_dir") == "internal"


def _is_free_string(path):
    """A leaf the schema types as a string without an enum (a canary fits)."""
    node = ConfigManager()._load_schema()
    for part in path:
        node = (node.get("properties") or {}).get(part) if "properties" in node else node.get(part)
        if node is None:
            return False
    types = node.get("type")
    types = types if isinstance(types, list) else [types]
    return "string" in types and "enum" not in node and not path[-1].startswith("remote_")


def _site_with_canaries(tmp_path):
    """A config file setting every free-text schema leaf to a unique string."""
    tree, canaries = {}, {}
    for tier, paths in _leaves_by_tier().items():
        for path in paths:
            if not _is_free_string(path):
                continue
            value = f"canary-{tier}-{'-'.join(path)}"
            node = tree
            for part in path[:-1]:
                node = node.setdefault(part, {})
            node[path[-1]] = value
            canaries[value] = tier
    # keys the routes and validation need to be usable
    tree.setdefault("server", {}).update({"port": 8000, "host": "127.0.0.1",
                           "data_dir": str(tmp_path / "data-canary-internal"),
                           "log_file": str(tmp_path / "log-canary-internal.log")})
    tree.setdefault("auth", {})["user_file"] = str(tmp_path / "users-canary-internal.json")
    tree["auth"]["enabled"] = False
    canaries = {v: t for v, t in canaries.items()
                if not any(v.endswith(k) for k in ("server-host", "server-data_dir",
                                                   "server-log_file", "auth-user_file"))}
    path = tmp_path / "site.yaml"
    path.write_text(yaml.safe_dump(tree))
    return str(path), canaries


def test_config_endpoint_serves_public_keys_only(isolated):
    site, canaries = _site_with_canaries(isolated)
    mgr = ConfigManager()
    mgr.load_config(env="production", config_path=site)
    body = create_app(mgr.to_flask_config()).test_client().get("/api/v1/config").get_data(as_text=True)
    for value, tier in canaries.items():
        if tier == "public":
            assert value in body, f"public {value} not served"
        else:
            assert value not in body, f"{tier} {value} served"
    for internal in ("data-canary-internal", "log-canary-internal", "users-canary-internal"):
        assert internal not in body


def test_config_endpoint_without_the_manager_is_filtered_too(isolated):
    app = create_app({"TESTING": True, "data_dir": str(isolated / "data-canary"),
                      "log_file": str(isolated / "l.log"), "secret_key": "secret-canary",
                      "cert_file": "/x/cert-canary.pem", "app_name": "Name-canary"})
    body = app.test_client().get("/api/v1/config").get_data(as_text=True)
    assert "Name-canary" in body
    for leak in ("data-canary", "secret-canary", "cert-canary", "l.log"):
        assert leak not in body


def test_sensitive_values_are_never_printed(isolated, capsys, monkeypatch):
    site, canaries = _site_with_canaries(isolated)
    sensitive = [v for v, t in canaries.items() if t == "sensitive"]
    assert sensitive, "the schema marks some keys sensitive"
    for fmt in ("yaml", "json"):
        cli.main(["config", "show", "--config", site, "--format", fmt])
        out = capsys.readouterr().out
        for value in sensitive:
            assert value not in out
    # through the environment as well
    for path in _leaves_by_tier()["sensitive"]:
        monkeypatch.setenv("ANNZARRO_" + "_".join(path).upper(), f"env-canary-{'-'.join(path)}")
    cli.main(["config", "info", "--config", site])
    cli.main(["config", "show", "--config", site])
    out = capsys.readouterr().out
    assert "env-canary" not in out


def test_filtering_fails_closed_without_a_schema(isolated, monkeypatch):
    monkeypatch.setattr(ConfigManager, "SCHEMA_PATH", str(isolated / "missing.yaml"))
    mgr = ConfigManager()
    mgr.load_config(env="production")
    assert mgr.get_filtered_config("public") == {}
    assert mgr.get_filtered_config("internal") == {}
