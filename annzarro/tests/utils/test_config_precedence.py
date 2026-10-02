"""Configuration layering: where defaults come from and who overrides whom.

Regression net for the startup bug where `annzarro start --data-dir D --port P`
run from any directory but the checkout died with "Missing required
configuration: server.host / server.port / server.data_dir": the defaults were
read relative to the CWD, and --data-dir/--host were written to `data.dir` and
`host` instead of `server.*`.

Every test runs from an empty temporary CWD with HOME, XDG_CONFIG_HOME,
ANNZARRO_HOME and the system config path pointed into tmp, so nothing on the
developer's machine leaks in.
"""
import argparse
import os

import pytest
import yaml

from annzarro import cli
from annzarro.utils.config_manager import ConfigManager


@pytest.fixture
def isolated(tmp_path, monkeypatch):
    """Empty CWD, private HOME/XDG/state dir, no system config, no ANNZARRO_* vars."""
    for var in list(os.environ):
        if var.startswith("ANNZARRO_"):
            monkeypatch.delenv(var)
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(home / ".config"))
    monkeypatch.setenv("ANNZARRO_HOME", str(home / ".annzarro"))
    monkeypatch.setattr(ConfigManager, "SYSTEM_CONFIG_PATH", str(tmp_path / "etc" / "config.yaml"))
    cwd = tmp_path / "cwd"
    cwd.mkdir()
    monkeypatch.chdir(cwd)
    return tmp_path


def _write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(data))
    return path


def _args(**kw):
    base = dict(host=None, port=None, data_dir=None, auth_disabled=False,
                detach=False, no_browser=True, development=False, venv_path=None)
    base.update(kw)
    return argparse.Namespace(**base)


def _user_config(tmp):
    return tmp / "home" / ".config" / "annzarro" / "config.yaml"


@pytest.mark.parametrize("env", ["production", "development"])
def test_defaults_load_from_an_unrelated_cwd(isolated, env):
    mgr = ConfigManager()
    config = mgr.load_config(env=env)
    assert config["server"]["host"] == "127.0.0.1"
    assert isinstance(config["server"]["port"], int)
    assert config["server"]["data_dir"]
    assert mgr.validate_config() == (True, [])
    assert mgr.sources["defaults:base"].endswith(os.path.join("annzarro", "config", "base.yaml"))


def test_production_defaults_do_not_run_the_flask_debugger(isolated):
    assert ConfigManager().load_config(env="production")["server"]["debug"] is False
    assert ConfigManager().load_config(env="development")["server"]["debug"] is True


def test_default_start_trusts_no_proxy_headers(isolated):
    # A plain `annzarro start` has no reverse proxy in front of it; trusting
    # X-Forwarded-* there lets any client choose its own address, and remote
    # stores refuse to run "behind a proxy" that does not exist.
    for env in ("production", "development"):
        assert ConfigManager().load_config(env=env)["server"]["proxy_count"] == 0


def test_cli_flags_set_server_keys_and_nothing_else(isolated, tmp_path):
    mgr = ConfigManager()
    config = mgr.load_config(env="production", cli_args=_args(
        host="127.0.0.1", port=8010, data_dir=str(tmp_path / "d"), auth_disabled=True))
    assert config["server"]["port"] == 8010
    assert config["server"]["data_dir"] == str(tmp_path / "d")
    assert config["auth"]["enabled"] is False
    # The old generic mapping produced these; nothing reads them.
    for stray in ("host", "port", "data", "no", "detach", "auth_disabled", "development"):
        assert stray not in config, stray
    assert mgr.origins["server.port"] == "cli:--port"
    assert mgr.origins["server.data_dir"] == "cli:--data-dir"


def test_start_flags_survive_validation_without_any_config_file(isolated, tmp_path, monkeypatch):
    """The reported failure, at the CLI layer: only flags, no files, from a temp CWD."""
    seen = {}

    def fake_run_server(config_file, detach, no_browser, detach_args):
        seen.update(config_file=config_file, no_browser=no_browser)

    monkeypatch.setattr(cli, "run_server", fake_run_server)
    data = tmp_path / "data"
    rc = cli.main(["start", "--data-dir", str(data), "--port", "8010",
                   "--no-browser", "--auth-disabled"])
    assert rc == 0
    flat = seen["config_file"]
    assert flat["port"] == 8010
    assert flat["data_dir"] == str(data)
    assert flat["host"] == "127.0.0.1"
    assert flat["auth_enabled"] is False
    assert seen["no_browser"] is True


@pytest.mark.parametrize("host", ["0.0.0.0", "10.1.2.3"])
def test_non_loopback_host_forces_auth_unless_disabled(isolated, host):
    mgr = ConfigManager()
    assert mgr.load_config(env="production", cli_args=_args(host=host))["auth"]["enabled"] is True
    assert mgr.origins["auth.enabled"] == "derived:non-loopback host"
    mgr = ConfigManager()
    config = mgr.load_config(env="production", cli_args=_args(host=host, auth_disabled=True))
    assert config["auth"]["enabled"] is False


def test_precedence_cli_over_env_over_config_file_over_user_over_defaults(isolated, tmp_path, monkeypatch):
    default_port = ConfigManager().load_config(env="production")["server"]["port"]

    _write(_user_config(tmp_path), {"server": {"port": 9001, "log_level": "WARNING"}})
    mgr = ConfigManager()
    assert mgr.load_config(env="production")["server"]["port"] == 9001
    assert mgr.origins["server.port"] == "user"
    assert default_port != 9001

    explicit = _write(tmp_path / "explicit.yaml", {"server": {"port": 9002}})
    mgr = ConfigManager()
    config = mgr.load_config(env="production", config_path=str(explicit))
    assert config["server"]["port"] == 9002
    assert mgr.origins["server.port"] == "--config"
    # Keys the --config file does not mention keep their lower-layer value.
    assert config["server"]["log_level"] == "WARNING"

    monkeypatch.setenv("ANNZARRO_SERVER_PORT", "9003")
    mgr = ConfigManager()
    assert mgr.load_config(env="production", config_path=str(explicit))["server"]["port"] == 9003
    assert mgr.origins["server.port"] == "env:ANNZARRO_SERVER_PORT"

    mgr = ConfigManager()
    config = mgr.load_config(env="production", config_path=str(explicit), cli_args=_args(port=9004))
    assert config["server"]["port"] == 9004
    assert mgr.origins["server.port"] == "cli:--port"
    names = [layer["name"] for layer in mgr.layers]
    assert names == ["defaults:base", "defaults:production", "system", "user",
                     "project", "--config", "env", "cli"]


def test_project_file_sits_between_user_and_explicit(isolated, tmp_path):
    _write(_user_config(tmp_path), {"server": {"port": 9001}})
    _write(tmp_path / "cwd" / "config.yaml", {"server": {"port": 9005}})
    mgr = ConfigManager()
    assert mgr.load_config(env="production")["server"]["port"] == 9005
    assert mgr.origins["server.port"] == "project"


def test_env_vars_map_onto_keys_with_underscores(isolated, tmp_path, monkeypatch):
    monkeypatch.setenv("ANNZARRO_SERVER_DATA_DIR", str(tmp_path / "envdata"))
    monkeypatch.setenv("ANNZARRO_UI_DEFAULTS_MAX_CELLS", "42")
    monkeypatch.setenv("ANNZARRO_NOT_A_KEY", "x")
    monkeypatch.setenv("ANNZARRO_HEADLESS", "1")
    mgr = ConfigManager()
    config = mgr.load_config(env="production")
    assert config["server"]["data_dir"] == str(tmp_path / "envdata")
    assert config["ui"]["defaults"]["max_cells"] == 42
    assert "data" not in config["server"]
    assert "not" not in config and "headless" not in config
    ignored = [l for l in mgr.layers if l["status"] == "ignored"]
    assert [l["path"] for l in ignored] == ["ANNZARRO_NOT_A_KEY"]


def test_env_vars_reach_auth_keys_the_defaults_leave_unset(isolated, monkeypatch):
    """auth.enabled / auth.secret_key are absent from base.yaml on purpose;
    their variables used to be silently ignored."""
    monkeypatch.setenv("ANNZARRO_AUTH_ENABLED", "true")
    monkeypatch.setenv("ANNZARRO_AUTH_SECRET_KEY", "0123456789")
    monkeypatch.setenv("ANNZARRO_SERVER_ALLOWED_DIRS", "/srv/a, /srv/b")
    mgr = ConfigManager()
    config = mgr.load_config(env="production")
    assert config["auth"]["enabled"] is True
    assert config["auth"]["secret_key"] == "0123456789"
    assert config["server"]["allowed_dirs"] == ["/srv/a", "/srv/b"]
    assert mgr.origins["auth.enabled"] == "env:ANNZARRO_AUTH_ENABLED"
    assert not [l for l in mgr.layers if l["status"] == "ignored"]
    assert mgr.to_flask_config()["auth_enabled"] is True


def test_remote_env_vars_are_reported_as_used_not_ignored(isolated, monkeypatch):
    """core/remote.py reads ANNZARRO_REMOTE_*; `config show` called them ignored."""
    from annzarro.core import remote
    names = [remote.ENV_MODE, remote.ENV_ALLOWLIST, remote.ENV_CREDENTIALS,
             remote.ENV_CONNECT_TIMEOUT, remote.ENV_READ_TIMEOUT, remote.ENV_CHUNK_CACHE]
    assert set(names) == set(ConfigManager.ENV_ALIASES)
    monkeypatch.setenv(remote.ENV_MODE, "allow")
    monkeypatch.setenv(remote.ENV_ALLOWLIST, "s3://a/,https://b/")
    monkeypatch.setenv(remote.ENV_CONNECT_TIMEOUT, "5")
    mgr = ConfigManager()
    config = mgr.load_config(env="production")
    assert not [l for l in mgr.layers if l["status"] == "ignored"]
    assert config["server"]["remote_stores"] == "allow"
    assert config["server"]["remote_allowlist"] == ["s3://a/", "https://b/"]
    assert config["server"]["remote_connect_timeout_s"] == 5
    assert mgr.origins["server.remote_stores"] == "env:ANNZARRO_REMOTE_STORES"
    # the merged config alone gives the policy the variables give
    flat = mgr.to_flask_config()
    from_config = remote.RemotePolicy.from_config(flat, environ={})
    from_env = remote.RemotePolicy.from_config(flat)
    assert from_config == from_env


def test_entry_point_switches_are_not_reported_as_ignored(isolated, monkeypatch):
    monkeypatch.setenv("ANNZARRO_ENV", "production")
    monkeypatch.setenv("ANNZARRO_CONFIG", "/nonexistent.yaml")
    mgr = ConfigManager()
    mgr.load_config(env="production")
    assert not [l for l in mgr.layers if l["status"] == "ignored"]


def test_auth_disabled_env_var(isolated, monkeypatch):
    monkeypatch.setenv("ANNZARRO_AUTH_DISABLED", "1")
    mgr = ConfigManager()
    assert mgr.load_config(env="production", cli_args=_args(host="0.0.0.0"))["auth"]["enabled"] is False
    monkeypatch.setenv("ANNZARRO_AUTH_DISABLED", "0")
    mgr = ConfigManager()
    assert mgr.load_config(env="production", cli_args=_args(host="0.0.0.0"))["auth"]["enabled"] is True


def test_missing_or_broken_explicit_config_is_an_error(isolated, tmp_path):
    with pytest.raises(FileNotFoundError):
        ConfigManager().load_config(env="production", config_path=str(tmp_path / "nope.yaml"))
    broken = tmp_path / "broken.yaml"
    broken.write_text("server: [unclosed\n")
    with pytest.raises(ValueError):
        ConfigManager().load_config(env="production", config_path=str(broken))


def test_cli_exits_nonzero_on_missing_config_file(isolated, tmp_path):
    with pytest.raises(SystemExit) as exc:
        cli.main(["config", "show", "--config", str(tmp_path / "nope.yaml")])
    assert exc.value.code == 1


def test_validation_sees_the_merged_result(isolated, tmp_path):
    bad = _write(tmp_path / "bad.yaml", {"server": {"port": "eighty"}})
    mgr = ConfigManager()
    mgr.load_config(env="production", config_path=str(bad))
    ok, errors = mgr.validate_config()
    assert not ok and any("server.port" in e for e in errors)
    # ...and a CLI flag that fixes it is applied before validation runs.
    mgr = ConfigManager()
    mgr.load_config(env="production", config_path=str(bad), cli_args=_args(port=8010))
    assert mgr.validate_config() == (True, [])


def test_reloading_starts_from_scratch(isolated):
    mgr = ConfigManager()
    mgr.load_config(env="production", cli_args=_args(port=8010))
    assert mgr.load_config(env="production")["server"]["port"] != 8010
    assert "server.port" not in mgr.origins or mgr.origins["server.port"].startswith("defaults")


@pytest.mark.parametrize("argv,expected", [
    (["--config", "a.yaml", "start"], "a.yaml"),
    (["start", "--config", "b.yaml"], "b.yaml"),
    (["start"], None),
])
def test_config_flag_before_or_after_subcommand(isolated, monkeypatch, argv, expected):
    seen = {}

    def fake_start(args):
        seen["config"] = args.config
        return 0

    monkeypatch.setattr(cli, "start_server", fake_start)
    assert cli.main(argv) == 0
    assert seen["config"] == expected


# --- Session secret ----------------------------------------------------------

def test_configured_secret_passes_through_untouched(isolated, tmp_path):
    # Generating or rejecting session secrets is annzarro.server.secret_key's
    # job (tested in tests/server/test_secret_key.py); the config layer only
    # carries an operator-supplied key through and never writes a key file.
    explicit = _write(tmp_path / "c.yaml", {"auth": {"secret_key": "s3cr3t-from-ops"}})
    config = ConfigManager().load_config(env="production", config_path=str(explicit),
                                         cli_args=_args(host="0.0.0.0"))
    assert config["auth"]["secret_key"] == "s3cr3t-from-ops"
    assert not (tmp_path / "home" / ".annzarro" / "secret_key").exists()


# --- `annzarro config show` --------------------------------------------------

def test_config_show_reports_effective_values_and_sources(isolated, tmp_path, capsys):
    _write(_user_config(tmp_path), {"server": {"log_level": "WARNING"}})
    explicit = _write(tmp_path / "explicit.yaml", {"server": {"port": 9002}})
    rc = cli.main(["config", "show", "--config", str(explicit), "--data-dir", "/srv/d"])
    out = capsys.readouterr().out
    assert rc == 0
    body = yaml.safe_load(out)  # the comments must not break the YAML document
    assert body["server"]["port"] == 9002
    assert body["server"]["data_dir"] == "/srv/d"
    assert body["auth"].get("secret_key") in (None, ConfigManager.MASK)
    assert "# Sources, lowest to highest precedence:" in out
    assert "defaults:base" in out and "not found" in out
    assert "server.port" in out and "<- --config" in out
    assert "server.log_level" in out and "<- user" in out
    assert "<- cli:--data-dir" in out


def test_config_show_json_and_invalid_exit_code(isolated, tmp_path, capsys):
    import json
    bad = _write(tmp_path / "bad.yaml", {"server": {"port": 0}})
    rc = cli.main(["config", "show", "--format", "json", "--config", str(bad)])
    doc = json.loads(capsys.readouterr().out)
    assert rc == 1 and doc["valid"] is False
    assert doc["origins"]["server.port"] == "--config"
    assert [s["name"] for s in doc["sources"]][:2] == ["defaults:base", "defaults:production"]
    assert doc["config"]["auth"].get("secret_key") in (None, ConfigManager.MASK)


# --- Where runtime state goes ------------------------------------------------

def test_log_file_defaults_to_the_user_state_dir(isolated, tmp_path):
    mgr = ConfigManager()
    config = mgr.load_config(env="production")
    expected = tmp_path / "home" / ".annzarro" / "logs" / "annzarro_server.log"
    assert config["server"]["log_file"] == str(expected)
    assert mgr.to_flask_config()["log_file"] == str(expected)
    assert mgr.origins["server.log_file"] == "derived:user state dir"


def test_explicit_log_file_is_kept(isolated, tmp_path):
    explicit = _write(tmp_path / "c.yaml", {"server": {"log_file": "~/x/annzarro.log"}})
    config = ConfigManager().load_config(env="production", config_path=str(explicit))
    assert config["server"]["log_file"] == os.path.expanduser("~/x/annzarro.log")


def test_user_file_never_points_into_the_package(isolated, tmp_path, monkeypatch):
    from annzarro.utils import paths
    monkeypatch.setattr(paths, "source_checkout_root", lambda: None)  # as in a wheel
    config = ConfigManager().load_config(env="production")
    assert config["auth"]["user_file"] == str(tmp_path / "home" / ".annzarro" / "auth" / "users.json")
    rel = _write(tmp_path / "c.yaml", {"auth": {"user_file": "auth/team.json"}})
    config = ConfigManager().load_config(env="production", config_path=str(rel))
    assert config["auth"]["user_file"] == str(tmp_path / "home" / ".annzarro" / "auth" / "team.json")
    assert not config["auth"]["user_file"].startswith(str(paths.PACKAGE_DIR))


def test_server_logging_writes_to_the_state_dir(isolated, tmp_path):
    import logging
    from annzarro.server.core import setup_logging
    root = logging.getLogger("")
    saved = root.handlers[:], root.level
    try:
        setup_logging({"log_level": "INFO"})
        assert (tmp_path / "home" / ".annzarro" / "logs" / "annzarro_server.log").is_file()
        assert not any((tmp_path / "cwd").iterdir()), "nothing may be written to the CWD"
    finally:
        for h in root.handlers[:]:
            root.removeHandler(h)
            h.close()
        for h in saved[0]:
            root.addHandler(h)
        root.setLevel(saved[1])


def test_env_vars_reach_keys_only_the_schema_declares(isolated, monkeypatch, tmp_path):
    """A key in schema.yaml but not in base.yaml (its absence meaning a default
    like "auto") can be set from the environment too."""
    schema = tmp_path / "schema.yaml"
    schema.write_text(yaml.safe_dump({
        "server": {"type": "object", "properties": {
            "compress_responses": {"type": "string", "default": "auto"}}}}))
    monkeypatch.setattr(ConfigManager, "SCHEMA_PATH", str(schema))
    monkeypatch.setenv("ANNZARRO_SERVER_COMPRESS_RESPONSES", "false")
    mgr = ConfigManager()
    assert mgr.load_config(env="production")["server"]["compress_responses"] is False
    assert not [l for l in mgr.layers if l["status"] == "ignored"]


def test_every_shipped_schema_key_is_settable_from_env(isolated):
    mgr = ConfigManager()
    paths = mgr._schema_key_paths()
    assert ("server", "max_response_elements") in paths and ("auth", "session_timeout") in paths

