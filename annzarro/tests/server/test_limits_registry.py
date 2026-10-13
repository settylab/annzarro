"""Every resource limit is declared in the same places with the same default.

server/limits.py is the table. A limit missing from base.yaml, schema.yaml,
the built-in DEFAULT_CONFIG or the docs, or with a different default in one of
them, is a limit an operator cannot find or one that means two things.
"""
import os

import pytest
import yaml

from annzarro.server.core import DEFAULT_CONFIG
from annzarro.server.limits import LIMITS, validate_limits

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
CONFIG = os.path.join(ROOT, "annzarro", "config")


def _yaml(name):
    with open(os.path.join(CONFIG, name)) as fh:
        return yaml.safe_load(fh)


def _doc(*parts):
    with open(os.path.join(ROOT, "docs", *parts), encoding="utf-8") as fh:
        return fh.read()


@pytest.mark.parametrize("key", sorted(LIMITS))
def test_limit_is_declared_everywhere_with_one_default(key):
    limit = LIMITS[key]
    assert _yaml("base.yaml")["server"][key] == limit.default
    assert _yaml("schema.yaml")["server"]["properties"][key]["default"] == limit.default
    assert DEFAULT_CONFIG[key] == limit.default
    assert f"`{key}`" in _doc("reference", "configuration.md")
    assert f"`{key}`" in _doc("deployment", "resource-limits.md")


@pytest.mark.parametrize("key", sorted(LIMITS))
@pytest.mark.parametrize("bad", ["lots", -1, True, [1]])
def test_a_limit_that_is_not_a_number_is_refused(key, bad):
    assert validate_limits({key: bad}), f"{key}={bad!r} passed validation"


@pytest.mark.parametrize("key", sorted(LIMITS))
def test_the_default_validates(key):
    assert validate_limits({key: LIMITS[key].default}) == []


def test_config_validate_reports_a_bad_limit(tmp_path, monkeypatch):
    from annzarro.utils.config_manager import ConfigManager
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(ConfigManager, "SYSTEM_CONFIG_PATH", str(tmp_path / "none.yaml"))
    path = tmp_path / "site.yaml"
    path.write_text("server:\n  name_search_timeout_s: -3\n")
    mgr = ConfigManager()
    mgr.load_config(env="production", config_path=str(path))
    ok, errors = mgr.validate_config()
    assert not ok and any("name_search_timeout_s" in e for e in errors), errors


def test_create_app_refuses_a_bad_limit():
    from annzarro.server.core import create_app
    with pytest.raises(ValueError, match="name_search_max_regex_chars"):
        create_app({"TESTING": True, "auth_enabled": False, "name_search_max_regex_chars": "many"})
