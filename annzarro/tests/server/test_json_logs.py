"""server.log_format: json: the line format, the request context on it, and an unchanged default."""
import importlib
import json
import logging
import os

import pytest

from annzarro.server import jsonlog
from annzarro.server.core import create_app


def _app(tmp_path, **config):
    (tmp_path / "data").mkdir(exist_ok=True)
    settings = {"TESTING": True, "data_dir": str(tmp_path / "data"), "log_file": str(tmp_path / "app.log"),
                "user_file": str(tmp_path / "users.json")}
    settings.update(config)
    return create_app(settings)


def _get(client, path, **kwargs):
    response = client.get(path, **kwargs)
    response.get_data()
    response.close()
    return response


def _json_lines(capsys):
    lines = [l for l in capsys.readouterr().err.splitlines() if l.strip()]
    return [json.loads(l) for l in lines]


@pytest.fixture(autouse=True)
def _restore_logging():
    root = logging.getLogger("")
    handlers, level = list(root.handlers), root.level
    yield
    for h in list(root.handlers):
        root.removeHandler(h)
    for h in handlers:
        root.addHandler(h)
    root.setLevel(level)


def test_every_stderr_line_is_a_json_object_with_the_core_fields(tmp_path, capsys):
    app = _app(tmp_path, log_format="json")
    _get(app.test_client(), "/api/v1/status")
    lines = _json_lines(capsys)
    assert lines
    for line in lines:
        assert {"ts", "level", "logger", "message"} <= set(line)
        assert line["ts"].endswith("Z") and "T" in line["ts"]


def test_each_request_gets_one_access_line_without_path_or_address(tmp_path, capsys):
    app = _app(tmp_path, log_format="json")
    capsys.readouterr()
    reply = _get(app.test_client(), "/api/v1/data/info?dataset_path=/srv/pbmc-private.zarr",
                 environ_base={"REMOTE_ADDR": "198.51.100.23"})
    access = [l for l in _json_lines(capsys) if l["logger"] == jsonlog.ACCESS_LOGGER]
    assert len(access) == 1
    line = access[0]
    assert line["method"] == "GET" and line["route_group"] == "data/info"
    assert line["status"] == reply.status_code
    assert isinstance(line["duration_ms"], (int, float)) and line["duration_ms"] >= 0
    assert line["request_id"] == reply.headers["X-Request-Id"]
    text = json.dumps(line)
    assert "pbmc-private" not in text and "/srv" not in text and "198.51.100.23" not in text


def test_a_line_logged_while_serving_carries_the_request_context(tmp_path, capsys):
    app = _app(tmp_path, log_format="json")

    @app.route("/_noisy")
    def _noisy():
        logging.getLogger("annzarro.test").warning("something odd")
        return "ok"
    from annzarro.server import access
    access.gate("public")(app.view_functions["_noisy"])
    capsys.readouterr()
    reply = _get(app.test_client(), "/_noisy")
    odd = [l for l in _json_lines(capsys) if l["message"] == "something odd"][0]
    assert odd["request_id"] == reply.headers["X-Request-Id"]
    assert odd["method"] == "GET" and odd["route_group"] == "_noisy"
    assert "status" not in odd


def test_a_plain_request_id_from_the_caller_is_kept_and_anything_else_replaced(tmp_path):
    app = _app(tmp_path, log_format="json")
    kept = _get(app.test_client(), "/api/v1/status", headers={"X-Request-Id": "trace-42.a_b"})
    assert kept.headers["X-Request-Id"] == "trace-42.a_b"
    for bad in ("x" * 65, "has space", 'quote"d', "new\\line"):
        replaced = _get(app.test_client(), "/api/v1/status", headers={"X-Request-Id": bad})
        assert replaced.headers["X-Request-Id"] != bad and len(replaced.headers["X-Request-Id"]) == 16


def test_the_default_is_unchanged(tmp_path, capsys):
    app = _app(tmp_path)
    capsys.readouterr()
    reply = _get(app.test_client(), "/api/v1/status")
    err = capsys.readouterr().err
    assert "X-Request-Id" not in reply.headers
    assert jsonlog.ACCESS_LOGGER not in err
    assert not any(l.lstrip().startswith("{") for l in err.splitlines())
    assert "Telemetry" not in type(app.wsgi_app).__name__


def test_the_log_file_stays_text(tmp_path, capsys):
    app = _app(tmp_path, log_format="json")
    _get(app.test_client(), "/api/v1/status")
    for handler in logging.getLogger("").handlers:
        handler.flush()
    first = (tmp_path / "app.log").read_text().splitlines()[0]
    assert not first.startswith("{") and "[INFO]" in first


def test_an_exception_is_one_field_not_extra_lines():
    try:
        raise RuntimeError("boom")
    except RuntimeError:
        import sys
        record = logging.LogRecord("x", logging.ERROR, __file__, 1, "failed %s", ("now",), sys.exc_info())
    out = jsonlog.JsonFormatter().format(record)
    assert "\n" not in out
    line = json.loads(out)
    assert line["message"] == "failed now" and "RuntimeError: boom" in line["exception"]


def test_a_misspelt_format_stops_startup(tmp_path):
    with pytest.raises(ValueError, match="log_format"):
        _app(tmp_path, log_format="jsno")


def test_gunicorn_writes_json_and_no_access_log_in_json_mode(tmp_path, monkeypatch):
    pytest.importorskip("gunicorn.config")
    for name in list(os.environ):
        if name.startswith("ANNZARRO_"):
            monkeypatch.delenv(name, raising=False)
    (tmp_path / "data").mkdir()
    site = tmp_path / "site.yaml"
    site.write_text(f"server:\n  data_dir: \"{tmp_path / 'data'}\"\n  log_file: \"{tmp_path / 'x.log'}\"\n"
                    "  log_format: json\nauth:\n  user_file: \"" + str(tmp_path / "users.json") + "\"\n")
    monkeypatch.setenv("ANNZARRO_CONFIG", str(site))
    import gunicorn.config as gc
    import annzarro.server.gunicorn_config as module
    module = importlib.reload(module)
    assert module.accesslog is None
    cfg = gc.Config()
    for name, value in vars(module).items():
        if name in cfg.settings:
            cfg.set(name, value)
    spec = cfg.logconfig_dict
    assert spec["formatters"]["json"]["()"] == "annzarro.server.jsonlog.JsonFormatter"
    import logging.config
    gunicorn_error = logging.getLogger("gunicorn.error")
    before = list(gunicorn_error.handlers), gunicorn_error.propagate
    try:
        logging.config.dictConfig(spec)
        assert isinstance(gunicorn_error.handlers[0].formatter, jsonlog.JsonFormatter)
    finally:
        gunicorn_error.handlers[:], gunicorn_error.propagate = before


def test_the_environment_switches_both(tmp_path, monkeypatch):
    from annzarro.utils.config_manager import ConfigManager
    monkeypatch.setenv("ANNZARRO_SERVER_LOG_FORMAT", "json")
    monkeypatch.setenv("ANNZARRO_SERVER_METRICS_ENABLED", "true")
    monkeypatch.setenv("ANNZARRO_SERVER_METRICS_ALLOW", "10.0.0.0/8, 192.168.1.5")
    manager = ConfigManager()
    manager.load_config(env="production")
    server = manager.to_flask_config()
    assert server["log_format"] == "json" and server["metrics_enabled"] is True
    assert server["metrics_allow"] == ["10.0.0.0/8", "192.168.1.5"]
    assert manager.validate_config()[0]


def test_an_admin_change_is_one_audit_record_and_one_audit_line_with_the_same_request_id(tmp_path, capsys):
    from annzarro.server.admin import audit
    from annzarro.tests.server.admin_helpers import ADMIN, login, make_app, unsafe_headers
    app = make_app(tmp_path, log_format="json")
    client = login(app, ADMIN)
    capsys.readouterr()
    reply = client.post("/api/v1/admin/cache/clear", data="{}", headers=unsafe_headers(client))
    reply.get_data()
    reply.close()                                                 # the access line is written at the last byte
    assert reply.status_code == 200
    rid = reply.headers["X-Request-Id"]
    record = audit.read(app.admin_dir, limit=1)[0]
    assert record["action"] == "cache.clear" and record["request_id"] == rid
    assert audit.verify(app.admin_dir)["ok"]
    lines = _json_lines(capsys)
    mirrored = [l for l in lines if l["logger"] == "annzarro.audit"]
    assert len(mirrored) == 1 and mirrored[0]["request_id"] == rid
    assert json.loads(mirrored[0]["message"]) == record          # the exact record, for the chain's tail
    assert [l["request_id"] for l in lines if l["logger"] == jsonlog.ACCESS_LOGGER] == [rid]


def test_a_login_and_a_password_change_put_no_secret_on_a_json_line(tmp_path, capsys):
    from annzarro.tests.server.admin_helpers import ADMIN, PASSWORD, USER, login, make_app, unsafe_headers
    app = make_app(tmp_path, log_format="json")
    capsys.readouterr()
    app.test_client().post("/login", data={"username": USER, "password": "wrong password here"})
    client = login(app, ADMIN)
    new = "a brand new secret phrase"
    changed = client.post(f"/api/v1/admin/users/{USER}/password", data=json.dumps({"password": new}),
                          headers=unsafe_headers(client))
    assert changed.status_code == 200
    out = capsys.readouterr().err
    assert 'user.password' in out                               # the audit line is there, the password is not
    with client.session_transaction() as sess:
        cookie_values = [str(v) for v in sess.values()]
    for secret in (PASSWORD, "wrong password here", new, app.secret_key if isinstance(app.secret_key, str) else "\0",
                   *[v for v in cookie_values if len(v) >= 16]):
        assert secret not in out
