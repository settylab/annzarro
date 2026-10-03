"""The default data directory is ~/annzarro-data, as in the desktop app.

It was "data", relative to wherever annzarro was started: `annzarro start`
from $HOME created and served ~/data, from a project directory its data/.
"""
import os

from annzarro.server.core import create_app
from annzarro.utils import paths
from annzarro.utils.config_manager import ConfigManager


def _isolate(tmp_path, monkeypatch):
    for var in list(os.environ):
        if var.startswith("ANNZARRO_"):
            monkeypatch.delenv(var)
    monkeypatch.setenv("HOME", str(tmp_path / "home"))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / "home" / ".config"))
    monkeypatch.setattr(ConfigManager, "SYSTEM_CONFIG_PATH", str(tmp_path / "none.yaml"))
    (tmp_path / "cwd").mkdir()
    monkeypatch.chdir(tmp_path / "cwd")


def test_configured_default_does_not_depend_on_the_cwd(tmp_path, monkeypatch):
    _isolate(tmp_path, monkeypatch)
    for env in ("production", "development"):
        data_dir = ConfigManager().load_config(env=env)["server"]["data_dir"]
        assert data_dir == str(tmp_path / "home" / "annzarro-data")


def test_unconfigured_app_uses_the_same_folder(tmp_path, monkeypatch):
    _isolate(tmp_path, monkeypatch)
    app = create_app({"TESTING": True, "log_file": str(tmp_path / "l.log")})
    assert app.config["data_dir"] == paths.default_data_dir() == str(tmp_path / "home" / "annzarro-data")
    assert not (tmp_path / "cwd" / "data").exists()


def test_explicit_relative_dir_still_works(tmp_path, monkeypatch):
    _isolate(tmp_path, monkeypatch)
    monkeypatch.setenv("ANNZARRO_SERVER_DATA_DIR", "mydata")
    assert ConfigManager().load_config(env="production")["server"]["data_dir"] == "mydata"
