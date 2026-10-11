"""Every admin route, as every kind of requester.

The matrix is generated from ``app.url_map``: a route added by a later slice
is covered the moment it exists, and one that forgets the guard fails here.
"""
import json
import os

import pytest

from annzarro.server.admin import audit, guard
from annzarro.tests.server.admin_helpers import (ADMIN, USER, admin_rules, csrf_of, fresh, login,
                                                 make_app, probe, unsafe_headers)

UNSAFE = ("POST", "PUT", "PATCH", "DELETE")
TEMPLATE = os.path.join(os.path.dirname(__file__), "..", "..", "..", "templates", "admin.html")


@pytest.fixture
def app(tmp_path):
    return make_app(tmp_path)


def _stamps(app):
    names = [os.path.join(app.admin_dir, n) for n in ("overlay.json", "access.json")]
    names.append(app.config["user_file"])
    return [(n, os.path.exists(n) and os.stat(n).st_mtime_ns) for n in names]


def _call(client, method, path, headers=None, body=None):
    kwargs = {"headers": headers or {}}
    if method in UNSAFE:
        kwargs["data"] = json.dumps(body if body is not None else {})
    return client.open(path, method=method, **kwargs)


def _audit_len(app):
    return len(audit.read(app.admin_dir, limit=500))


def test_the_matrix_is_not_empty(app):
    rules = {(r, m) for r, m, _ in admin_rules(app)}
    assert ("/admin", "GET") in rules
    assert ("/api/v1/admin/reauth", "POST") in rules
    assert ("/api/v1/admin/audit", "GET") in rules


def test_every_admin_view_carries_the_guard(app):
    for rule in app.url_map.iter_rules():
        if rule.rule == "/admin" or rule.rule.startswith("/api/v1/admin/"):
            assert getattr(app.view_functions[rule.endpoint], "_annzarro_admin", False), rule.rule


def test_login_off_answers_404_everywhere(tmp_path):
    app = make_app(tmp_path, auth=False)
    client = app.test_client()
    for rule, method, path in admin_rules(app):
        response = _call(client, method, path)
        assert response.status_code == 404, (method, rule)
        if path.startswith("/api/"):
            assert response.get_json()["reason"] == "admin_requires_login", (method, rule)


def test_anonymous_is_sent_to_login(app):
    client = app.test_client()
    for rule, method, path in admin_rules(app):
        response = _call(client, method, path)
        if path.startswith("/api/"):
            assert response.status_code == 401, (method, rule)
            assert response.get_json()["reason"] == "login_required"
        else:
            assert response.status_code == 302 and "/login" in response.headers["Location"], (method, rule)
    assert not os.path.exists(os.path.join(app.admin_dir, "audit.jsonl")), "anonymous is not audited"


def test_user_is_refused_and_nothing_changes(app):
    client = login(app, USER)
    before = _stamps(app)
    for rule, method, path in admin_rules(app):
        count = _audit_len(app)
        # a user who somehow holds a valid token and fresh re-auth is still refused
        headers = unsafe_headers(client) if method in UNSAFE else {}
        response = _call(client, method, path, headers)
        assert response.status_code == 403, (method, rule)
        if path.startswith("/api/"):
            assert response.get_json()["reason"] == "admin_only"
        assert _audit_len(app) == count + (1 if method in UNSAFE else 0), (method, rule)
    assert _stamps(app) == before
    records = audit.read(app.admin_dir, limit=500)
    assert records and all(r["outcome"] == "refused:admin_only" and r["actor"] == USER for r in records)


def test_refused_attempts_are_audited_at_a_bounded_rate(app):
    client = login(app, USER)
    for _ in range(50):
        assert _call(client, "POST", "/api/v1/admin/reauth", unsafe_headers(client)).status_code == 403
    assert _audit_len(app) == guard.REFUSAL_AUDIT_PER_MINUTE


def test_admin_without_a_valid_csrf_token_is_refused(app):
    client = login(app, ADMIN)
    token = csrf_of(client)
    for rule, method, path in admin_rules(app):
        if method not in UNSAFE:
            continue
        for headers in ({"Content-Type": "application/json"},
                        {"Content-Type": "application/json", "X-AnnZarro-CSRF": "wrong"},
                        {"Content-Type": "application/json", "X-AnnZarro-CSRF": token[:-1]},
                        {"Content-Type": "application/json", "X-AnnZarro-CSRF": ""}):
            response = _call(client, method, path, headers)
            assert response.status_code == 403 and response.get_json()["reason"] == "csrf_failed", (method, rule)


def test_a_foreign_origin_or_fetch_site_is_refused(app):
    client = login(app, ADMIN)
    for rule, method, path in admin_rules(app):
        if method not in UNSAFE:
            continue
        for extra in ({"Origin": "https://evil.example"}, {"Origin": "null"},
                      {"Origin": "http://localhost.evil.example"},
                      {"Sec-Fetch-Site": "cross-site"}, {"Sec-Fetch-Site": "same-site"}):
            response = _call(client, method, path, unsafe_headers(client, **extra))
            assert response.status_code == 403 and response.get_json()["reason"] == "csrf_failed", (method, rule, extra)
    own = _call(client, "POST", "/api/v1/admin/reauth",
                unsafe_headers(client, Origin="http://localhost", **{"Sec-Fetch-Site": "same-origin"}))
    assert own.status_code == 400, "the server's own origin passes the guard (the body is empty)"


def test_the_token_belongs_to_the_login(app):
    first, second = login(app, ADMIN), login(app, ADMIN)
    assert csrf_of(first) != csrf_of(second)
    response = _call(second, "POST", "/api/v1/admin/reauth",
                     {"X-AnnZarro-CSRF": csrf_of(first), "Content-Type": "application/json"})
    assert response.status_code == 403


def test_a_form_post_is_refused_even_with_the_token(app):
    client = login(app, ADMIN)
    response = client.post("/api/v1/admin/reauth", data={"password": "x"},
                           headers={"X-AnnZarro-CSRF": csrf_of(client)})
    assert response.status_code == 415 and response.get_json()["reason"] == "json_required"


def test_a_stale_reauth_blocks_every_change_but_reauth(app):
    client = login(app, ADMIN)
    with client.session_transaction() as sess:
        sess["admin_auth_at"] = sess["admin_auth_at"] - 31 * 60
    for rule, method, path in admin_rules(app):
        if method not in UNSAFE:
            continue
        response = _call(client, method, path, unsafe_headers(client))
        if rule == "/api/v1/admin/reauth":
            assert response.status_code == 400, "the re-authentication itself is exempt"
        else:
            body = response.get_json()
            assert response.status_code == 403 and body["reason"] == "reauth_required", (method, rule)
            assert body["reauth_url"].endswith("/api/v1/admin/reauth")


def test_a_missing_or_future_auth_time_counts_as_stale(tmp_path):
    client = login(make_app(tmp_path, probe=True), ADMIN)
    assert fresh(client)
    for value in (None, "soon", 2e12):
        with client.session_transaction() as sess:
            if value is None:
                sess.pop("admin_auth_at")
            else:
                sess["admin_auth_at"] = value
        assert not fresh(client)


def test_reauth_window_is_configurable_and_zero_turns_it_off(tmp_path):
    client = login(make_app(tmp_path, probe=True, admin_reauth_minutes=0), ADMIN)
    with client.session_transaction() as sess:
        sess.pop("admin_auth_at")
    assert fresh(client)


def test_reauth_with_the_password_opens_the_window(tmp_path):
    app = make_app(tmp_path, probe=True)
    client = login(app, ADMIN)
    with client.session_transaction() as sess:
        sess["admin_auth_at"] -= 3600
    assert not fresh(client)
    bad = _call(client, "POST", "/api/v1/admin/reauth", unsafe_headers(client), {"password": "nope"})
    assert bad.status_code == 401 and bad.get_json()["reason"] == "bad_password"
    good = _call(client, "POST", "/api/v1/admin/reauth", unsafe_headers(client), {"password": "correct horse battery"})
    assert good.status_code == 200 and "reauth_until" in good.get_json()
    assert fresh(client)
    outcomes = [r["outcome"] for r in audit.read(app.admin_dir)]
    assert outcomes == ["ok", "refused:bad_password"]
    assert "nope" not in json.dumps(audit.read(app.admin_dir))


def test_reauth_failures_count_toward_the_lockout(tmp_path):
    app = make_app(tmp_path)
    client = login(app, ADMIN)
    statuses = [_call(client, "POST", "/api/v1/admin/reauth", unsafe_headers(client),
                      {"password": "nope"}).status_code for _ in range(6)]
    assert statuses[:4] == [401] * 4 and statuses[4:] == [423, 423]
    right = _call(client, "POST", "/api/v1/admin/reauth", unsafe_headers(client), {"password": "correct horse battery"})
    assert right.status_code == 423, "locked means locked, even for the right password"


def test_rate_limit(tmp_path, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(guard, "_now", lambda: clock[0])
    app = make_app(tmp_path, admin_rate_per_minute=2)
    client = login(app, ADMIN)
    # reads: 2 x 8 per minute
    assert [client.get("/api/v1/admin/audit").status_code for _ in range(16)] == [200] * 16
    limited = client.get("/api/v1/admin/audit")
    assert limited.status_code == 429 and limited.get_json()["reason"] == "admin_rate_limited"
    assert int(limited.headers["Retry-After"]) >= 1
    # writes have their own bucket: 2 per minute
    codes = [_call(client, "POST", "/api/v1/admin/reauth", unsafe_headers(client), {"password": "x"}).status_code
             for _ in range(3)]
    assert codes == [401, 401, 429]
    clock[0] += 60
    assert client.get("/api/v1/admin/audit").status_code == 200, "the bucket refills"
    # another admin has their own bucket
    from annzarro.server.auth import AuthManager
    AuthManager(user_file=app.config["user_file"]).create_user("boss", "correct horse battery", is_admin=True)
    other = login(app, "boss")
    assert other.get("/api/v1/admin/audit").status_code == 200


def test_the_order_of_the_checks(tmp_path):
    """Not logged in beats not admin beats CSRF beats JSON beats re-auth beats the rate limit."""
    app = make_app(tmp_path, probe=True)
    assert probe(app.test_client()).status_code == 401
    assert probe(login(app, USER)).get_json()["reason"] == "admin_only"
    admin = login(app, ADMIN)
    with admin.session_transaction() as sess:
        sess["admin_auth_at"] = 0
    token = {"X-AnnZarro-CSRF": csrf_of(admin)}
    assert probe(admin).get_json()["reason"] == "csrf_failed"
    assert probe(admin, **token).status_code == 415
    assert probe(admin, **token, **{"Content-Type": "application/json"}).get_json()["reason"] == "reauth_required"


def test_admin_replies_are_not_cached_and_not_framed(app):
    client = login(app, ADMIN)
    response = client.get("/api/v1/admin/audit")
    assert response.status_code == 200
    assert response.headers["Cache-Control"] == "no-store"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    refused = login(app, USER).get("/api/v1/admin/audit")
    assert refused.headers["Cache-Control"] == "no-store"


def test_the_page_for_a_user_is_an_html_403_with_the_csp(app):
    response = login(app, USER).get("/admin")
    assert response.status_code == 403 and response.mimetype == "text/html"
    csp = response.headers["Content-Security-Policy"]
    for part in ("default-src 'self'", "script-src 'self'", "img-src 'self' data:", "object-src 'none'",
                 "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'"):
        assert part in csp
    assert "unsafe-inline" not in csp.split("style-src")[0]


@pytest.mark.skipif(not os.path.exists(TEMPLATE), reason="templates/admin.html comes with the page shell")
def test_the_page_for_an_admin_carries_the_token_and_the_csp(app):
    client = login(app, ADMIN)
    response = client.get("/admin")
    assert response.status_code == 200
    assert f'content="{csrf_of(client)}"' in response.get_data(as_text=True)
    assert "script-src 'self'" in response.headers["Content-Security-Policy"]
    assert client.get("/admin/").status_code == 200


def test_an_old_session_without_a_token_gets_one_from_the_page(app, tmp_path):
    client = login(app, ADMIN)
    with client.session_transaction() as sess:
        sess.pop("csrf")
    if os.path.exists(TEMPLATE):
        assert client.get("/admin").status_code == 200
        assert csrf_of(client)


def test_a_demoted_admin_is_refused_on_the_next_request(app):
    client = login(app, ADMIN)
    assert client.get("/api/v1/admin/audit").status_code == 200
    from annzarro.server.auth import AuthManager
    AuthManager(user_file=app.config["user_file"]).set_admin(ADMIN, False)
    assert client.get("/api/v1/admin/audit").status_code == 403
