"""The catch-all route must not serve files from outside the frontend.

It used to default to the directory ABOVE the package: the repository in a
checkout (pyproject, configs with secret placeholders, server source) and
site-packages in a pip install (every installed package's files).
"""
import pytest

from annzarro.server.core import create_app


@pytest.fixture
def client(tmp_path):
    return create_app({"auth_enabled": False, "data_dir": str(tmp_path)}).test_client()


@pytest.mark.parametrize("path", [
    "/pyproject.toml",
    "/annzarro/config/production.yaml",
    "/annzarro/server/auth.py",
    "/annzarro/__init__.py",
])
def test_files_outside_the_frontend_are_not_served(client, path):
    resp = client.get(path)
    body = resp.get_data()
    # Unknown paths fall back to the single-page app shell, never file content.
    assert resp.status_code in (200, 404)
    assert body.lstrip().startswith(b"<!DOCTYPE html>") or resp.status_code == 404, body[:80]


def test_frontend_files_are_still_served(client):
    assert client.get("/static/js/main.js").status_code == 200
    assert client.get("/favicon.ico").status_code == 200
