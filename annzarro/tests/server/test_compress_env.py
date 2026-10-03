"""ANNZARRO_SERVER_COMPRESS_RESPONSES reaches the app.

compress_responses is declared in schema.yaml but absent from base.yaml
(unset means "auto"), and the environment mapping used to know only keys
present in the defaults, so the variable was silently ignored."""
import os

import pytest

from annzarro.server.wsgi import create_wsgi_app


@pytest.fixture
def site(tmp_path, monkeypatch):
    for name in list(os.environ):
        if name.startswith("ANNZARRO_"):
            monkeypatch.delenv(name, raising=False)
    (tmp_path / "data").mkdir()
    path = tmp_path / "site.yaml"
    path.write_text(f"server:\n  data_dir: \"{tmp_path / 'data'}\"\n  log_file: \"{tmp_path / 'l.log'}\"\n"
                    f"auth:\n  enabled: false\n  user_file: \"{tmp_path / 'u.json'}\"\n")
    return str(path)


def _gzipped(app):
    from annzarro.server.http_cache import gzip_enabled
    return gzip_enabled(app.config)


def test_env_turns_compression_off_on_a_hosted_server(site, monkeypatch):
    assert _gzipped(create_wsgi_app(config_path=site)), "auto compresses when hosted"
    monkeypatch.setenv("ANNZARRO_SERVER_COMPRESS_RESPONSES", "false")
    app = create_wsgi_app(config_path=site)
    assert app.config["compress_responses"] is False
    assert not _gzipped(app)
