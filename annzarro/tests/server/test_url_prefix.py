"""
Serving the app under a path such as /explore/ behind a reverse proxy (#18).

The prefix comes from ``server.url_prefix`` (the proxy may strip it or pass
it through) or from a trusted proxy's ``X-Forwarded-Prefix``. Every URL the
server writes (static assets, login form, redirects, the frontend's
``annzarro-root``) must carry it, ``safe_next`` must accept prefixed targets
and still refuse other hosts and other apps on the host, and the login cookie
must be scoped to the prefix.
"""
import pytest

from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app, normalize_url_prefix, safe_next


def _app(tmp_path, **extra):
    (tmp_path / "data").mkdir(exist_ok=True)
    users = tmp_path / "users.json"
    if not users.exists():
        AuthManager(user_file=str(users)).create_user("alice", "pw")
    config = {"TESTING": True, "host": "127.0.0.1", "data_dir": str(tmp_path / "data"),
              "log_file": str(tmp_path / "test.log"), "auth_enabled": True,
              "user_file": str(users)}
    config.update(extra)
    return create_app(config)


def _login(client, path="/explore/login", **data):
    form = {"username": "alice", "password": "pw"}
    form.update(data)
    return client.post(path, data=form)


# --- the configured prefix ---------------------------------------------------

@pytest.mark.parametrize("value,expected", [
    (None, ""), ("", ""), ("/", ""), ("  ", ""),
    ("/explore", "/explore"), ("explore", "/explore"), ("/explore/", "/explore"),
    ("/lab/annzarro/", "/lab/annzarro"),
])
def test_prefix_is_normalised(value, expected):
    assert normalize_url_prefix(value) == expected


@pytest.mark.parametrize("value", [
    "/a/../b", "/a//b", "/./a", "/a b", "/a?x=1", "/a#b", "https://host/a", 5,
])
def test_a_prefix_that_is_not_a_plain_path_is_refused(value):
    with pytest.raises(ValueError):
        normalize_url_prefix(value)


def test_a_bad_prefix_stops_the_server_at_startup(tmp_path):
    with pytest.raises(ValueError):
        _app(tmp_path, url_prefix="/a/../b")


# --- safe_next under a prefix --------------------------------------------------

def test_prefixed_targets_pass():
    assert safe_next("/explore/?dataset=a.zarr", "/explore") == "/explore/?dataset=a.zarr"
    assert safe_next("/explore", "/explore") == "/explore"
    assert safe_next("/explore/datasets/a", "/explore") == "/explore/datasets/a"


@pytest.mark.parametrize("target", [
    "//evil.example/", "https://evil.example/explore/", "/\\evil.example", "evil.example",
    "/explore/login?next=/x", "/explore/logout", "", None,
    # another app on the same host, or a path that only shares the first letters
    "/", "/?dataset=a.zarr", "/dolimap/", "/explorer/x",
])
def test_targets_outside_the_prefix_are_refused(target):
    assert safe_next(target, "/explore") == "/explore/"


def test_unprefixed_behaviour_is_unchanged():
    assert safe_next("/?dataset=a.zarr") == "/?dataset=a.zarr"
    assert safe_next("//evil.example/") == "/"


# --- the app under a configured prefix -----------------------------------------

@pytest.mark.parametrize("passthrough", [True, False])
def test_page_and_assets_carry_the_prefix(tmp_path, passthrough):
    """The same app answers whether the proxy strips /explore or passes it on."""
    client = _app(tmp_path, url_prefix="/explore/", auth_enabled=False).test_client()
    html = client.get("/explore/" if passthrough else "/").get_data(as_text=True)
    assert '<meta name="annzarro-root" content="/explore">' in html
    assert 'src="/explore/static/js/main.js"' in html
    assert 'href="/explore/static/vendor/css/bootstrap.min.css"' in html
    assert 'src="/static/' not in html and 'href="/static/' not in html
    api = "/explore/api/v1/config" if passthrough else "/api/v1/config"
    assert client.get(api).status_code == 200


def test_signed_out_link_goes_to_the_prefixed_login_and_back(tmp_path):
    client = _app(tmp_path, url_prefix="/explore").test_client()
    resp = client.get("/explore/?dataset=x.zarr")
    assert resp.status_code == 302
    assert resp.headers["Location"] == "/explore/login?next=/explore/%3Fdataset%3Dx.zarr"
    assert client.get("/explore/").headers["Location"] == "/explore/login"

    html = client.get("/explore/login?next=/explore/%3Fdataset%3Dx.zarr").get_data(as_text=True)
    assert 'action="/explore/login"' in html
    assert 'name="next" value="/explore/?dataset=x.zarr"' in html

    resp = _login(client, next="/explore/?dataset=x.zarr", fragment="#view=abc")
    assert resp.headers["Location"] == "/explore/?dataset=x.zarr#view=abc"


def test_login_will_not_leave_the_prefix(tmp_path):
    client = _app(tmp_path, url_prefix="/explore").test_client()
    for target in ("//evil.example/x", "/dolimap/", "/"):
        assert _login(client, next=target).headers["Location"] == "/explore/"


def test_cookie_path_is_the_prefix(tmp_path):
    client = _app(tmp_path, url_prefix="/explore").test_client()
    cookie = _login(client).headers["Set-Cookie"]
    assert "Path=/explore;" in cookie or cookie.endswith("Path=/explore")
    assert client.get("/explore/api/v1/auth/me").status_code == 200
    resp = client.get("/explore/logout")
    assert resp.headers["Location"] == "/explore/login"
    assert "Path=/explore" in resp.headers["Set-Cookie"]  # the cleared cookie is the same one


def test_cookie_path_is_root_without_a_prefix(tmp_path):
    cookie = _login(_app(tmp_path).test_client(), path="/login").headers["Set-Cookie"]
    assert "Path=/;" in cookie or cookie.endswith("Path=/")


# --- X-Forwarded-Prefix from a trusted proxy -------------------------------------

def test_forwarded_prefix_is_honoured_from_a_trusted_proxy(tmp_path):
    client = _app(tmp_path, proxy_count=1).test_client()
    resp = client.get("/?dataset=x.zarr", headers={"X-Forwarded-Prefix": "/explore"})
    assert resp.headers["Location"] == "/explore/login?next=/explore/%3Fdataset%3Dx.zarr"
    cookie = client.post("/login", data={"username": "alice", "password": "pw"},
                         headers={"X-Forwarded-Prefix": "/explore"}).headers["Set-Cookie"]
    assert "Path=/explore" in cookie


def test_forwarded_prefix_is_ignored_without_a_trusted_proxy(tmp_path):
    client = _app(tmp_path).test_client()  # proxy_count 0
    resp = client.get("/?dataset=x.zarr", headers={"X-Forwarded-Prefix": "/explore"})
    assert resp.headers["Location"] == "/login?next=/%3Fdataset%3Dx.zarr"
