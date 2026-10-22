"""Every resource limit is declared in the same places with the same default.

server/limits.py is the table. A limit missing from base.yaml, schema.yaml,
the built-in DEFAULT_CONFIG or the docs, or with a different default in one of
them, is a limit an operator cannot find or one that means two things.
"""
import os

import pytest
import yaml

from annzarro.server.core import DEFAULT_CONFIG
from annzarro.server.limits import DEPRECATED, LIMITS, deprecated_settings, validate_limits

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


@pytest.mark.parametrize("key", sorted(DEPRECATED))
def test_a_setting_that_was_removed_is_not_a_limit_and_is_not_in_the_defaults(key):
    assert key not in LIMITS and key not in DEFAULT_CONFIG
    assert key not in _yaml("base.yaml")["server"] and key not in _yaml("schema.yaml")["server"]["properties"]


def test_the_settings_removed_after_0_7_2_are_still_accepted_with_a_warning(tmp_path, monkeypatch, caplog):
    from annzarro.utils.config_manager import ConfigManager
    assert set(DEPRECATED) == {"text_index_background", "text_index_crawl_timeout_s", "text_index_min_interval_s"}
    server = {"text_index_background": False, "text_index_crawl_timeout_s": 300, "text_index_min_interval_s": 60, "text_index_workers": 4}
    assert validate_limits(server) == []                      # no error: 0.7.2 configs keep working
    assert [w.split(" ")[0] for w in deprecated_settings(server)] == [f"server.{k}" for k in DEPRECATED]
    assert all("no longer used" in w for w in deprecated_settings(server)) and deprecated_settings({"text_index_workers": 4}) == []
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(ConfigManager, "SYSTEM_CONFIG_PATH", str(tmp_path / "none.yaml"))
    path = tmp_path / "site.yaml"
    path.write_text("server:\n  text_index_min_interval_s: 30\n")
    mgr = ConfigManager()
    mgr.load_config(env="production", config_path=str(path))
    with caplog.at_level("WARNING"):
        ok, errors = mgr.validate_config()
    assert ok, errors
    assert any("server.text_index_min_interval_s is no longer used" in r.getMessage() for r in caplog.records)


def test_a_server_starts_with_a_removed_setting_and_says_so(tmp_path, caplog):
    from annzarro.server.core import create_app
    with caplog.at_level("WARNING", logger="annzarro.server.core"):
        app = create_app({"TESTING": True, "data_dir": str(tmp_path), "log_file": str(tmp_path / "t.log"),
                          "text_index_background": False, "text_index_crawl_timeout_s": 5})
    assert app is not None
    said = [r.getMessage() for r in caplog.records if "no longer used" in r.getMessage()]
    assert len(said) == 2 and "server.text_index_background" in said[0]
