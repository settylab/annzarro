"""A request body has a size limit.

POST /sessions/save and /sessions/import read whatever they were sent into
memory and wrote it to the sessions directory: one client, anonymous when
login is off, could fill the server's memory or disk with a single request.
"""
import io
import json
from pathlib import Path

import pytest

from annzarro.server import panel_sets
from annzarro.server.core import create_app


def _client(tmp_path, **extra):
    data = tmp_path / "data"
    data.mkdir()
    app = create_app({"TESTING": True, "DEBUG": False, "auth_enabled": False, "data_dir": str(data),
                      "cache_enabled": False, **extra})
    return app.test_client(), Path(panel_sets.directory(app.config))     # where saved sets land


def test_an_oversized_save_is_refused_and_nothing_is_written(tmp_path):
    client, sets = _client(tmp_path, max_request_mb=0.01)           # about 10 KB
    body = {"name": "big", "padding": "x" * 50_000}
    reply = client.post("/api/v1/sessions/save", json=body)
    assert reply.status_code == 413
    assert reply.get_json()["reason"] == "request_too_large" and reply.get_json()["error"]
    assert not list(sets.glob("*.json"))
    small = client.post("/api/v1/sessions/save", json={"name": "small"})
    assert small.status_code == 200


def test_an_oversized_import_is_refused(tmp_path):
    client, sets = _client(tmp_path, max_request_mb=0.01)
    payload = json.dumps({"name": "big", "padding": "x" * 50_000}).encode()
    reply = client.post("/api/v1/sessions/import", data={"file": (io.BytesIO(payload), "big.json")},
                        content_type="multipart/form-data")
    assert reply.status_code == 413 and reply.get_json()["reason"] == "request_too_large"
    assert not list(sets.glob("*.json"))


def test_the_default_admits_an_ordinary_panel_set(tmp_path):
    client, _ = _client(tmp_path)
    body = {"name": "ordinary", "panelConfigs": {f"p{i}": {"cells": list(range(2000))} for i in range(20)}}
    assert len(json.dumps(body)) > 100_000
    assert client.post("/api/v1/sessions/save", json=body).status_code == 200


def test_zero_turns_the_limit_off(tmp_path):
    client, _ = _client(tmp_path, max_request_mb=0)
    assert client.post("/api/v1/sessions/save", json={"name": "b", "padding": "x" * 200_000}).status_code == 200


def test_the_login_form_is_limited_too(tmp_path):
    client, _ = _client(tmp_path, max_request_mb=0.01, auth_enabled=True,
                        user_file=str(tmp_path / "users.json"), secret_key="k" * 40)
    reply = client.post("/login", data={"username": "a", "password": "x" * 50_000})
    assert reply.status_code == 413



def _chunked(client, route, body_bytes):
    """A real chunked POST: no Content-Length, the body read from the input stream."""
    return client.post(f"/api/v1/sessions/{route}", input_stream=io.BytesIO(body_bytes),
                       content_type="application/json",
                       environ_overrides={"CONTENT_LENGTH": "", "HTTP_TRANSFER_ENCODING": "chunked",
                                          "wsgi.input_terminated": True})


@pytest.mark.parametrize("route, body", [
    ("save", {"name": "n"}), ("rename", {"old_name": "a", "new_name": "b"}),
    ("duplicate", {"source_name": "a", "new_name": "b"}),
])
def test_an_oversized_chunked_body_is_a_413_not_a_400_or_500(tmp_path, route, body):
    """No Content-Length: werkzeug cut the body at the limit and the route's JSON parse
    then failed (400, caught as Exception, answered 500). The body is now measured first."""
    client, sets = _client(tmp_path, max_request_mb=0.01)
    reply = _chunked(client, route, json.dumps({**body, "padding": "x" * 50_000}).encode())
    assert reply.status_code == 413, reply.get_data()[:200]
    assert reply.get_json()["reason"] == "request_too_large"
    assert not list(sets.glob("*.json"))


def test_a_small_chunked_body_still_reaches_the_route(tmp_path):
    client, sets = _client(tmp_path, max_request_mb=0.01)
    reply = _chunked(client, "save", json.dumps({"name": "chunked_ok"}).encode())
    assert reply.status_code == 200, reply.get_data()[:200]
    assert (sets / "chunked_ok.json").exists()
