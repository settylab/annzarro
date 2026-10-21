"""Where annzarro keeps its state: precedence of the three location keys, the guard against
state inside a data root, ``annzarro paths`` and the ``./config.yaml`` deprecation."""
import argparse
import json
import logging
import os

import pytest
import yaml

from annzarro import cli
from annzarro.utils import paths
from annzarro.utils.config_manager import ConfigManager


@pytest.fixture(autouse=True)
def isolated(tmp_path, monkeypatch):
    for var in list(os.environ):
        if var.startswith("ANNZARRO_"):
            monkeypatch.delenv(var)
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(home / ".config"))
    monkeypatch.setattr(ConfigManager, "SYSTEM_CONFIG_PATH", str(tmp_path / "etc" / "config.yaml"))
    cwd = tmp_path / "cwd"
    cwd.mkdir()
    monkeypatch.chdir(cwd)
    paths.set_state_dir(None)
    yield tmp_path
    paths.set_state_dir(None)


def _write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(data))
    return str(path)


def _load(config_path=None, **flags):
    manager = ConfigManager()
    args = argparse.Namespace(**flags) if flags else None
    manager.load_config(env="production", config_path=config_path, cli_args=args)
    return manager


def _state(manager):
    return manager.config["server"]["state_dir"]


def test_default_state_dir_is_dot_annzarro(isolated):
    manager = _load()
    assert _state(manager) == str(isolated / "home" / ".annzarro")
    assert manager.config["server"]["cache_dir"] == str(isolated / "home" / ".annzarro" / "cache")
    assert manager.config["server"]["panel_sets_dir"] == str(isolated / "home" / ".annzarro" / "panel-sets")
    assert paths.user_state_dir() == isolated / "home" / ".annzarro"


def test_config_beats_default(isolated):
    cfg = _write(isolated / "site.yaml", {"server": {"state_dir": str(isolated / "cfg")}})
    manager = _load(cfg)
    assert _state(manager) == str(isolated / "cfg")
    assert paths.user_state_dir() == isolated / "cfg"
    assert manager.config["server"]["cache_dir"] == str(isolated / "cfg" / "cache")


def test_env_beats_config(isolated, monkeypatch):
    cfg = _write(isolated / "site.yaml", {"server": {"state_dir": str(isolated / "cfg")}})
    monkeypatch.setenv("ANNZARRO_SERVER_STATE_DIR", str(isolated / "env"))
    assert _state(_load(cfg)) == str(isolated / "env")


def test_annzarro_home_is_an_alias(isolated, monkeypatch):
    cfg = _write(isolated / "site.yaml", {"server": {"state_dir": str(isolated / "cfg")}})
    monkeypatch.setenv("ANNZARRO_HOME", str(isolated / "home-env"))
    manager = _load(cfg)
    assert _state(manager) == str(isolated / "home-env")
    assert manager.origins["server.state_dir"] == "env:ANNZARRO_HOME"


def test_flag_beats_env_and_config(isolated, monkeypatch):
    cfg = _write(isolated / "site.yaml", {"server": {"state_dir": str(isolated / "cfg")}})
    monkeypatch.setenv("ANNZARRO_HOME", str(isolated / "home-env"))
    manager = _load(cfg, state_dir=str(isolated / "flag"))
    assert _state(manager) == str(isolated / "flag")
    assert paths.user_state_dir() == isolated / "flag"


def test_flag_equal_to_the_default_still_wins(isolated):
    cfg = _write(isolated / "site.yaml", {"server": {"state_dir": str(isolated / "cfg")}})
    default = str(isolated / "home" / ".annzarro")
    assert _state(_load(cfg, state_dir=default)) == default


def test_both_env_names_set_and_different_is_an_error(isolated, monkeypatch):
    monkeypatch.setenv("ANNZARRO_HOME", str(isolated / "a"))
    monkeypatch.setenv("ANNZARRO_SERVER_STATE_DIR", str(isolated / "b"))
    with pytest.raises(ValueError, match="only one"):
        _load()


def test_both_env_names_set_and_equal_is_fine(isolated, monkeypatch):
    monkeypatch.setenv("ANNZARRO_HOME", str(isolated / "a"))
    monkeypatch.setenv("ANNZARRO_SERVER_STATE_DIR", str(isolated / "a"))
    assert _state(_load()) == str(isolated / "a")


def test_cache_and_panel_sets_dirs_come_from_config_and_env(isolated, monkeypatch):
    cfg = _write(isolated / "site.yaml", {"server": {"cache_dir": str(isolated / "c")}})
    monkeypatch.setenv("ANNZARRO_SERVER_PANEL_SETS_DIR", str(isolated / "ps"))
    manager = _load(cfg)
    assert manager.config["server"]["cache_dir"] == str(isolated / "c")
    assert paths.cache_dir() == isolated / "c"
    assert paths.panel_sets_dir() == isolated / "ps"


def test_env_state_dir_without_config_load(isolated, monkeypatch):
    monkeypatch.setenv("ANNZARRO_HOME", str(isolated / "x"))
    assert paths.user_state_dir() == isolated / "x"
    assert paths.pid_file() == isolated / "x" / "server.pid"


# the warning

@pytest.mark.parametrize("key", ["state_dir", "cache_dir", "panel_sets_dir"])
def test_location_inside_the_data_dir_warns(isolated, key):
    data = isolated / "data"
    data.mkdir()
    cfg = _write(isolated / "site.yaml", {"server": {"data_dir": str(data), key: str(data / "state")}})
    warnings = paths.state_dir_warnings(_load(cfg).config["server"])
    assert len(warnings) == 1
    assert f"server.{key}" in warnings[0] and "inside the data root" in warnings[0] and "--state-dir" in warnings[0]


def test_equal_to_the_data_dir_and_inside_allowed_dirs_warn(isolated):
    data, extra = isolated / "data", isolated / "extra"
    data.mkdir(), extra.mkdir()
    cfg = _write(isolated / "site.yaml", {"server": {
        "data_dir": str(data), "allowed_dirs": [str(extra)], "state_dir": str(data),
        "cache_dir": str(extra / "c")}})
    assert len(paths.state_dir_warnings(_load(cfg).config["server"])) == 2


def test_symlinked_state_dir_into_a_data_root_warns(isolated):
    data = isolated / "data"
    data.mkdir()
    (isolated / "link").symlink_to(data)
    cfg = _write(isolated / "site.yaml", {"server": {"data_dir": str(data), "state_dir": str(isolated / "link")}})
    assert paths.state_dir_warnings(_load(cfg).config["server"])


def test_siblings_and_data_inside_state_are_fine(isolated):
    cfg = _write(isolated / "site.yaml", {"server": {
        "data_dir": str(isolated / "data"), "state_dir": str(isolated / "data-state")}})
    assert paths.state_dir_warnings(_load(cfg).config["server"]) == []


def test_data_dir_equal_to_home_with_the_default_state_warns_and_starts(isolated):
    warnings = paths.state_dir_warnings(_load(None, data_dir=str(isolated / "home")).config["server"])
    assert len(warnings) == 1 and ".annzarro" in warnings[0]


def test_start_warns_and_goes_on(isolated, caplog, monkeypatch):
    data = isolated / "data"
    data.mkdir()
    cfg = _write(isolated / "site.yaml", {"server": {"data_dir": str(data), "state_dir": str(data / "s")}})
    started = []
    monkeypatch.setattr(cli, "run_server", lambda **kw: started.append(kw))
    args = argparse.Namespace(host=None, port=None, data_dir=None, state_dir=None, auth_disabled=False,
                              detach=False, no_browser=True, development=False, venv_path=None, config=cfg)
    with caplog.at_level(logging.WARNING):
        assert cli.start_server(args) == 0
    assert started
    assert "inside the data root" in caplog.text and "--state-dir" in caplog.text


def test_listings_leave_out_state_folders_inside_a_data_root(isolated):
    from annzarro.server import panel_sets
    data = isolated / "data"
    (data / "state" / "cache").mkdir(parents=True)
    (data / "keep").mkdir()
    config = {"data_dir": str(data), "state_dir": str(data / "state"),
              "panel_sets_dir": str(isolated / "elsewhere"), "cache_dir": str(data / "state" / "cache")}
    assert panel_sets.state_folders_in(config, str(data)) == ("state",)
    assert panel_sets.state_folders_in(config, str(data / "state")) == ("cache",)


# annzarro paths

def _run_paths(capsys, *argv):
    code = cli.main(["paths", *argv])
    return code, capsys.readouterr().out


def test_paths_lists_every_location_with_its_origin(isolated, capsys, monkeypatch):
    cfg = _write(isolated / "site.yaml", {"server": {"data_dir": str(isolated / "data"),
                                                       "cache_dir": str(isolated / "cache-x")}})
    monkeypatch.setenv("ANNZARRO_HOME", str(isolated / "envhome"))
    code, out = _run_paths(capsys, "--config", cfg, "--format", "json")
    assert code == 0
    report = json.loads(out)
    by_label = {loc["label"]: loc for loc in report["locations"]}
    assert by_label["state directory"]["path"] == str(isolated / "envhome")
    assert by_label["state directory"]["why"] == "environment variable ANNZARRO_HOME"
    assert by_label["data directory"]["why"] == f"config key server.data_dir in {cfg}"
    assert by_label["cache"]["why"].startswith("config key server.cache_dir")
    assert by_label["panel sets"]["path"] == str(isolated / "envhome" / "panel-sets")
    assert by_label["panel sets"]["why"] == "default (state dir)"
    assert by_label["log file"]["path"] == str(isolated / "envhome" / "logs" / "annzarro_server.log")
    assert by_label["PID file"]["path"] == str(isolated / "envhome" / "server.pid")
    assert by_label["users file"]["path"] == str(isolated / "envhome" / "auth" / "users.json")
    assert by_label["admin state"]["path"].endswith(os.path.join("auth", "annzarro_admin"))
    assert any(f["layer"] == "--config" and f["found"] for f in report["config_files"])


def test_paths_names_the_flag_and_the_default(isolated, capsys):
    code, out = _run_paths(capsys, "--state-dir", str(isolated / "flag"))
    assert code == 0
    assert f"{isolated / 'flag'}" in out and "flag --state-dir" in out
    assert "default" in out and "(not found)" in out


def test_paths_lists_warnings_and_exits_0(isolated, capsys):
    code, out = _run_paths(capsys, "--data-dir", str(isolated / "d"), "--state-dir", str(isolated / "d" / "s"))
    assert code == 0
    assert "Warnings:" in out and "inside the data root" in out


def test_paths_reports_a_missing_config_file(isolated, capsys):
    code = cli.main(["paths", "--config", str(isolated / "nope.yaml")])
    assert code == 1
    assert "not found" in capsys.readouterr().err


def test_stop_takes_state_dir(isolated, caplog):
    args = argparse.Namespace(state_dir=str(isolated / "elsewhere"))
    with caplog.at_level(logging.ERROR):
        assert cli.stop_server(args) == 1
    assert str(isolated / "elsewhere" / "server.pid") in caplog.text


# ./config.yaml

def test_project_config_still_works_but_is_deprecated(isolated, caplog):
    _write(isolated / "cwd" / "config.yaml", {"server": {"port": 9123}})
    with caplog.at_level(logging.WARNING):
        manager = _load()
    assert manager.config["server"]["port"] == 9123
    text = caplog.text
    assert str(isolated / "cwd" / "config.yaml") in text
    assert "stops working in 0.8" in text and "--config" in text and "ANNZARRO_CONFIG" in text


def test_no_deprecation_warning_without_a_project_file(isolated, caplog):
    with caplog.at_level(logging.WARNING):
        _load()
    assert "stops working in 0.8" not in caplog.text


def test_systemd_directories_replace_only_the_defaults(isolated, monkeypatch):
    monkeypatch.setenv("STATE_DIRECTORY", "/var/lib/annzarro")
    monkeypatch.setenv("CACHE_DIRECTORY", "/var/cache/annzarro")
    manager = _load()
    server = manager.config["server"]
    assert server["state_dir"] == "/var/lib/annzarro"
    assert server["cache_dir"] == "/var/cache/annzarro"
    assert server["panel_sets_dir"] == "/var/lib/annzarro/panel-sets"
    assert manager.origins["server.state_dir"] == "derived:$STATE_DIRECTORY"
    assert paths.user_state_dir() == paths.Path("/var/lib/annzarro")
    assert paths.cache_dir() == paths.Path("/var/cache/annzarro")


def test_systemd_directories_lose_to_config_env_and_flag(isolated, monkeypatch):
    monkeypatch.setenv("STATE_DIRECTORY", "/var/lib/annzarro")
    monkeypatch.setenv("CACHE_DIRECTORY", "/var/cache/annzarro")
    cfg = _write(isolated / "site.yaml", {"server": {"state_dir": str(isolated / "cfg"),
                                                     "cache_dir": str(isolated / "cfgcache")}})
    manager = _load(cfg)
    assert _state(manager) == str(isolated / "cfg")
    assert manager.config["server"]["cache_dir"] == str(isolated / "cfgcache")

    monkeypatch.setenv("ANNZARRO_SERVER_STATE_DIR", str(isolated / "env"))
    assert _state(_load()) == str(isolated / "env")
    monkeypatch.delenv("ANNZARRO_SERVER_STATE_DIR")

    monkeypatch.setenv("ANNZARRO_HOME", str(isolated / "home-alias"))
    assert _state(_load()) == str(isolated / "home-alias")
    monkeypatch.delenv("ANNZARRO_HOME")

    manager = _load(state_dir=str(isolated / "flag"))
    assert _state(manager) == str(isolated / "flag")
    # the cache directory is not named by the flag, so systemd's still applies
    assert manager.config["server"]["cache_dir"] == "/var/cache/annzarro"


def test_systemd_directory_takes_the_first_of_several_and_ignores_relative(monkeypatch):
    monkeypatch.setenv("STATE_DIRECTORY", "/var/lib/annzarro:/var/lib/other")
    assert paths.systemd_dir("STATE_DIRECTORY") == "/var/lib/annzarro"
    monkeypatch.setenv("STATE_DIRECTORY", "relative/dir")
    assert paths.systemd_dir("STATE_DIRECTORY") is None
    monkeypatch.delenv("STATE_DIRECTORY")
    assert paths.systemd_dir("STATE_DIRECTORY") is None


def test_without_systemd_the_default_stands(isolated):
    assert _load().origins["server.state_dir"].startswith("defaults:")
