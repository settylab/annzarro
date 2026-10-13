"""The pages that render the app or the login form carry what both the policy (policy/csp.py)
and the CSRF defence (csrf.py) put on them. Both rewrote the render functions, so each
property is held on every page: the CSP, the token, no-store and Vary: Cookie.
"""
import re

import pytest
from flask.testing import FlaskClient

from annzarro.server import csrf
from annzarro.tests.server.admin_helpers import PASSWORD, USER, make_app

LOGIN_CSP = "connect-src 'self' data: blob:"


def plain(app):
    return FlaskClient(app, app.response_class, use_cookies=True)


@pytest.fixture
def app(tmp_path):
    return make_app(tmp_path)


def signed_in(app):
    client = plain(app)
    page = client.get("/login").get_data(as_text=True)
    token = re.search(r'name="login_csrf" value="([^"]+)"', page).group(1)
    assert client.post("/login", data={"username": USER, "password": PASSWORD, "login_csrf": token}).status_code == 302
    return client


def assert_private_page(response):
    assert "Content-Security-Policy" in response.headers
    assert "no-store" in response.headers["Cache-Control"]
    assert "cookie" in response.headers["Vary"].lower()


@pytest.mark.parametrize("path", ["/", "/some/deep/path"])
def test_the_app_page_has_the_csp_the_token_and_is_private(app, path):
    client = signed_in(app)
    response = client.get(path)
    assert response.status_code == 200
    assert_private_page(response)
    token = re.search(r'<meta name="annzarro-csrf" content="([^"]+)"', response.get_data(as_text=True))
    assert token and token.group(1)


def test_the_login_page_has_the_csp_the_field_and_the_cookie(app):
    response = plain(app).get("/login")
    assert_private_page(response)
    assert response.headers["Content-Security-Policy"] == LOGIN_CSP
    assert re.search(r'name="login_csrf" value="[^"]+"', response.get_data(as_text=True))
    assert any(h.startswith(csrf.LOGIN_COOKIE + "=") for h in response.headers.getlist("Set-Cookie"))


def test_the_app_page_without_login_has_the_csp_and_an_empty_token(tmp_path):
    app = make_app(tmp_path, auth=False)
    response = app.test_client().get("/")
    assert_private_page(response)
    assert '<meta name="annzarro-csrf" content="">' in response.get_data(as_text=True)
