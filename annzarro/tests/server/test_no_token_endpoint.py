"""POST /api/v1/auth/token issued JWTs that no route accepted (only the login
cookie is checked), and wrote each one into users.json. It is gone."""
import json

from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app


def test_token_endpoint_is_gone(tmp_path):
    users = tmp_path / "users.json"
    AuthManager(user_file=str(users)).create_user("alice", "pw")
    (tmp_path / "data").mkdir()
    app = create_app({"TESTING": True, "data_dir": str(tmp_path / "data"),
                      "log_file": str(tmp_path / "l.log"), "auth_enabled": True,
                      "user_file": str(users)})
    client = app.test_client()
    client.post("/login", data={"username": "alice", "password": "pw"})
    resp = client.post("/api/v1/auth/token", json={"username": "alice", "password": "pw"})
    assert resp.status_code in (404, 405)
    assert "token" not in (resp.get_json(silent=True) or {})
    assert "tokens" not in json.loads(users.read_text())["alice"]
    assert not hasattr(app.auth_manager, "create_token")
