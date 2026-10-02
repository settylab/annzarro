"""
Signing in must not lose a shared link.

A link such as ``/?dataset=x.zarr#view=...`` opened while signed out used to
land on ``/`` after login: the redirect to /login dropped the path and query,
and the login form always went to ``/``. The ``#view`` fragment never reaches
the server, so the login page copies it from the address bar into the form.
The target must stay on this server (no open redirect).
"""
import pytest

from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app, safe_fragment, safe_next


@pytest.fixture
def app(tmp_path):
    (tmp_path / "data").mkdir()
    users = tmp_path / "users.json"
    AuthManager(user_file=str(users)).create_user("alice", "pw")
    return create_app({
        "TESTING": True,
        "host": "127.0.0.1",
        "data_dir": str(tmp_path / "data"),
        "log_file": str(tmp_path / "test.log"),
        "auth_enabled": True,
        "user_file": str(users),
    })


def test_redirect_to_login_carries_path_and_query(app):
    resp = app.test_client().get("/?dataset=x.zarr&panel=2")
    assert resp.status_code == 302
    assert resp.headers["Location"] == "/login?next=/%3Fdataset%3Dx.zarr%26panel%3D2"


def test_plain_root_redirects_without_next(app):
    assert app.test_client().get("/").headers["Location"] == "/login"


def test_login_page_carries_next_and_fragment_field(app):
    html = app.test_client().get("/login?next=/%3Fdataset%3Dx.zarr").get_data(as_text=True)
    assert 'name="next" value="/?dataset=x.zarr"' in html
    assert 'name="fragment"' in html and "window.location.hash" in html


def test_login_returns_to_target_with_fragment(app):
    resp = app.test_client().post("/login", data={
        "username": "alice", "password": "pw",
        "next": "/?dataset=x.zarr", "fragment": "#view=abc",
    })
    assert resp.status_code == 302
    assert resp.headers["Location"] == "/?dataset=x.zarr#view=abc"


def test_failed_login_keeps_target_for_the_next_attempt(app):
    html = app.test_client().post("/login", data={
        "username": "alice", "password": "wrong",
        "next": "/?dataset=x.zarr", "fragment": "#view=abc",
    }).get_data(as_text=True)
    assert 'value="/?dataset=x.zarr"' in html and 'value="#view=abc"' in html


@pytest.mark.parametrize("target", [
    "//evil.example/", "https://evil.example/", "/\\evil.example", "\\\\evil.example",
    "evil.example", "javascript:alert(1)", "/ok\r\nSet-Cookie: x=1", "", None,
    "/login?next=/x", "/logout",
])
def test_next_must_be_a_local_path(target):
    assert safe_next(target) == "/"


def test_local_targets_pass():
    assert safe_next("/?dataset=a.zarr&x=1") == "/?dataset=a.zarr&x=1"
    assert safe_next("/datasets/a") == "/datasets/a"


def test_offsite_next_is_not_followed(app):
    resp = app.test_client().post("/login", data={
        "username": "alice", "password": "pw", "next": "//evil.example/x"})
    assert resp.headers["Location"] == "/"


def test_fragment_sanitising():
    assert safe_fragment("view=1") == "#view=1"
    assert safe_fragment("#view=1") == "#view=1"
    assert safe_fragment("#a\r\nb") == ""
    assert safe_fragment(None) == ""
