"""The admin update notice: GET /api/v1/admin/version-check and `annzarro --version`.

PyPI is never reached: urlopen is replaced in every test (an autouse fixture refuses the
real one).
"""
import io
import json
import socket

import pytest

import annzarro
from annzarro.server import update_check
from annzarro.tests.server.admin_helpers import ADMIN, USER, login, make_app

URL = "/api/v1/admin/version-check"


class _Reply(io.BytesIO):
    def __init__(self, body, status=200):
        super().__init__(body if isinstance(body, bytes) else json.dumps(body).encode())
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def pypi(version):
    return _Reply({"info": {"version": version}})


@pytest.fixture(autouse=True)
def fake_pypi(monkeypatch):
    """Counts the requests; each test sets `calls.reply` (a reply or an exception to raise)."""
    class Calls:
        urls = []
        reply = pypi("99.0.0")

    def urlopen(url, timeout=None):
        Calls.urls.append((url, timeout))
        if isinstance(Calls.reply, Exception):
            raise Calls.reply
        Calls.reply.seek(0)
        return Calls.reply

    monkeypatch.setattr(update_check.urllib.request, "urlopen", urlopen)
    monkeypatch.delenv("ANNZARRO_ELECTRON_APP", raising=False)
    monkeypatch.setattr(annzarro, "__version__", "0.7.3")
    Calls.urls = []
    update_check.reset_cache()
    yield Calls
    update_check.reset_cache()


@pytest.fixture
def app(tmp_path):
    app = make_app(tmp_path)
    with app.app_context():
        yield app


def _ask(app, user=ADMIN):
    return login(app, user).get(URL)


def test_a_newer_release_is_reported(app, fake_pypi):
    fake_pypi.reply = pypi("0.8.0")
    body = _ask(app).get_json()
    assert body["enabled"] and body["update_available"]
    assert (body["current"], body["latest"]) == ("0.7.3", "0.8.0")
    assert body["upgrade_command"] == "pip install -U annzarro"
    assert body["url"].endswith("/releases/tag/v0.8.0")
    (url, timeout), = fake_pypi.urls
    assert url == "https://pypi.org/pypi/annzarro/json" and 0 < timeout <= 5


@pytest.mark.parametrize("listed", ["0.7.3", "0.7.2", "0.7.3.0", "0.8.0rc1", "0.8.0.dev1", "1.0.0b2", "garbage"])
def test_no_notice_unless_a_final_release_is_newer(app, fake_pypi, listed):
    fake_pypi.reply = pypi(listed)
    body = _ask(app).get_json()
    assert body["enabled"] and body["update_available"] is False and body["latest"] is None
    assert body["current"] == "0.7.3"


@pytest.mark.parametrize("failure", [
    socket.timeout("timed out"), OSError("offline"), _Reply(b"<html>not json"), _Reply({"info": {}}),
    _Reply({"info": {"version": "0.9.0"}}, status=503), _Reply([1, 2])])
def test_every_failure_answers_quietly(app, fake_pypi, failure):
    fake_pypi.reply = failure
    reply = _ask(app)
    assert reply.status_code == 200
    body = reply.get_json()
    assert body["update_available"] is False and body["current"] == "0.7.3"


def test_the_answer_is_cached(app, fake_pypi):
    fake_pypi.reply = pypi("0.8.0")
    client = login(app, ADMIN)
    assert client.get(URL).get_json()["update_available"]
    assert client.get(URL).get_json()["latest"] == "0.8.0"
    assert len(fake_pypi.urls) == 1


def test_a_failure_is_cached_too_but_a_later_window_asks_again(app, fake_pypi, monkeypatch):
    fake_pypi.reply = OSError("offline")
    client = login(app, ADMIN)
    client.get(URL)
    client.get(URL)
    assert len(fake_pypi.urls) == 1
    now = update_check.time.monotonic()
    monkeypatch.setattr(update_check.time, "monotonic", lambda: now + update_check.FAILURE_CACHE_S + 1)
    fake_pypi.reply = pypi("0.8.0")
    assert client.get(URL).get_json()["update_available"]
    assert len(fake_pypi.urls) == 2


def test_the_switch_turns_the_request_off(tmp_path, fake_pypi):
    app = make_app(tmp_path, update_check=False)
    with app.app_context():
        body = _ask(app).get_json()
    assert body == {"enabled": False, "reason": "disabled", "current": "0.7.3"}
    assert fake_pypi.urls == []


def test_the_desktop_app_never_asks(app, fake_pypi, monkeypatch):
    monkeypatch.setenv("ANNZARRO_ELECTRON_APP", "true")
    body = _ask(app).get_json()
    assert body["enabled"] is False and body["reason"] == "desktop"
    assert fake_pypi.urls == []


def test_only_admins_may_ask(app, fake_pypi):
    assert _ask(app, USER).status_code == 403
    assert app.test_client().get(URL).status_code in (401, 302)
    assert fake_pypi.urls == []


def test_nothing_is_requested_at_start_or_by_other_endpoints(app, fake_pypi):
    client = login(app, ADMIN)
    client.get("/api/v1/admin/health")
    assert fake_pypi.urls == []


@pytest.mark.parametrize("latest, current, expected", [
    ("0.10.0", "0.9.9", True), ("0.7.3", "0.7.3", False), ("0.7.3.1", "0.7.3", True),
    ("0.7", "0.7.0", False), ("0.7.2", "0.7.3", False), ("0.8.0rc1", "0.7.3", False),
    ("1.0.0", "0.7.3rc1", False), (None, "0.7.3", False)])
def test_version_comparison(latest, current, expected):
    assert update_check.is_newer(latest, current) is expected


def test_cli_version(capsys):
    from annzarro.cli import main
    with pytest.raises(SystemExit) as stop:
        main(["--version"])
    assert stop.value.code == 0
    assert capsys.readouterr().out.strip() == f"annzarro {annzarro.__version__}"
