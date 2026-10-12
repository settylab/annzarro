"""Forged requests against the app outside /admin (server/csrf.py).

Generated from ``app.url_map``: every route that takes an unsafe method, other than the admin
API (test_admin_access.py) and ``POST /login`` (the double-submit token, below), refuses a
missing or wrong token, a foreign ``Origin`` and a cross-site ``Sec-Fetch-Site``. A route added
later is covered without touching this file. These tests use a plain Flask client, not the
conftest's one that behaves like the page.
"""
import re

import pytest
from flask.testing import FlaskClient

from annzarro.server import csrf
from annzarro.tests.server.admin_helpers import ADMIN, PASSWORD, USER, make_app

UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}


def plain(app):
    return FlaskClient(app, app.response_class, use_cookies=True)


def sign_in(app, username, client=None):
    client = client or plain(app)
    page = client.get("/login").get_data(as_text=True)
    token = re.search(r'name="login_csrf" value="([^"]+)"', page).group(1)
    response = client.post("/login", data={"username": username, "password": PASSWORD, "login_csrf": token})
    assert response.status_code == 302, response.status_code
    return client


def token_of(client):
    with client.session_transaction() as sess:
        return sess["csrf"]


def unsafe_routes(app):
    """(method, path) of every route that changes state and is not guarded by something else."""
    out = []
    for rule in app.url_map.iter_rules():
        view = app.view_functions[rule.endpoint]
        if csrf.guards_itself(view):
            continue
        path = rule.rule
        for arg in rule.arguments:
            path = path.replace(f"<{arg}>", "x")
        out.extend((method, path) for method in sorted(rule.methods & UNSAFE))
    return out


def multipart(method, path):
    return path.endswith("/sessions/import")


def send(client, method, path, headers=None, form=None):
    """A request as another page could make it: a form, a plain body, or the real multipart."""
    if multipart(method, path):
        import io
        return client.open(path, method=method, headers=headers or {}, content_type="multipart/form-data",
                           data={"file": (io.BytesIO(b"{}"), "set.json"), "name": "forged"})
    if form is not None:
        return client.open(path, method=method, headers=headers or {}, data=form)
    return client.open(path, method=method, headers=headers or {}, json={})


def refused_as_forged(response):
    """403 with the forged-request answer: JSON for the API, a small page elsewhere."""
    if response.status_code != 403:
        return False
    body = response.get_json(silent=True)
    if body is not None:
        return body.get("reason") == "csrf_failed"
    return "The page is out of date" in response.get_data(as_text=True)


@pytest.fixture
def app(tmp_path):
    return make_app(tmp_path)


def test_the_inventory_has_the_routes_the_design_lists(app):
    found = set(unsafe_routes(app))
    for method, path in [("POST", "/api/v1/sessions/save"), ("POST", "/api/v1/sessions/rename"),
                         ("POST", "/api/v1/sessions/duplicate"), ("POST", "/api/v1/sessions/owner"),
                         ("POST", "/api/v1/sessions/import"), ("DELETE", "/api/v1/sessions/delete"),
                         ("POST", "/api/v1/cache/reset"), ("POST", "/api/v1/data/refresh"),
                         ("POST", "/logout")]:
        assert (method, path) in found, (method, path)


def test_every_unsafe_route_refuses_what_a_forged_request_looks_like(app):
    client = sign_in(app, ADMIN)    # an admin: the most a forged request could do
    token = token_of(client)
    for method, path in unsafe_routes(app):
        where = (method, path)
        assert refused_as_forged(send(client, method, path)), ("no token", where)
        assert refused_as_forged(send(client, method, path, {csrf.CSRF_HEADER: "wrong"})), ("wrong token", where)
        assert refused_as_forged(send(client, method, path, {csrf.CSRF_HEADER: token[:-1] + "x"})), ("near miss", where)
        assert refused_as_forged(send(client, method, path, form={"name": "x"})), ("form body", where)
        good = {csrf.CSRF_HEADER: token}
        assert refused_as_forged(send(client, method, path, {**good, "Origin": "https://evil.example"})), ("foreign Origin", where)
        assert refused_as_forged(send(client, method, path, {**good, "Origin": "null"})), ("null Origin", where)
        for site in ("cross-site", "same-site", "none"):
            assert refused_as_forged(send(client, method, path, {**good, "Sec-Fetch-Site": site})), (site, where)


def test_the_right_token_reaches_the_route(app):
    client = sign_in(app, USER)
    token = token_of(client)
    for method, path in unsafe_routes(app):
        if path == "/logout":
            continue    # signs the client out, below
        own = {csrf.CSRF_HEADER: token, "Origin": "http://localhost", "Sec-Fetch-Site": "same-origin"}
        assert not refused_as_forged(send(client, method, path, own)), (method, path)
        assert not refused_as_forged(send(client, method, path, {csrf.CSRF_HEADER: token})), (method, path)


def test_a_refused_request_changes_nothing(app):
    client = sign_in(app, USER)
    listing = lambda: client.get("/api/v1/sessions/list").get_json()
    before = listing()
    assert refused_as_forged(client.post("/api/v1/sessions/save", json={"name": "forged", "panels": []}))
    assert listing() == before


def test_an_expired_login_still_hears_401_not_403(app):
    for method, path in unsafe_routes(app):
        if path == "/logout":
            continue
        response = send(plain(app), method, path, {csrf.CSRF_HEADER: "stale"})
        assert response.status_code == 401, (method, path)
        assert response.get_json()["reason"] == "login_required"


def test_the_page_carries_the_token_only_for_its_user(app):
    client = sign_in(app, USER)
    page = client.get("/").get_data(as_text=True)
    assert f'<meta name="annzarro-csrf" content="{token_of(client)}">' in page
    assert client.get("/").headers["Cache-Control"] == "no-store"
    other = sign_in(app, ADMIN)
    assert token_of(other) != token_of(client)
    assert token_of(client) not in other.get("/").get_data(as_text=True)


def test_logging_in_again_rotates_the_token(app):
    client = sign_in(app, USER)
    first = token_of(client)
    sign_in(app, USER, client)
    assert token_of(client) != first


# --- logout --------------------------------------------------------------------

def test_get_logout_does_nothing_but_offer_a_button(app):
    client = sign_in(app, USER)
    response = client.get("/logout")
    assert response.status_code == 405 and response.headers["Allow"] == "POST"
    page = response.get_data(as_text=True)
    assert '<form method="post" action="/logout">' in page and token_of(client) in page
    assert client.get("/api/v1/auth/me").status_code == 200, "still signed in"
    assert client.get("/", follow_redirects=False).status_code == 200


def test_logout_needs_the_token_and_the_form_carries_it(app):
    client = sign_in(app, USER)
    assert refused_as_forged(client.post("/logout"))
    assert client.get("/api/v1/auth/me").status_code == 200
    assert client.post("/logout", data={"csrf_token": "wrong"}).status_code == 403
    assert client.post("/logout", data={"csrf_token": token_of(client)},
                       headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.get("/api/v1/auth/me").status_code == 200
    response = client.post("/logout", data={"csrf_token": token_of(client)})
    assert response.status_code == 302 and response.headers["Location"].endswith("/login")
    assert client.get("/api/v1/auth/me").status_code == 401


def test_logout_with_the_header_works_for_the_page(app):
    client = sign_in(app, USER)
    assert client.post("/logout", headers={csrf.CSRF_HEADER: token_of(client)}).status_code == 302
    assert client.get("/api/v1/auth/me").status_code == 401


def test_the_form_field_is_accepted_nowhere_else(app):
    client = sign_in(app, USER)
    response = client.post("/api/v1/cache/reset", data={"csrf_token": token_of(client)})
    assert refused_as_forged(response)


# --- login CSRF ----------------------------------------------------------------

def login_form(client):
    page = client.get("/login")
    cookie = page.headers["Set-Cookie"]
    return re.search(r'name="login_csrf" value="([^"]+)"', page.get_data(as_text=True)).group(1), cookie


def test_the_sign_in_page_sets_a_strict_short_lived_cookie_and_a_keyed_field(app):
    token, cookie = login_form(plain(app))
    nonce = re.search(rf"{csrf.LOGIN_COOKIE}=([^;]+)", cookie).group(1)
    assert token != nonce and token == _field_for(app, nonce), "the field is the keyed hash of the cookie"
    assert "SameSite=Strict" in cookie and "HttpOnly" in cookie and f"Max-Age={csrf.LOGIN_TTL}" in cookie


def test_a_sign_in_without_the_double_submit_token_is_refused_before_the_password_is_tried(app):
    forged = {"username": USER, "password": PASSWORD}
    for case in ("no cookie, no field", "field only", "cookie only", "mismatch"):
        fresh = plain(app)
        data = dict(forged)
        if case in ("cookie only", "mismatch"):
            token, _ = login_form(fresh)
            if case == "mismatch":
                data["login_csrf"] = token[:-1] + "x"
        elif case == "field only":
            data["login_csrf"] = "attacker-chosen"
        response = fresh.post("/login", data=data)
        assert response.status_code == 400, case
        assert "expired" in response.get_data(as_text=True)
        assert fresh.get("/api/v1/auth/me").status_code == 401, case


def test_a_failed_forged_sign_in_does_not_count_toward_the_lockout(app):
    for _ in range(30):
        plain(app).post("/login", data={"username": USER, "password": "wrong"})
    sign_in(app, USER)


def test_a_sign_in_page_older_than_its_cookie_is_refused(app):
    client = plain(app)
    token, _ = login_form(client)
    client.delete_cookie(csrf.LOGIN_COOKIE)
    response = client.post("/login", data={"username": USER, "password": PASSWORD, "login_csrf": token})
    assert response.status_code == 400


def _field_for(app, nonce):
    with app.test_request_context():
        return csrf.login_field(nonce)


def test_a_cookie_set_by_a_sibling_page_cannot_be_paired_with_a_field(app):
    """Cookie tossing: a page on a sibling subdomain sets the cookie for the whole domain and
    posts a form carrying the same value. Equal values used to be enough to sign the victim into
    the attacker's account; the field must be the server's keyed hash of the cookie."""
    victim = plain(app)
    victim.set_cookie(csrf.LOGIN_COOKIE, "attacker-chosen")
    for field in ("attacker-chosen", "", "0" * 64):
        response = victim.post("/login", data={"username": USER, "password": PASSWORD, "login_csrf": field})
        assert response.status_code == 400, field
    assert victim.get("/api/v1/auth/me").status_code == 401


def test_a_field_from_one_page_does_not_go_with_the_cookie_of_another(app):
    first, _ = login_form(plain(app))
    victim = plain(app)
    login_form(victim)      # the victim's cookie belongs to the victim's page
    response = victim.post("/login", data={"username": USER, "password": PASSWORD, "login_csrf": first})
    assert response.status_code == 400


def test_each_rendering_of_the_form_has_its_own_token(app):
    assert login_form(plain(app))[0] != login_form(plain(app))[0]


def test_a_failed_password_gives_the_retry_a_working_token(app):
    client = plain(app)
    token, _ = login_form(client)
    page = client.post("/login", data={"username": USER, "password": "wrong", "login_csrf": token})
    again = re.search(r'name="login_csrf" value="([^"]+)"', page.get_data(as_text=True)).group(1)
    assert client.post("/login", data={"username": USER, "password": PASSWORD, "login_csrf": again}).status_code == 302


# --- login off -----------------------------------------------------------------

@pytest.fixture
def open_app(tmp_path):
    return make_app(tmp_path, auth=False)


def test_without_login_a_browser_request_must_come_from_this_origin(open_app):
    client = plain(open_app)
    for method, path in unsafe_routes(open_app):
        for headers in ({"Origin": "https://evil.example"}, {"Origin": "null"}, {"Sec-Fetch-Site": "cross-site"},
                        {"Sec-Fetch-Site": "same-site"}):
            assert refused_as_forged(send(client, method, path, headers)), (method, path, headers)


def test_without_login_a_request_with_no_browser_headers_passes(open_app):
    # annzarro export and the desktop app's own calls, curl and scripts: no token to hold
    client = plain(open_app)
    for method, path in unsafe_routes(open_app):
        assert not refused_as_forged(send(client, method, path)), (method, path)
        own = {"Origin": "http://localhost", "Sec-Fetch-Site": "same-origin"}
        assert not refused_as_forged(send(client, method, path, own)), (method, path)


def test_without_login_the_page_has_an_empty_token_and_there_is_no_logout(open_app):
    client = plain(open_app)
    assert '<meta name="annzarro-csrf" content="">' in client.get("/").get_data(as_text=True)
    assert client.post("/logout").status_code in (404, 405)


# --- anonymous requests with login on ----------------------------------------------

def test_an_anonymous_request_changes_nothing_on_any_unsafe_route(app):
    """The hook lets an anonymous request through to the route's own login check; none acts."""
    for method, path in unsafe_routes(app):
        response = send(plain(app), method, path)
        if path == "/logout":
            assert response.status_code == 302 and response.headers["Location"].endswith("/login"), path
        else:
            assert response.status_code == 401, (method, path)


# --- Referer, when the browser sent neither Origin nor Sec-Fetch-Site -------------------

def test_a_foreign_referer_is_refused_when_nothing_else_says_where_the_request_came_from(open_app):
    client = plain(open_app)
    path = "/api/v1/cache/reset"
    assert refused_as_forged(send(client, "POST", path, {"Referer": "https://evil.example/page"}))
    assert refused_as_forged(send(client, "POST", path, {"Referer": "http://localhost.evil.example/"}))
    assert not refused_as_forged(send(client, "POST", path, {"Referer": "http://localhost/some/page?x=1"}))
    assert not refused_as_forged(send(client, "POST", path)), "no Referer at all passes"


def test_a_referer_does_not_overrule_the_headers_a_browser_volunteers(open_app):
    client = plain(open_app)
    same = {"Origin": "http://localhost", "Referer": "https://evil.example/"}
    assert not refused_as_forged(send(client, "POST", "/api/v1/cache/reset", same))


# --- behind a proxy -------------------------------------------------------------------

PROXIED = {"Origin": "https://lab.example.org", "X-Forwarded-Proto": "https", "X-Forwarded-Host": "lab.example.org"}


def test_forwarded_headers_decide_the_origin_only_when_proxies_are_trusted(tmp_path):
    trusting = plain(make_app(tmp_path, auth=False, proxy_count=1))
    assert not refused_as_forged(send(trusting, "POST", "/api/v1/cache/reset", PROXIED))
    (tmp_path / "b").mkdir()
    ignoring = plain(make_app(tmp_path / "b", auth=False))      # proxy_count 0
    response = send(ignoring, "POST", "/api/v1/cache/reset", PROXIED)
    assert refused_as_forged(response)
    assert "server.proxy_count" in response.get_json()["error"]


def test_a_refusal_without_a_foreign_origin_does_not_blame_the_proxy(app):
    client = sign_in(app, USER)
    assert "proxy_count" not in client.post("/api/v1/cache/reset").get_json()["error"]


def test_a_shared_login_off_server_on_loopback_warns_about_proxy_count(tmp_path):
    from annzarro.tests.server.test_admin_access import _Capture
    with _Capture("annzarro.server.csrf") as log:
        make_app(tmp_path, auth=False, host="127.0.0.1", hosted=True)
    assert "server.proxy_count" in log.text
    (tmp_path / "b").mkdir()
    with _Capture("annzarro.server.csrf") as log:
        make_app(tmp_path / "b", auth=False, host="127.0.0.1")           # the desktop app: not shared
        make_app(tmp_path / "b", auth=False, host="127.0.0.1", hosted=True, proxy_count=1)
    assert "server.proxy_count" not in log.text


# --- the page's token and the logout page ---------------------------------------------

def test_auth_me_hands_a_signed_in_page_its_current_token(app):
    client = sign_in(app, USER)
    reply = client.get("/api/v1/auth/me")
    assert reply.get_json()["csrf"] == token_of(client) and reply.headers["Cache-Control"] == "no-store"
    assert plain(app).get("/api/v1/auth/me").status_code == 401


def test_the_logout_page_sends_a_content_security_policy(app):
    response = sign_in(app, USER).get("/logout")
    assert "form-action 'self'" in response.headers["Content-Security-Policy"]
