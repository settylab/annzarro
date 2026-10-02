"""CORS follows cors_enabled; it used to be on for every route regardless."""
from annzarro.server.core import create_app


def _client(tmp_path, **extra):
    (tmp_path / "data").mkdir(exist_ok=True)
    config = {"TESTING": True, "data_dir": str(tmp_path / "data"),
              "log_file": str(tmp_path / "test.log"), "auth_enabled": False}
    config.update(extra)
    return create_app(config).test_client()


def test_no_cors_headers_by_default(tmp_path):
    resp = _client(tmp_path).get("/api/v1/auth/me", headers={"Origin": "https://evil.example"})
    assert "Access-Control-Allow-Origin" not in resp.headers


def test_cors_when_enabled_is_limited_to_the_configured_origins(tmp_path):
    client = _client(tmp_path, cors_enabled=True, cors_origins=["https://ok.example"])
    ok = client.get("/api/v1/auth/me", headers={"Origin": "https://ok.example"})
    assert ok.headers.get("Access-Control-Allow-Origin") == "https://ok.example"
    assert "Access-Control-Allow-Credentials" not in ok.headers
    bad = client.get("/api/v1/auth/me", headers={"Origin": "https://evil.example"})
    assert "Access-Control-Allow-Origin" not in bad.headers
