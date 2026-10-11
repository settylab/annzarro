"""GET /api/v1/policy/effective, the version header, and requires()."""
import pytest
from flask import Flask, jsonify

from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app
from annzarro.server.policy import (Bool, Enum, Key, REGISTRY, Registry, check_routes, engine, install, requires)
from annzarro.server.policy.routes import POLICY_HEADER


def config(tmp_path, **extra):
    (tmp_path / "data").mkdir(exist_ok=True)
    return {"TESTING": True, "host": "127.0.0.1", "data_dir": str(tmp_path / "data"),
            "log_file": str(tmp_path / "test.log"), **extra}


@pytest.fixture
def client_key():
    """Two client keys and one server-only key, declared for the test."""
    names = ("panel.t1.enabled", "panel.t2.mode", "panel.t3.hidden")
    REGISTRY.declare(Key(name=names[0], type=Bool(), default=True, scope="user", combine="restrict",
                         description="d", area="panels"))
    REGISTRY.declare(Key(name=names[1], type=Enum(["a", "b"]), default="a", scope="user",
                         description="d", area="panels"))
    REGISTRY.declare(Key(name=names[2], type=Bool(), default=True, scope="config", description="d",
                         area="panels", client=False))
    yield names
    for name in names:
        del REGISTRY.keys[name]


def test_effective_lists_exactly_the_client_keys(tmp_path, client_key):
    app = create_app(config(tmp_path))
    body = app.test_client().get("/api/v1/policy/effective").get_json()
    assert body["values"] == {"panel.t1.enabled": True, "panel.t2.mode": "a"}
    assert body["version"] == engine(app).version()
    assert "limits.max_sessions" not in body["values"] and "panel.t3.hidden" not in body["values"]


def test_keys_parameter_limits_and_ignores_unknown_and_non_client(tmp_path, client_key):
    c = create_app(config(tmp_path)).test_client()
    got = c.get("/api/v1/policy/effective?keys=panel.t2.mode,nope.x,panel.t3.hidden,limits.max_sessions").get_json()
    assert got["values"] == {"panel.t2.mode": "a"}
    assert c.get("/api/v1/policy/effective?keys=").get_json()["values"].keys() == {"panel.t1.enabled", "panel.t2.mode"}


def test_the_reply_is_not_cacheable_and_varies_by_cookie(tmp_path):
    resp = create_app(config(tmp_path)).test_client().get("/api/v1/policy/effective")
    assert resp.headers["Cache-Control"] == "no-store" and "Cookie" in resp.headers["Vary"]


def test_every_api_reply_carries_the_version_and_it_moves_with_the_policy(tmp_path, client_key):
    app = create_app(config(tmp_path))
    store = {}
    engine(app).set_source("overlay", lambda: store, stamp=lambda: repr(store))
    c = app.test_client()
    first = c.get("/api/v1/config").headers[POLICY_HEADER]
    assert first == c.get("/api/v1/auth/me").headers[POLICY_HEADER]
    store["panel.t1.enabled"] = False
    after = c.get("/api/v1/config")
    assert after.headers[POLICY_HEADER] != first
    assert c.get("/api/v1/policy/effective").get_json()["values"]["panel.t1.enabled"] is False
    assert c.get("/").headers.get(POLICY_HEADER) is None            # pages are not API replies


def test_the_requester_gets_their_own_layer(tmp_path, client_key):
    users = tmp_path / "users.json"
    manager = AuthManager(user_file=str(users))
    manager.create_user("alice", "pw")
    manager.create_user("bob", "pw")
    app = create_app(config(tmp_path, auth_enabled=True, user_file=str(users)))
    per_user = {"alice": {"panel.t1.enabled": False}}
    engine(app).set_source("user", lambda user: per_user.get(user, {}), stamp=lambda: repr(per_user))

    def values(name):
        c = app.test_client()
        assert c.post("/login", data={"username": name, "password": "pw"}).status_code == 302
        return c.get("/api/v1/policy/effective").get_json()["values"]["panel.t1.enabled"]

    assert values("alice") is False and values("bob") is True


def test_login_is_required_and_the_header_withheld_from_strangers(tmp_path, client_key):
    users = tmp_path / "users.json"
    AuthManager(user_file=str(users)).create_user("alice", "pw")
    c = create_app(config(tmp_path, auth_enabled=True, user_file=str(users))).test_client()
    resp = c.get("/api/v1/policy/effective")
    assert resp.status_code == 401 and POLICY_HEADER not in resp.headers


# -- requires --------------------------------------------------------------

def gated_app(flag_value):
    registry = Registry()
    registry.declare(Key(name="panel.g.enabled", type=Bool(), default=True, scope="user", combine="restrict",
                         description="d", area="panels", routes=("gated",)))
    registry.declare(Key(name="panel.g.mode", type=Enum(["on", "off"], off=["off"]), default="on", scope="user",
                         description="d", area="panels", routes=("moded",)))
    app = Flask(__name__)
    eng = install(app, registry=registry)
    store = {}
    eng.set_source("overlay", lambda: store, stamp=lambda: repr(store))

    @app.route("/gated")
    @requires("panel.g.enabled")
    def gated():
        return jsonify(ok=True)

    @app.route("/moded")
    @requires("panel.g.mode")
    def moded():
        return jsonify(ok=True)

    return app, store, registry


def test_requires_answers_403_when_the_key_is_off():
    app, store, _ = gated_app(True)
    c = app.test_client()
    assert c.get("/gated").status_code == 200 and c.get("/moded").status_code == 200
    store.update({"panel.g.enabled": False, "panel.g.mode": "off"})
    for path, key in (("/gated", "panel.g.enabled"), ("/moded", "panel.g.mode")):
        resp = c.get(path)
        assert resp.status_code == 403
        assert resp.get_json()["reason"] == "disabled_by_policy" and resp.get_json()["key"] == key


def test_check_routes_agrees_in_both_directions():
    app, _, registry = gated_app(True)
    assert check_routes(app) == []

    @app.route("/stray")
    @requires("panel.g.enabled")
    def stray():
        return "x"

    registry.declare(Key(name="panel.h.enabled", type=Bool(), default=True, scope="user", description="d",
                         area="panels", routes=("missing", "stray")))
    problems = check_routes(app)
    assert any("stray" in p and "does not list it" in p for p in problems)
    assert any("'missing'" in p and "does not exist" in p for p in problems)
    assert any("'stray'" in p and "does not carry" in p for p in problems)


def test_requires_an_undeclared_key_is_a_problem():
    app, _, _ = gated_app(True)

    @app.route("/ghost")
    @requires("panel.nope.enabled")
    def ghost():
        return "x"

    assert any("not declared" in p for p in check_routes(app))


def test_the_server_app_is_consistent(tmp_path):
    assert check_routes(create_app(config(tmp_path))) == []


def test_a_revoked_login_gets_no_version_header(tmp_path):
    users = tmp_path / "users.json"
    manager = AuthManager(user_file=str(users))
    manager.create_user("alice", "pw")
    c = create_app(config(tmp_path, auth_enabled=True, user_file=str(users))).test_client()
    c.post("/login", data={"username": "alice", "password": "pw"})
    assert POLICY_HEADER in c.get("/api/v1/auth/me").headers
    AuthManager(user_file=str(users)).remove_user("alice")
    assert POLICY_HEADER not in c.get("/api/v1/auth/me").headers
