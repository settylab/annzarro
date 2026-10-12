"""The self-service change-password page and its endpoint."""
import json
import os

import pytest

from annzarro.server.admin import audit
from annzarro.server.auth import AuthManager
from annzarro.tests.server.admin_helpers import ADMIN, PASSWORD, USER, csrf_of, login, make_app, unsafe_headers
from annzarro.tests.server.test_admin_users import Logs

URL = "/api/v1/account/password"
NEW = "a fresh and long password"


@pytest.fixture
def app(tmp_path):
    return make_app(tmp_path)


def change(client, current=PASSWORD, new=NEW, headers=None, **extra):
    return client.post(URL, data=json.dumps({"current": current, "new": new}),
                       headers=headers if headers is not None else unsafe_headers(client, **extra))


def can_login(app, name, password):
    return app.test_client().post("/login", data={"username": name, "password": password}).status_code == 302


def test_the_page_needs_a_login_and_carries_the_token(app):
    anonymous = app.test_client()
    assert anonymous.get("/account/password").status_code == 302
    assert "/login" in anonymous.get("/account/password").headers["Location"]
    client = login(app, USER)
    page = client.get("/account/password")
    assert page.status_code == 200
    html = page.get_data(as_text=True)
    assert f'<meta name="annzarro-csrf" content="{csrf_of(client)}">' in html
    assert "<script>" not in html and "js/account.js" in html
    assert "script-src 'self'" in page.headers["Content-Security-Policy"]
    assert page.headers["Cache-Control"] == "no-store"


def test_without_login_there_is_no_account_page_or_endpoint(tmp_path):
    app = make_app(tmp_path, auth=False)
    client = app.test_client()
    assert "Change password" not in client.get("/account/password").get_data(as_text=True)
    assert client.post(URL, json={"current": "x", "new": "y"}).status_code in (404, 405)
    assert "account_password_change" not in app.view_functions


def test_anonymous_cannot_post(app):
    response = app.test_client().post(URL, data="{}", headers={"Content-Type": "application/json"})
    assert response.status_code == 401


def test_change_succeeds_ends_other_logins_and_keeps_this_one(app):
    mine, elsewhere = login(app, USER), login(app, USER)
    before = AuthManager(user_file=app.config["user_file"]).get_user(USER).last_login
    response = change(mine)
    assert response.status_code == 200 and response.get_json() == {"changed": True}
    assert mine.get("/api/v1/auth/me").status_code == 200, "this login stays"
    assert elsewhere.get("/api/v1/auth/me").status_code == 401, "the others end"
    assert can_login(app, USER, NEW) and not can_login(app, USER, PASSWORD)
    # signing in counts as a login; the change itself did not
    manager = AuthManager(user_file=app.config["user_file"])
    assert manager.get_user(USER).password_changed_at
    record = audit.read(app.admin_dir, limit=5)[-1]
    assert record["action"] == "account.password" and record["actor"] == USER and record["outcome"] == "ok"
    assert before is not None


def test_the_change_does_not_touch_last_login(app):
    client = login(app, USER)
    manager = AuthManager(user_file=app.config["user_file"])
    stamp = manager.get_user(USER).last_login
    assert change(client).status_code == 200
    assert AuthManager(user_file=app.config["user_file"]).get_user(USER).last_login == stamp


def test_passwords_reach_neither_logs_nor_audit(app):
    client = login(app, USER)
    with Logs() as logs:
        assert change(client).status_code == 200
        assert change(client, current="wrong-current-pw", new="whatever-new-pass").status_code == 403
    for secret in (NEW, PASSWORD, "wrong-current-pw", "whatever-new-pass"):
        assert secret not in logs.text
        assert secret not in open(os.path.join(app.admin_dir, "audit.jsonl")).read()


def test_a_wrong_current_password_changes_nothing(app):
    client = login(app, USER)
    response = change(client, current="not my password")
    assert response.status_code == 403 and response.get_json()["reason"] == "bad_password"
    assert can_login(app, USER, PASSWORD) and not can_login(app, USER, NEW)
    assert client.get("/api/v1/auth/me").status_code == 200


def test_wrong_current_passwords_are_rate_limited_by_the_lockout(app):
    client = login(app, USER)
    reasons = [change(client, current=f"guess number {i}").get_json()["reason"] for i in range(5)]
    assert reasons == ["bad_password"] * 4 + ["locked"]
    # now even the right password is refused for this address
    response = change(client)
    assert response.status_code == 423 and response.get_json()["reason"] == "locked"
    assert can_login(app, USER, PASSWORD) is False, "the lockout is the same one the login page uses"
    manager = AuthManager(user_file=app.config["user_file"])
    manager.unlock(USER)
    assert change(client).status_code == 200


def test_one_users_guesses_do_not_lock_another(app):
    mine, theirs = login(app, USER), login(app, ADMIN)
    for i in range(6):
        change(mine, current=f"guess {i}")
    assert change(theirs, new="another long password").status_code == 200


@pytest.mark.parametrize("new,reason", [("short", "weak_password"), (USER, "weak_password"), (PASSWORD, "same_password")])
def test_new_password_rules(app, new, reason):
    client = login(app, USER)
    response = change(client, new=new)
    assert response.status_code == 400 and response.get_json()["reason"] == reason
    assert can_login(app, USER, PASSWORD)


def test_missing_fields(app):
    client = login(app, USER)
    for body in ({}, {"current": PASSWORD}, {"new": NEW}, {"current": "", "new": NEW}, {"current": 5, "new": NEW}):
        response = client.post(URL, data=json.dumps(body), headers=unsafe_headers(client))
        assert response.status_code == 400 and response.get_json()["reason"] == "bad_request", body


def test_csrf_origin_and_content_type_are_enforced(app):
    client = login(app, USER)
    token = csrf_of(client)
    # an empty header: the conftest's browser-like client adds the token to a request that has none
    for headers in ({"Content-Type": "application/json", "X-AnnZarro-CSRF": ""},
                    {"Content-Type": "application/json", "X-AnnZarro-CSRF": "nope"},
                    {"Content-Type": "application/json", "X-AnnZarro-CSRF": token, "Origin": "https://evil.example"},
                    {"Content-Type": "application/json", "X-AnnZarro-CSRF": token, "Sec-Fetch-Site": "cross-site"}):
        response = change(client, headers=headers)
        assert response.status_code == 403 and response.get_json()["reason"] == "csrf_failed", headers
    form = client.post(URL, data={"current": PASSWORD, "new": NEW}, headers={"X-AnnZarro-CSRF": token})
    assert form.status_code == 415
    assert can_login(app, USER, PASSWORD) and not can_login(app, USER, NEW)


def test_a_wrong_token_does_not_count_as_a_password_guess(app):
    client = login(app, USER)
    for _ in range(8):
        change(client, headers={"Content-Type": "application/json", "X-AnnZarro-CSRF": "nope"})
    assert change(client).status_code == 200


def test_account_routes_declare_a_gate(app):
    from annzarro.server import access
    for endpoint in ("account_password_page", "account_password_change"):
        assert access.gate_of(app, endpoint) == "public"


# Pages that do not send a Content-Security-Policy yet. Empty since the policy slice (P1) gave the
# main page and the login page theirs; a page added without one is named here or fails the walk.
NO_CSP_YET = set()


def test_every_html_page_sends_a_content_security_policy(app):
    """A page is any argument-free GET route, or "/", whose answer is HTML (an HTML error page
    counts). A future page cannot ship without a policy, and the list above only shrinks."""
    client = login(app, ADMIN)
    paths = {"/", "/some/deep/link"} | {r.rule for r in app.url_map.iter_rules()
                     if "GET" in r.methods and not r.arguments and r.rule != "/logout"}
    html, stale = set(), set()
    for path in sorted(paths):
        response = client.get(path)
        if "text/html" not in response.headers.get("Content-Type", ""):
            continue
        html.add(path)
        has = bool(response.headers.get("Content-Security-Policy"))
        if path in NO_CSP_YET:
            stale |= {path} if has else set()
        else:
            assert has, f"{path} renders HTML without a Content-Security-Policy"
    assert {"/admin", "/account/password"} <= html, "the walk found the pages it is meant to guard"
    assert not stale, f"{sorted(stale)} now send a policy: remove them from NO_CSP_YET"
    assert NO_CSP_YET <= html, "NO_CSP_YET names a path that is not an HTML page"
