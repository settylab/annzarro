"""The browser memory guard's server side.

- ``ui.memory`` (base.yaml, schema.yaml) reaches the browser through
  ``GET /api/v1/config``, with an admin's file overriding the defaults.
- ``server.cross_origin_isolation`` sends COOP/COEP headers: never by
  default, always with ``on``, and with ``auto`` except to a document the
  browser loads into a frame (server/isolation.py).
"""
import os

import pytest

from annzarro.server.core import create_app
from annzarro.server.isolation import isolation_mode
from annzarro.server.wsgi import create_wsgi_app


@pytest.fixture
def site(tmp_path, monkeypatch):
    for name in list(os.environ):
        if name.startswith("ANNZARRO_"):
            monkeypatch.delenv(name, raising=False)
    (tmp_path / "data").mkdir()

    def write(extra=""):
        path = tmp_path / "site.yaml"
        path.write_text(f"server:\n  data_dir: \"{tmp_path / 'data'}\"\n  log_file: \"{tmp_path / 'l.log'}\"\n"
                        f"auth:\n  enabled: false\n  user_file: \"{tmp_path / 'u.json'}\"\n" + extra)
        return str(path)
    return write


def test_ui_memory_defaults_reach_the_browser(site):
    app = create_wsgi_app(config_path=site())
    memory = app.test_client().get("/api/v1/config").get_json()["ui"]["memory"]
    # the test client's requests come from 127.0.0.1: this computer's RAM comes along
    import psutil
    assert memory == {"enforce": "block", "heap_gb": None, "total_gb": None, "margin": 0.2,
                      "host_memory_bytes": psutil.virtual_memory().total}


def test_ui_memory_set_by_an_admin(site):
    app = create_wsgi_app(config_path=site("ui:\n  memory:\n    enforce: warn\n    total_gb: 6\n"))
    memory = app.test_client().get("/api/v1/config").get_json()["ui"]["memory"]
    assert memory["enforce"] == "warn"
    assert memory["total_gb"] == 6
    assert memory["margin"] == 0.2      # the rest from the defaults


def test_isolation_setting_spellings():
    assert isolation_mode({}) == "off"
    for off in (False, None, "off", "OFF", "no", ""):
        assert isolation_mode({"cross_origin_isolation": off}) == "off", off
    for on in (True, "on", "true", "yes", "1"):
        assert isolation_mode({"cross_origin_isolation": on}) == "on", on
    assert isolation_mode({"cross_origin_isolation": " Auto "}) == "auto"


def _headers(mode, dest=None):
    app = create_app({"TESTING": True, "data_dir": "tests/data", "cross_origin_isolation": mode})
    headers = {"Sec-Fetch-Dest": dest} if dest else {}
    r = app.test_client().get("/api/v1/config", headers=headers)
    return r.headers.get("Cross-Origin-Opener-Policy"), r.headers.get("Cross-Origin-Embedder-Policy")


def test_isolation_headers():
    assert _headers("off") == (None, None)
    assert _headers("on") == ("same-origin", "require-corp")
    assert _headers("on", "iframe") == ("same-origin", "require-corp")
    assert _headers("auto") == ("same-origin", "require-corp")
    assert _headers("auto", "document") == ("same-origin", "require-corp")
    # inside another site's frame an isolated document would not load
    for dest in ("iframe", "frame", "embed", "object"):
        assert _headers("auto", dest) == (None, None), dest


def test_isolation_is_off_in_the_shipped_defaults(site):
    app = create_wsgi_app(config_path=site())
    assert isolation_mode(app.config) == "off"
    r = app.test_client().get("/api/v1/config")
    assert "Cross-Origin-Embedder-Policy" not in r.headers
    # an internal key: not sent to the browser
    assert "cross_origin_isolation" not in r.get_json().get("server", {})
