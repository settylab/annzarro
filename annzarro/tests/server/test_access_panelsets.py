"""
Panel sets for a restricted user (annzarro/server/routes/data_routes.py, permissions.panelset_datasets).

A restricted user sees a set they own, and a set whose datasets they can all
read. For any other set, ``load``, ``export``, ``duplicate``, ``rename`` and
``delete`` answer exactly what they answer for a set that does not exist, and
``exists`` says it does not. A save over a hidden set is a 409 ``name_taken``
that does not name the owner. An import may name any path but opens nothing
outside the grants. Everyone else's replies are unchanged.
"""
import io
import json

import pytest

from annzarro.server import access, permissions
from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app
from annzarro.tests.server.rich_store import make_rich_store

PASSWORD = "pw-for-tests"
USERS = {"alice": True, "bob": False, "carol": False}


@pytest.fixture
def world(tmp_path):
    data = tmp_path / "data"
    for name in ("in.zarr", "out.zarr"):
        make_rich_store(data / name)
    make_rich_store(data / "pub" / "p1.zarr")
    manager = AuthManager(user_file=str(tmp_path / "users.json"))
    for name, admin in USERS.items():
        manager.add_user(name, PASSWORD, is_admin=admin)
    app = create_app({"TESTING": True, "host": "127.0.0.1", "data_dir": str(data), "log_file": str(tmp_path / "t.log"),
                      "auth_enabled": True, "user_file": str(tmp_path / "users.json"), "secret_key": "test-only-secret"})
    app.data = str(data)
    access.add_grant(app.config, "bob", "store", str(data / "in.zarr"), actor="alice")
    access.add_grant(app.config, "bob", "dir", str(data / "pub"), actor="alice")
    access.set_restricted(app.config, "bob", True)
    return app


def client(app, name):
    c = app.test_client()
    assert c.post("/login", data={"username": name, "password": PASSWORD}).status_code == 302
    return c


def save(c, name, dataset, **extra):
    body = {"name": name, "dataset": dataset, **extra}
    return c.post("/api/v1/sessions/save", json=body)


@pytest.fixture
def sets(world):
    """carol's set on in.zarr (readable by bob), carol's set on out.zarr (not), carol's set on pub/p1.zarr
    named by a relative path, and bob's own set on out.zarr, written before bob was restricted."""
    carol, bob = client(world, "carol"), client(world, "bob")
    assert save(carol, "on-in", "in.zarr").status_code == 200
    assert save(carol, "on-out", "out.zarr", datasetAbs=f"{world.data}/out.zarr").status_code == 200
    assert save(carol, "on-pub", "pub/p1.zarr", view={"store": {"path": "pub/p1.zarr"}}).status_code == 200
    access.set_restricted(world.config, "bob", False)
    assert save(bob, "bobs-old", "out.zarr").status_code == 200
    access.set_restricted(world.config, "bob", True)
    return world


def listed(c):
    return {s["name"]: s for s in c.get("/api/v1/sessions/list").get_json()}


def test_the_list_holds_own_sets_and_sets_on_readable_datasets(sets):
    assert sorted(listed(client(sets, "bob"))) == ["bobs-old", "on-in", "on-pub"]
    assert sorted(listed(client(sets, "carol"))) == ["bobs-old", "on-in", "on-out", "on-pub"]
    assert sorted(listed(client(sets, "alice"))) == ["bobs-old", "on-in", "on-out", "on-pub"]


def test_an_own_set_on_a_dataset_no_longer_readable_stays_listed_and_is_flagged(sets):
    entries = listed(client(sets, "bob"))
    assert entries["bobs-old"]["dataset_available"] is False
    assert entries["on-in"]["dataset_available"] is True and entries["on-pub"]["dataset_available"] is True
    assert "dataset_available" not in listed(client(sets, "carol"))["on-in"]      # unchanged for everyone else


def test_the_list_does_not_name_the_sessions_directory_to_a_restricted_user(sets):
    bob = client(sets, "bob")
    assert all(s["file"] is None for s in bob.get("/api/v1/sessions/list").get_json())
    assert sets.data not in bob.get("/api/v1/sessions/list").get_data(as_text=True)
    assert all(s["file"] for s in client(sets, "carol").get("/api/v1/sessions/list").get_json())


def test_a_hidden_set_is_the_reply_of_a_set_that_does_not_exist(sets):
    bob = client(sets, "bob")
    for method, url, query in (("get", "/api/v1/sessions/load", {"name": "on-out"}),
                               ("get", "/api/v1/sessions/export", {"name": "on-out"}),
                               ("delete", "/api/v1/sessions/delete", {"name": "on-out"}),
                               ("get", "/api/v1/sessions/load", {"file": f"{sets.data}/sessions/on-out.json"}),
                               ("get", "/api/v1/sessions/export", {"file": f"{sets.data}/sessions/on-out.json"})):
        hidden = getattr(bob, method)(url, query_string=query)
        absent_query = {k: v.replace("on-out", "no-such-set") for k, v in query.items()}
        absent = getattr(bob, method)(url, query_string=absent_query)
        assert hidden.status_code == 404, (url, query)
        assert hidden.get_data(as_text=True).replace("on-out", "X") == absent.get_data(as_text=True).replace("no-such-set", "X")
    # and the hidden set is untouched
    assert client(sets, "carol").get("/api/v1/sessions/load", query_string={"name": "on-out"}).status_code == 200


def test_a_visible_set_loads_exports_and_is_listed_for_a_restricted_user(sets):
    bob = client(sets, "bob")
    assert bob.get("/api/v1/sessions/load", query_string={"name": "on-in"}).get_json()["dataset"] == "in.zarr"
    assert bob.get("/api/v1/sessions/export", query_string={"name": "on-pub"}).status_code == 200


def test_exists_says_no_for_a_hidden_set_and_a_save_over_it_is_name_taken_without_the_owner(sets):
    bob = client(sets, "bob")
    reply = bob.get("/api/v1/sessions/exists", query_string={"name": "on-out"}).get_json()
    absent = bob.get("/api/v1/sessions/exists", query_string={"name": "no-such-set"}).get_json()
    assert reply["exists"] is False and reply["owner"] is None and reply["file"] is None
    assert {k: v for k, v in reply.items() if k != "sanitized_name"} == {k: v for k, v in absent.items() if k != "sanitized_name"}
    taken = save(bob, "on-out", "in.zarr")
    assert taken.status_code == 409 and taken.get_json()["reason"] == "name_taken"
    assert "carol" not in taken.get_data(as_text=True)
    # a visible set of someone else is the usual 403 (they can see who owns it)
    forbidden = save(bob, "on-in", "in.zarr")
    assert forbidden.status_code == 403 and forbidden.get_json()["owner"] == "carol"


def test_duplicate_and_rename_of_a_hidden_set_are_the_nonexistent_reply(sets):
    bob = client(sets, "bob")
    absent = bob.post("/api/v1/sessions/duplicate", json={"source_name": "no-such-set", "new_name": "copy"})
    hidden = bob.post("/api/v1/sessions/duplicate", json={"source_name": "on-out", "new_name": "copy"})
    assert hidden.status_code == 404
    assert hidden.get_data(as_text=True).replace("on-out", "X") == absent.get_data(as_text=True).replace("no-such-set", "X")
    absent = bob.post("/api/v1/sessions/rename", json={"old_name": "no-such-set", "new_name": "x"})
    hidden = bob.post("/api/v1/sessions/rename", json={"old_name": "on-out", "new_name": "x"})
    assert hidden.status_code == 404
    assert hidden.get_data(as_text=True).replace("on-out", "X") == absent.get_data(as_text=True).replace("no-such-set", "X")
    assert "copy" not in listed(client(sets, "carol")) and "x" not in listed(client(sets, "carol"))


def test_a_visible_set_can_be_duplicated_and_the_copy_is_theirs(sets):
    bob = client(sets, "bob")
    reply = bob.post("/api/v1/sessions/duplicate", json={"source_name": "on-in", "new_name": "mine"})
    assert reply.status_code == 200
    body = reply.get_json()
    assert body["session"]["owner"] == "bob" and body["source_file"] is None and body["new_file"] is None
    assert sets.data not in reply.get_data(as_text=True)


def test_duplicate_save_and_rename_need_the_datasets_readable(sets):
    bob = client(sets, "bob")
    # own set on a dataset that is no longer granted: cannot be copied or renamed, can be deleted
    copy = bob.post("/api/v1/sessions/duplicate", json={"source_name": "bobs-old", "new_name": "copy"})
    assert copy.status_code == 404 and "out.zarr" in copy.get_json()["error"] and sets.data not in copy.get_data(as_text=True)
    assert bob.post("/api/v1/sessions/rename", json={"old_name": "bobs-old", "new_name": "new"}).status_code == 404
    assert save(bob, "fresh", "out.zarr").status_code == 404
    assert save(bob, "fresh", "in.zarr", view={"store": {"path": "out.zarr"}}).status_code == 404
    assert save(bob, "fresh", "in.zarr", constants={"x": {"dataset_path": f"{sets.data}/out.zarr"}}).status_code == 404
    assert "fresh" not in listed(client(sets, "carol"))
    assert save(bob, "fresh", "in.zarr").status_code == 200
    assert bob.delete("/api/v1/sessions/delete", query_string={"name": "bobs-old"}).status_code == 200


def test_a_set_remembering_a_path_from_another_server_is_judged_by_its_dataset_alone(sets):
    carol = client(sets, "carol")
    assert save(carol, "elsewhere", "in.zarr", datasetAbs="/some/other/server/data/x.zarr",
                view={"store": {"path": "in.zarr", "abs": "/some/other/server/data/x.zarr"}}).status_code == 200
    assert "elsewhere" in listed(client(sets, "bob"))
    # but a hint that points at a store of THIS server which they may not read hides the set
    assert save(carol, "hint-out", "in.zarr", datasetAbs=f"{sets.data}/out.zarr").status_code == 200
    assert "hint-out" not in listed(client(sets, "bob"))


def test_import_may_name_any_path_but_opens_nothing_outside_the_grants(sets):
    bob = client(sets, "bob")
    payload = json.dumps({"name": "imported", "dataset": "out.zarr", "owner": "carol"}).encode()
    reply = bob.post("/api/v1/sessions/import", data={"file": (io.BytesIO(payload), "imported.json")},
                     content_type="multipart/form-data")
    assert reply.status_code == 200
    body = reply.get_json()
    assert body["session"]["owner"] == "bob" and body["file"] is None
    # it is theirs, flagged unavailable; opening its dataset is the gate's 404
    assert listed(bob)["imported"]["dataset_available"] is False
    assert bob.get("/api/v1/data/obs", query_string={"dataset_path": "out.zarr"}).status_code == 404
    # importing over a hidden set is name_taken
    clash = io.BytesIO(json.dumps({"name": "on-out", "dataset": "in.zarr"}).encode())
    reply = bob.post("/api/v1/sessions/import", data={"file": (clash, "on-out.json"), "overwrite": "true"},
                     content_type="multipart/form-data")
    assert reply.status_code == 409 and reply.get_json()["reason"] == "name_taken"


def test_nothing_changes_for_admins_and_unrestricted_users(sets):
    for who in ("alice", "carol"):
        c = client(sets, who)
        assert c.get("/api/v1/sessions/load", query_string={"name": "on-out"}).status_code == 200
        assert c.get("/api/v1/sessions/exists", query_string={"name": "on-out"}).get_json()["exists"] is True
    assert client(sets, "carol").post("/api/v1/sessions/duplicate",
                                      json={"source_name": "on-out", "new_name": "carols-copy"}).status_code == 200


def test_a_revoke_hides_the_sets_on_the_next_list(sets):
    bob = client(sets, "bob")
    assert "on-pub" in listed(bob)
    access.remove_grant(sets.config, "bob", f"{sets.data}/pub")
    assert "on-pub" not in listed(bob)
    assert bob.get("/api/v1/sessions/load", query_string={"name": "on-pub"}).status_code == 404


def test_panelset_datasets_reads_the_dataset_the_view_and_dataset_paths():
    named, hints = permissions.panelset_datasets({
        "dataset": "a.zarr", "datasetAbs": "/abs/a.zarr",
        "view": {"store": {"path": "b.zarr", "abs": "/abs/b.zarr"}},
        "panelConfigs": {"p1": {"config": {"dataset_path": "c.zarr"}}, "p2": [{"datasetPath": "d.zarr"}]},
        "constants": {"dataset": "not a path key in here"}})
    assert sorted(named) == ["a.zarr", "b.zarr", "c.zarr", "d.zarr"]
    assert sorted(hints) == ["/abs/a.zarr", "/abs/b.zarr"]
    assert permissions.panelset_datasets(None) == ([], []) and permissions.panelset_datasets({"dataset": 3}) == ([], [])
