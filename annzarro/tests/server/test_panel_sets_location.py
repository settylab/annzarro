"""Where panel sets live: the resolver and its legacy rule, the routes and admin pages in both
modes, the listing skips, and ``annzarro panel-sets migrate``."""
import argparse
import json
import os

import pytest
import yaml

from annzarro import cli
from annzarro.server import panel_sets
from annzarro.tests.server.admin_helpers import ADMIN, USER, login, make_app, unsafe_headers

@pytest.fixture(autouse=True)
def _state_from_the_config(monkeypatch):
    """The environment beats a config file; these tests name the state directory in the file."""
    for var in ("ANNZARRO_HOME", "ANNZARRO_SERVER_STATE_DIR"):
        monkeypatch.delenv(var, raising=False)


SESSIONS = "/api/v1/sessions"
ADMIN_SETS = "/api/v1/admin/panel-sets"


def _put(directory, name, **fields):
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, f"{name}.json")
    with open(path, "w") as f:
        json.dump({"name": name, "dataset": "d.zarr", **fields}, f)
    return path


def _config(tmp_path, **extra):
    return {"data_dir": str(tmp_path / "data"), "state_dir": str(tmp_path / "state"), **extra}


def _names(directory):
    return sorted(n for n in os.listdir(directory) if n.endswith(".json"))


# --- the resolver -------------------------------------------------------------------------------

def test_a_fresh_install_uses_the_state_directory(tmp_path):
    location = panel_sets.resolve(_config(tmp_path))
    assert (location.path, location.mode) == (str(tmp_path / "state" / "panel-sets"), panel_sets.STATE)
    assert location.note is None


def test_the_legacy_folder_with_sets_keeps_being_used(tmp_path):
    _put(tmp_path / "data" / "sessions", "old")
    location = panel_sets.resolve(_config(tmp_path))
    assert (location.path, location.mode) == (str(tmp_path / "data" / "sessions"), panel_sets.LEGACY)
    assert "legacy location" in location.note and "annzarro panel-sets migrate" in location.note
    assert panel_sets.is_legacy(_config(tmp_path))


def test_an_empty_legacy_folder_is_not_legacy_mode(tmp_path):
    os.makedirs(tmp_path / "data" / "sessions")
    (tmp_path / "data" / "sessions" / "notes.txt").write_text("x")
    assert panel_sets.resolve(_config(tmp_path)).mode == panel_sets.STATE


def test_once_the_new_folder_holds_sets_the_legacy_rule_ends(tmp_path):
    _put(tmp_path / "data" / "sessions", "old")
    _put(tmp_path / "state" / "panel-sets", "new")
    location = panel_sets.resolve(_config(tmp_path))
    assert (location.path, location.mode) == (str(tmp_path / "state" / "panel-sets"), panel_sets.STATE)


def test_an_empty_new_folder_does_not_end_it(tmp_path):
    _put(tmp_path / "data" / "sessions", "old")
    os.makedirs(tmp_path / "state" / "panel-sets")
    assert panel_sets.is_legacy(_config(tmp_path))


def test_an_explicit_key_wins_and_warns_about_leftover_legacy_sets(tmp_path):
    _put(tmp_path / "data" / "sessions", "old")
    config = _config(tmp_path, panel_sets_dir=str(tmp_path / "elsewhere"),
                     config_origins={"server.panel_sets_dir": "user"})
    location = panel_sets.resolve(config)
    assert (location.path, location.mode) == (str(tmp_path / "elsewhere"), panel_sets.EXPLICIT)
    assert "also exist" in location.note and "annzarro panel-sets migrate" in location.note


def test_a_derived_value_is_not_explicit(tmp_path):
    _put(tmp_path / "data" / "sessions", "old")
    config = _config(tmp_path, panel_sets_dir=str(tmp_path / "state" / "panel-sets"),
                     config_origins={"server.panel_sets_dir": "derived:state dir"})
    assert panel_sets.resolve(config).mode == panel_sets.LEGACY


def test_without_origins_a_value_other_than_the_default_is_explicit(tmp_path):
    _put(tmp_path / "data" / "sessions", "old")
    assert panel_sets.resolve(_config(tmp_path, panel_sets_dir=str(tmp_path / "elsewhere"))).mode == panel_sets.EXPLICIT


def test_top_level_skip_covers_legacy_and_a_migrated_leftover_but_not_an_empty_folder(tmp_path):
    config = _config(tmp_path)
    assert panel_sets.top_level_skip(config) == ()                                 # no folder
    old = _put(tmp_path / "data" / "sessions", "old")
    assert panel_sets.is_legacy(config) and panel_sets.top_level_skip(config) == ("sessions",)
    _put(tmp_path / "state" / "panel-sets", "old")                                 # migrated: not legacy now
    assert not panel_sets.is_legacy(config) and panel_sets.top_level_skip(config) == ("sessions",)
    os.unlink(old)                                                                 # emptied by hand
    assert panel_sets.top_level_skip(config) == ()


def test_ensure_creates_the_state_folder_private(tmp_path):
    path = panel_sets.ensure(_config(tmp_path))
    assert os.path.isdir(path) and os.stat(path).st_mode & 0o777 == 0o700


# --- the routes and admin pages, in both modes --------------------------------------------------

@pytest.fixture(params=["legacy", "state"])
def world(request, tmp_path):
    """An app whose panel sets are in the legacy folder (one seeded set) or the state directory."""
    data, state = tmp_path / "data", tmp_path / "state"
    data.mkdir()
    if request.param == "legacy":
        _put(data / "sessions", "seed", owner=USER)
        where = data / "sessions"
    else:
        where = state / "panel-sets"
        _put(where, "seed", owner=USER)
    app = make_app(tmp_path, state_dir=str(state))
    assert panel_sets.directory(app.config) == str(where)
    return app, str(where), request.param


def test_save_list_load_delete_use_the_resolved_folder(world):
    app, where, mode = world
    alice = login(app, USER)
    assert alice.post(f"{SESSIONS}/save", json={"name": "mine", "dataset": "d.zarr"}).status_code == 200
    assert "mine.json" in _names(where)
    if mode == "state":
        assert not os.path.exists(os.path.join(app.config["data_dir"], "sessions"))
    listed = alice.get(f"{SESSIONS}/list").get_json()
    assert {"seed", "mine"} <= {s.get("name") for s in listed}
    assert alice.get(f"{SESSIONS}/load?name=mine").status_code == 200
    assert alice.delete(f"{SESSIONS}/delete?name=mine", headers=unsafe_headers(alice)).status_code == 200
    assert "mine.json" not in _names(where)


def test_admin_pages_read_and_change_the_resolved_folder(world):
    app, where, _ = world
    root = login(app, ADMIN)
    names = [s["name"] for s in root.get(ADMIN_SETS).get_json()["items"]]
    assert "seed" in names
    reassigned = root.post(ADMIN_SETS + "/reassign", data=json.dumps({"names": ["seed"], "to_owner": ADMIN}),
                           headers=unsafe_headers(root))
    assert reassigned.status_code == 200
    with open(os.path.join(where, "seed.json")) as f:
        assert json.load(f)["owner"] == ADMIN
    deleted = root.open(ADMIN_SETS, method="DELETE", data=json.dumps({"names": ["seed"]}), headers=unsafe_headers(root))
    assert deleted.status_code == 200 and "seed.json" not in _names(where)


def test_admin_users_count_the_resolved_folder(world):
    app, _, _ = world
    root = login(app, ADMIN)
    users = root.get("/api/v1/admin/users").get_json()
    assert next(u for u in users if u["username"] == USER)["panel_sets"] == 1


def test_the_health_page_names_the_location(world):
    app, where, mode = world
    body = login(app, ADMIN).get("/api/v1/admin/health").get_json()["panel_sets"]
    assert body["path"] == where and body["legacy"] is (mode == "legacy")
    assert (body["note"] is not None) is (mode == "legacy")


def test_the_listing_hides_a_sessions_folder_that_holds_sets_and_shows_an_empty_one(world):
    app, _, mode = world
    old = os.path.join(app.config["data_dir"], "sessions")
    client = login(app, USER)

    def folders():
        return [e["name"] for e in client.get("/api/v1/datasets/folder").get_json()["entries"]]
    os.makedirs(old, exist_ok=True)
    if mode == "state":
        assert "sessions" in folders()                       # empty: a folder like any other
        _put(old, "leftover")                                # a copy left after migrating
    assert "sessions" not in folders()
    for name in os.listdir(old):
        if name.endswith(".json"):
            os.unlink(os.path.join(old, name))
    if mode == "state":
        assert "sessions" in folders()                       # emptied: listed again


# --- annzarro panel-sets migrate ----------------------------------------------------------------

def _run(tmp_path, *flags):
    config = tmp_path / "site.yaml"
    config.write_text(yaml.safe_dump({"server": {"data_dir": str(tmp_path / "data"), "state_dir": str(tmp_path / "state")}}))
    return cli.main(["panel-sets", "migrate", "--config", str(config), *flags])


@pytest.fixture
def legacy(tmp_path):
    sessions = tmp_path / "data" / "sessions"
    for name in ("a", "b"):
        _put(sessions, name, owner=USER)
    return sessions, tmp_path / "state" / "panel-sets"


def _snapshot(directory):
    return {n: open(os.path.join(directory, n), "rb").read() for n in os.listdir(directory)}


def test_migrate_copies_verifies_and_never_deletes(legacy, tmp_path, capsys):
    sessions, target = legacy
    before = _snapshot(sessions)
    assert _run(tmp_path) == 0
    assert _snapshot(target) == {n: b for n, b in before.items() if n.endswith(".json")}
    assert _snapshot(sessions) == before                                    # the source is untouched
    out = capsys.readouterr().out
    assert "Copied 2 panel set(s)" in out and f"You can now delete {sessions}" in out
    assert os.stat(target).st_mode & 0o777 == 0o700
    assert panel_sets.resolve({"data_dir": str(tmp_path / "data"), "state_dir": str(tmp_path / "state")}).mode == panel_sets.STATE


def test_a_dry_run_writes_nothing(legacy, tmp_path, capsys):
    sessions, target = legacy
    assert _run(tmp_path, "--dry-run") == 0
    assert not target.exists()
    assert "Would copy 2 panel set(s)" in capsys.readouterr().out


def test_migrate_is_idempotent(legacy, tmp_path, capsys):
    sessions, target = legacy
    assert _run(tmp_path) == 0 and _run(tmp_path) == 0
    assert "Copied 0 panel set(s); 2 already there and identical" in capsys.readouterr().out.split("From")[-1]
    assert _names(target) == ["a.json", "b.json"]


def test_a_differing_file_in_the_target_is_a_conflict_and_stays(legacy, tmp_path, capsys):
    sessions, target = legacy
    kept = _put(target, "a", owner="someone-else")
    mine = open(kept, "rb").read()
    assert _run(tmp_path) == 1
    out = capsys.readouterr().out
    assert "CONFLICT a.json" in out
    assert open(kept, "rb").read() == mine                                   # never overwritten
    assert "b.json" in _names(target) and _names(sessions) == ["a.json", "b.json"]


def test_a_failed_copy_is_reported_and_the_source_stays(legacy, tmp_path, monkeypatch, capsys):
    sessions, target = legacy
    real = panel_sets.shutil.copy2

    def flaky(src, dst, **kw):
        if src.endswith("b.json"):
            raise OSError("disk full")
        return real(src, dst, **kw)
    monkeypatch.setattr(panel_sets.shutil, "copy2", flaky)
    assert _run(tmp_path) == 1
    assert "FAILED   b.json" in capsys.readouterr().out
    assert _names(sessions) == ["a.json", "b.json"]


def test_migrate_refuses_when_the_target_is_the_source(tmp_path, capsys):
    config = tmp_path / "site.yaml"
    config.write_text(yaml.safe_dump({"server": {"data_dir": str(tmp_path / "data"),
                                                  "state_dir": str(tmp_path / "state"),
                                                  "panel_sets_dir": str(tmp_path / "data" / "sessions")}}))
    assert cli.main(["panel-sets", "migrate", "--config", str(config)]) == 1
    assert "nothing to copy" in capsys.readouterr().err


def test_migrate_with_no_legacy_folder_reports_nothing_to_do(tmp_path, capsys):
    assert _run(tmp_path) == 0
    assert "Copied 0 panel set(s)" in capsys.readouterr().out


# --- annzarro paths -----------------------------------------------------------------------------

def test_paths_shows_the_legacy_location_with_its_reason(legacy, tmp_path, capsys):
    config = tmp_path / "site.yaml"
    config.write_text(yaml.safe_dump({"server": {"data_dir": str(tmp_path / "data"), "state_dir": str(tmp_path / "state")}}))
    assert cli.main(["paths", "--config", str(config), "--format", "json"]) == 0
    entry = next(l for l in json.loads(capsys.readouterr().out)["locations"] if l["label"] == "panel sets")
    assert entry["path"] == str(legacy[0]) and entry["legacy"] is True
    assert entry["why"].startswith("legacy location: ") and "annzarro panel-sets migrate" in entry["why"]
