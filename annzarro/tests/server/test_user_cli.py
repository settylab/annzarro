"""
`annzarro user passwd` and `annzarro user set-admin [--no-admin]` change a user
in place (previously: remove and re-add, losing nothing but awkward and racy).
A password change, or removing the user, ends their existing logins.
"""
import os

import pytest

from annzarro import cli
from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app


@pytest.fixture
def users(tmp_path, monkeypatch):
    for var in list(os.environ):
        if var.startswith("ANNZARRO_"):
            monkeypatch.delenv(var)
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path / ".config"))
    monkeypatch.chdir(tmp_path)
    path = tmp_path / "users.json"
    cfg = tmp_path / "site.yaml"
    cfg.write_text(f"server:\n  log_file: \"{tmp_path / 'l.log'}\"\nauth:\n  user_file: \"{path}\"\n")
    AuthManager(user_file=str(path)).create_user("alice", "old")
    return path, str(cfg)


def _run(cfg, *argv):
    return cli.main(["--config", cfg, "user", *argv])


def test_passwd_changes_password_in_place(users):
    path, cfg = users
    assert _run(cfg, "passwd", "--username", "alice", "--password", "new") == 0
    manager = AuthManager(user_file=str(path))
    assert manager.authenticate("alice", "new")
    assert not manager.authenticate("alice", "old")


def test_passwd_unknown_user_fails(users):
    _, cfg = users
    assert _run(cfg, "passwd", "--username", "bob", "--password", "x") == 1


def test_set_admin_and_revoke(users):
    path, cfg = users
    AuthManager(user_file=str(path)).create_user("carol", "pw", is_admin=True)   # revoking needs another admin left
    assert _run(cfg, "set-admin", "--username", "alice") == 0
    assert AuthManager(user_file=str(path)).get_user("alice").is_admin is True
    assert _run(cfg, "set-admin", "--username", "alice", "--no-admin") == 0
    assert AuthManager(user_file=str(path)).get_user("alice").is_admin is False
    assert _run(cfg, "set-admin", "--username", "bob") == 1


def test_the_last_admin_is_refused_unless_forced(users):
    path, cfg = users
    assert _run(cfg, "set-admin", "--username", "alice") == 0
    assert _run(cfg, "set-admin", "--username", "alice", "--no-admin") == 1
    assert _run(cfg, "remove", "--username", "alice") == 1
    manager = AuthManager(user_file=str(path))
    assert manager.get_user("alice").is_admin is True
    assert _run(cfg, "set-admin", "--username", "alice", "--no-admin", "--force") == 0
    assert AuthManager(user_file=str(path)).get_user("alice").is_admin is False
    assert _run(cfg, "set-admin", "--username", "alice") == 0
    assert _run(cfg, "remove", "--username", "alice", "--force") == 0
    assert AuthManager(user_file=str(path)).get_user("alice") is None


def test_removing_a_user_when_there_is_no_admin_at_all_is_not_blocked(users):
    path, cfg = users
    AuthManager(user_file=str(path)).create_user("bob", "pw")
    assert _run(cfg, "remove", "--username", "bob") == 0


def test_cli_changes_are_audited_with_their_origin(users):
    from annzarro.server.admin import audit
    path, cfg = users
    assert _run(cfg, "add", "--username", "carol", "--password", "secret-carol-pw", "--admin") == 0
    assert _run(cfg, "passwd", "--username", "carol", "--password", "another-secret-pw") == 0
    assert _run(cfg, "set-admin", "--username", "alice") == 0
    assert _run(cfg, "set-admin", "--username", "carol", "--no-admin") == 0
    assert _run(cfg, "unlock", "--username", "alice") == 0
    assert _run(cfg, "remove", "--username", "carol") == 0
    assert _run(cfg, "remove", "--username", "alice") == 1          # the last admin
    directory = os.path.join(os.path.dirname(str(path)), "annzarro_admin")
    records = list(reversed(audit.read(directory, limit=50)))
    assert [(r["action"], r["target"], r["outcome"]) for r in records] == [
        ("user.add", "carol", "ok"), ("user.password", "carol", "ok"), ("user.set_admin", "alice", "ok"),
        ("user.set_admin", "carol", "ok"), ("user.unlock", "alice", "ok"), ("user.remove", "carol", "ok"),
        ("user.remove", "alice", "refused:last_admin")]
    assert {r["via"] for r in records} == {"cli:" + __import__("getpass").getuser()}
    assert audit.verify(directory)["ok"]
    raw = open(os.path.join(directory, "audit.jsonl")).read()
    assert "secret-carol-pw" not in raw and "another-secret-pw" not in raw and "password_hash" not in raw


def test_audit_verify_command(users, capsys):
    path, cfg = users
    assert cli.main(["--config", cfg, "admin", "audit", "verify"]) == 0       # no log yet
    assert _run(cfg, "add", "--username", "carol", "--password", "pw-for-carol-1") == 0
    assert _run(cfg, "set-admin", "--username", "carol") == 0
    assert cli.main(["--config", cfg, "admin", "audit", "verify"]) == 0
    assert "Audit log OK" in capsys.readouterr().out
    log = os.path.join(os.path.dirname(str(path)), "annzarro_admin", "audit.jsonl")
    lines = open(log).read().splitlines()
    lines[0] = lines[0].replace('"carol"', '"mallory"')
    open(log, "w").write("\n".join(lines) + "\n")
    assert cli.main(["--config", cfg, "admin", "audit", "verify"]) == 1
    assert "BROKEN at seq 1" in capsys.readouterr().out


def _app(tmp_path, path):
    (tmp_path / "data").mkdir(exist_ok=True)
    return create_app({"TESTING": True, "host": "127.0.0.1", "data_dir": str(tmp_path / "data"),
                       "log_file": str(tmp_path / "t.log"), "auth_enabled": True,
                       "user_file": str(path)})


def test_password_change_signs_out_existing_logins(users, tmp_path):
    path, cfg = users
    client = _app(tmp_path, path).test_client()
    client.post("/login", data={"username": "alice", "password": "old"})
    assert client.get("/api/v1/auth/me").status_code == 200
    assert _run(cfg, "passwd", "--username", "alice", "--password", "new") == 0
    assert client.get("/api/v1/auth/me").status_code == 401
    client.post("/login", data={"username": "alice", "password": "new"})
    assert client.get("/api/v1/auth/me").status_code == 200


def test_removed_user_is_signed_out(users, tmp_path):
    path, cfg = users
    client = _app(tmp_path, path).test_client()
    client.post("/login", data={"username": "alice", "password": "old"})
    assert client.get("/api/v1/auth/me").status_code == 200
    assert _run(cfg, "remove", "--username", "alice") == 0
    assert client.get("/api/v1/auth/me").status_code == 401


def test_user_commands_load_the_production_environment_like_start(users, monkeypatch):
    """`annzarro user` loaded the development defaults while `start` loads
    production, so a user_file set for production could differ."""
    from annzarro.utils.config_manager import ConfigManager
    seen = []
    real = ConfigManager.load_config

    def spy(self, env="development", *a, **kw):
        seen.append(env)
        return real(self, env, *a, **kw)
    monkeypatch.setattr(ConfigManager, "load_config", spy)
    _, cfg = users
    assert cli.main(["user", "--config", cfg, "list"]) == 0, "--config after `user` is accepted"
    assert seen == ["production"]


def test_user_add_help_states_what_admin_grants(capsys):
    """`--admin` once said it "grants nothing else", but by default an admin may open
    any path the server account can read (server.arbitrary_paths: admins)."""
    with pytest.raises(SystemExit) as exc:
        cli.main(["user", "add", "--help"])
    assert exc.value.code == 0
    text = " ".join(capsys.readouterr().out.split())
    assert "nothing else" not in text
    for needle in ("any dataset path", "server.arbitrary_paths", "local-only", "reassign", "cache"):
        assert needle in text, needle


# --- annzarro user access ------------------------------------------------------------

@pytest.fixture
def access_site(users, tmp_path):
    from annzarro.tests.server.rich_store import make_rich_store
    path, cfg = users
    data = tmp_path / "data"
    make_rich_store(data / "in.zarr")
    make_rich_store(data / "curated" / "a.zarr")
    make_rich_store(data / "curated" / "b.zarr")
    (data / "pub").mkdir()
    (tmp_path / "outside").mkdir()
    with open(cfg, "a") as f:
        f.write("")
    text = open(cfg).read().replace("server:\n", f"server:\n  data_dir: \"{data}\"\n", 1)
    open(cfg, "w").write(text)
    AuthManager(user_file=str(path)).create_user("bob", "pw")
    AuthManager(user_file=str(path)).create_user("root", "pw", is_admin=True)
    return path, cfg, data


def _entry(path, user="bob"):
    import json
    state = os.path.join(os.path.dirname(str(path)), "annzarro_admin", "access.json")
    if not os.path.exists(state):
        return None
    return json.load(open(state))["principals"].get(f"user:{user}")


def test_access_restrict_grant_revoke_and_show(access_site, capsys):
    path, cfg, data = access_site
    assert _run(cfg, "access", "bob", "--restrict", "--grant", str(data / "in.zarr"), "--grant", str(data / "pub")) == 0
    entry = _entry(path)
    assert entry["restricted"] is True
    assert [(g["kind"], g["path"]) for g in entry["grants"]] == [("store", str(data / "in.zarr")), ("dir", str(data / "pub"))]
    assert all(g["added_by"] and g["added_at"] for g in entry["grants"])
    assert _run(cfg, "access", "bob", "--show") == 0
    out = capsys.readouterr().out
    assert "restricted to the grants below" in out and "in.zarr" in out and "(active)" in out
    assert _run(cfg, "access", "bob", "--revoke", str(data / "pub")) == 0
    assert [g["path"] for g in _entry(path)["grants"]] == [str(data / "in.zarr")]
    assert _run(cfg, "access", "bob", "--revoke", str(data / "pub")) == 1       # nothing to revoke
    assert _run(cfg, "access", "bob", "--unrestrict") == 0
    assert "restricted" not in _entry(path) and len(_entry(path)["grants"]) == 1     # the grants are kept


def test_access_grant_stores_in_a_folder(access_site):
    path, cfg, data = access_site
    os.symlink(data / "in.zarr", data / "curated" / "linked.zarr")
    os.symlink(data.parent / "outside", data / "curated" / "escape.zarr")
    assert _run(cfg, "access", "bob", "--restrict", "--grant-stores-in", str(data / "curated")) == 0
    paths = sorted(os.path.basename(g["path"]) for g in _entry(path)["grants"])
    assert paths == ["a.zarr", "b.zarr", "linked.zarr"]          # the link out of the data directory is skipped
    assert all(g["kind"] == "store" for g in _entry(path)["grants"])


def test_access_refuses_what_the_server_would(access_site):
    path, cfg, data = access_site
    assert _run(cfg, "access", "nobody", "--restrict") == 1
    assert _run(cfg, "access", "root", "--restrict") == 1                  # admins are never restricted
    assert _entry(path, "root") is None
    assert _run(cfg, "access", "bob", "--grant", str(data.parent / "outside")) == 1      # outside every data directory
    assert _run(cfg, "access", "bob", "--grant", str(data / "missing")) == 1
    assert _run(cfg, "access", "bob", "--grant", str(data / "pub")) == 0
    assert _run(cfg, "access", "bob", "--grant", str(data / "pub")) == 1                 # already granted
    assert _run(cfg, "access", "bob", "--grant", "s3://bucket/x/") == 1                  # remote stores are not enabled here


def test_access_changes_are_audited(access_site):
    from annzarro.server.admin import audit, state_dir
    path, cfg, data = access_site
    assert _run(cfg, "access", "bob", "--restrict", "--grant", str(data / "pub")) == 0
    assert _run(cfg, "access", "root", "--restrict") == 1
    records = audit.read(state_dir({"user_file": str(path)}), limit=50)
    actions = [(r["action"], r["outcome"]) for r in records]
    assert ("access.restrict", "ok") in actions and ("access.grant", "ok") in actions
    assert ("access.restrict", "refused:admin") in actions


def test_removing_a_user_drops_their_access_entry(access_site):
    path, cfg, data = access_site
    assert _run(cfg, "access", "bob", "--restrict", "--grant", str(data / "pub")) == 0
    assert _run(cfg, "remove", "--username", "bob") == 0
    assert _entry(path) is None
||||||| 47311c6
=======


def test_the_cli_refuses_to_run_as_another_account(users, monkeypatch):
    """`sudo annzarro user add` would create root-owned files the server cannot write."""
    path, cfg = users
    monkeypatch.setattr(cli, "_dir_owner", lambda directory: (os.geteuid() + 1, "svc-annzarro"))
    assert _run(cfg, "add", "--username", "carol", "--password", "pw") == 1
    assert _run(cfg, "set-admin", "--username", "alice") == 1
    assert AuthManager(user_file=str(path)).get_user("carol") is None
    assert AuthManager(user_file=str(path)).get_user("alice").is_admin is False
    assert not os.path.exists(os.path.join(os.path.dirname(str(path)), "annzarro_admin"))
    assert "sudo -u svc-annzarro" in cli._wrong_account(str(path))
    assert _run(cfg, "list") == 0, "listing changes nothing, so any account may"
    monkeypatch.setattr(cli, "_dir_owner", lambda directory: (os.geteuid(), "me"))
    assert _run(cfg, "add", "--username", "carol", "--password", "pw") == 0
>>>>>>> github/dominik/v050-users
