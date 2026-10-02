"""
annzarro/server/gunicorn_config.py must be a config gunicorn accepts.

Gunicorn takes every module-level name that matches one of its settings. A
variable called ``config`` (the AnnZarro settings dict) matched gunicorn's own
``config`` setting and every documented way to start the server
(run_gunicorn.sh, annzarro.service) exited with "Error: Not a string".
"""
import importlib
import os
import subprocess
import sys

import pytest

gunicorn_config_mod = pytest.importorskip("gunicorn.config")


@pytest.fixture
def site_yaml(tmp_path, monkeypatch):
    for name in list(os.environ):
        if name.startswith("ANNZARRO_"):
            monkeypatch.delenv(name, raising=False)
    (tmp_path / "data").mkdir()
    path = tmp_path / "site.yaml"
    path.write_text(
        "server:\n"
        f"  data_dir: \"{tmp_path / 'data'}\"\n"
        f"  log_file: \"{tmp_path / 'test.log'}\"\n"
        "  port: 8839\n"
        "auth:\n"
        f"  user_file: \"{tmp_path / 'users.json'}\"\n"
    )
    monkeypatch.setenv("ANNZARRO_CONFIG", str(path))
    return path


def _settings(module):
    return {k: v for k, v in vars(module).items()
            if k in gunicorn_config_mod.Config().settings}


def test_every_setting_in_the_module_is_valid_for_gunicorn(site_yaml):
    import annzarro.server.gunicorn_config as module
    module = importlib.reload(module)
    cfg = gunicorn_config_mod.Config()
    settings = _settings(module)
    assert "config" not in settings, "gunicorn reads a module variable `config` as its own --config"
    for name, value in settings.items():
        cfg.set(name, value)  # raises on a value gunicorn rejects
    assert cfg.bind == ["127.0.0.1:8839"]
    assert "user" not in settings, "the account belongs to systemd User=, not a hard-coded www-data"


def test_gunicorn_check_config_accepts_it(site_yaml, tmp_path):
    gunicorn = os.path.join(os.path.dirname(sys.executable), "gunicorn")
    if not os.path.exists(gunicorn):
        pytest.skip("gunicorn executable not installed")
    repo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
    env = dict(os.environ, PYTHONPATH=repo)
    result = subprocess.run(
        [gunicorn, "--check-config", "-c", "python:annzarro.server.gunicorn_config",
         "annzarro.server.wsgi:create_wsgi_app()"],
        cwd=tmp_path, env=env, capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, result.stderr[-2000:]


def test_deploy_files_use_the_importable_config():
    """A relative ``-c annzarro/server/gunicorn_config.py`` only works from a checkout root."""
    here = os.path.dirname(os.path.abspath(__file__))
    server = os.path.join(here, "..", "..", "server")
    for name in ("run_gunicorn.sh", "annzarro.service"):
        text = open(os.path.join(server, name)).read()
        assert "-c python:annzarro.server.gunicorn_config" in text, name
