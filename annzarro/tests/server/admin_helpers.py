"""Shared setup of the admin interface tests: an app with login on, an admin and a user."""
import os

from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app

ADMIN, USER = "root", "alice"
PASSWORD = "correct horse battery"


def make_app(tmp_path, auth=True, probe=False, **config):
    users = tmp_path / "users" / "users.json"
    users.parent.mkdir(exist_ok=True)
    manager = AuthManager(user_file=str(users))
    if not manager.get_users():
        manager.create_user(ADMIN, PASSWORD, is_admin=True)
        manager.create_user(USER, PASSWORD)
    data = tmp_path / "data"
    data.mkdir(exist_ok=True)
    settings = {"TESTING": True, "data_dir": str(data), "log_file": str(tmp_path / "app.log"),
                "auth_enabled": auth, "user_file": str(users)}
    settings.update(config)
    app = create_app(settings)
    # the clients behave like the page (login form token, request token), in a spawned
    # process too, where the conftest's fixture does not reach (slice C's CSRF)
    from annzarro.tests.conftest import _BrowsesLikeAPage
    app.test_client_class = _BrowsesLikeAPage
    if probe:
        # a guarded view with no behaviour of its own, to test the guard's order of checks
        from annzarro.server.admin.guard import require_admin
        app.add_url_rule("/api/v1/admin/_probe", "admin_probe",
                         require_admin(lambda: {"ok": True}), methods=["POST"])
    app.admin_dir = os.path.join(os.path.dirname(str(users)), "annzarro_admin")
    return app


def login(app, username):
    client = app.test_client()
    response = client.post("/login", data={"username": username, "password": PASSWORD})
    assert response.status_code == 302, response.status_code
    return client


def csrf_of(client):
    with client.session_transaction() as sess:
        return sess["csrf"]


def unsafe_headers(client, **extra):
    headers = {"X-AnnZarro-CSRF": csrf_of(client), "Content-Type": "application/json"}
    headers.update(extra)
    return headers


def admin_rules(app):
    """(rule, method, concrete path) for every admin route."""
    out = []
    for rule in app.url_map.iter_rules():
        if rule.rule == "/admin" or rule.rule.startswith("/api/v1/admin/"):
            path = rule.rule
            for arg in rule.arguments:
                path = path.replace(f"<{arg}>", "x")
            for method in sorted(rule.methods - {"HEAD", "OPTIONS"}):
                out.append((rule.rule, method, path))
    return out


def probe(client, **headers):
    """POST to the probe view; ``headers`` as given (none by default)."""
    return client.post("/api/v1/admin/_probe", data="{}", headers=headers)


def fresh(client):
    """Whether the guard lets an otherwise valid change through right now."""
    return probe(client, **unsafe_headers(client)).status_code == 200
