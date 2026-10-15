"""/datasets/folder sorts server-side before paging (stat data only); /datasets/search can be scoped to one folder."""
import os
import shutil

import pytest

from annzarro.server import access
from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app
from annzarro.server.routes import data_routes
from annzarro.tests.server.test_dataset_folders import FIXTURE, _app

PASSWORD = "pw-for-tests"


def _stamp(path, when):
    for member in (".zgroup", ".zattrs"):
        if os.path.exists(os.path.join(path, member)):
            os.utime(os.path.join(path, member), (when, when))
    os.utime(path, (when, when))


@pytest.fixture
def tree(tmp_path):
    """data/{b.zarr 300, a.zarr 100, c.zarr 200, d.zarr 100, zeta/ 150, alpha/ 250, projects/{liver/deep.zarr, heart/hdeep.zarr, top-liver.zarr}}."""
    data = tmp_path / "data"
    for name, when in (("b", 300), ("a", 100), ("c", 200), ("d", 100)):
        shutil.copytree(FIXTURE, data / f"{name}.zarr")
        _stamp(str(data / f"{name}.zarr"), when)
    for name, when in (("zeta", 150), ("alpha", 250)):
        (data / name).mkdir()
        os.utime(data / name, (when, when))
    (data / "projects" / "liver").mkdir(parents=True)
    (data / "projects" / "heart").mkdir()
    shutil.copytree(FIXTURE, data / "projects" / "liver" / "deep.zarr")
    shutil.copytree(FIXTURE, data / "projects" / "heart" / "hdeep.zarr")
    shutil.copytree(FIXTURE, data / "projects" / "top-liver.zarr")
    data_routes._LISTING_PROBE_CACHE.clear()
    yield tmp_path
    data_routes._LISTING_PROBE_CACHE.clear()


def folder(client, **args):
    return client.get("/api/v1/datasets/folder", query_string=args)


def names(body):
    return [e["name"] for e in body["entries"]]


# --- sort ---------------------------------------------------------------------------------

def test_default_order_is_unchanged(tree):
    body = folder(_app(tree).test_client()).get_json()
    assert names(body) == ["alpha", "projects", "zeta", "a.zarr", "b.zarr", "c.zarr", "d.zarr"]
    assert names(folder(_app(tree).test_client(), sort="name", order="asc").get_json()) == names(body)


def test_name_descending_keeps_folders_first(tree):
    assert names(folder(_app(tree).test_client(), sort="name", order="desc").get_json()) == \
        ["zeta", "projects", "alpha", "d.zarr", "c.zarr", "b.zarr", "a.zarr"]


def test_modified_orders_by_stat_time_with_name_as_the_tie_break(tree):
    client = _app(tree).test_client()
    asc = folder(client, sort="modified", order="asc").get_json()
    assert names(asc)[-4:] == ["a.zarr", "d.zarr", "c.zarr", "b.zarr"]     # a and d share a time: by name
    assert names(asc)[:3][0] == "zeta" or "zeta" in names(asc)[:3]
    desc = folder(client, sort="modified", order="desc").get_json()
    assert names(desc)[-4:] == ["b.zarr", "c.zarr", "a.zarr", "d.zarr"]     # ties still by name, ascending
    assert names(desc)[:3].index("alpha") < names(desc)[:3].index("zeta")   # folders first, newest first
    assert [e["kind"] for e in desc["entries"]] == ["folder"] * 3 + ["store"] * 4


def test_folders_carry_their_modification_time(tree):
    body = folder(_app(tree).test_client(), sort="modified").get_json()
    assert {e["name"]: e["modified"] for e in body["entries"] if e["kind"] == "folder"}["zeta"] == 150


def test_sorting_happens_before_paging(tree):
    client = _app(tree, dataset_folder_max_entries=3).test_client()
    seen = []
    for offset in (0, 3, 6):
        seen += names(folder(client, sort="modified", order="desc", offset=offset).get_json())
    whole = names(folder(_app(tree).test_client(), sort="modified", order="desc").get_json())
    assert seen == whole, "pages are slices of one stable order"


def test_sorting_opens_no_store_outside_the_page(tree, monkeypatch):
    calls = []
    real = data_routes.zarr_reader.get_basic_counts
    monkeypatch.setattr(data_routes.zarr_reader, "get_basic_counts", lambda p: (calls.append(p), real(p))[1])
    folder(_app(tree, dataset_folder_max_entries=2).test_client(), sort="modified", order="desc", offset=3)
    assert len(calls) <= 2


@pytest.mark.parametrize("args", [{"sort": "cells"}, {"order": "up"}, {"sort": "modified", "order": ""}])
def test_a_bad_sort_is_a_400(tree, args):
    reply = folder(_app(tree).test_client(), **args)
    assert reply.status_code == 400 and reply.get_json()["reason"] == "bad_sort"


# --- scoped search --------------------------------------------------------------------------

def search(client, q, **args):
    return client.get("/api/v1/datasets/search", query_string={"q": q, **args})


def test_a_scope_searches_below_that_folder_only(tree):
    client = _app(tree).test_client()
    assert sorted(e["name"] for e in search(client, "deep").get_json()["results"]) == ["deep.zarr", "hdeep.zarr"]
    scoped = search(client, "deep", folder="projects/liver").get_json()
    assert [e["name"] for e in scoped["results"]] == ["deep.zarr"] and scoped["results"][0]["cells"] == 200
    assert scoped["results"][0]["rel_path"] == os.path.join("projects", "liver", "deep.zarr")
    assert [e["name"] for e in search(client, "zarr", folder="projects/heart").get_json()["results"]] == ["hdeep.zarr"]


def test_the_path_is_matched_below_the_scope_not_above_it(tree):
    client = _app(tree).test_client()
    assert sorted(e["name"] for e in search(client, "liver").get_json()["results"]) == ["deep.zarr", "top-liver.zarr"]
    # "liver" is in the path of everything under projects/liver, but only because of the scope itself
    assert [e["name"] for e in search(client, "liver", folder="projects/liver").get_json()["results"]] == []
    assert [e["name"] for e in search(client, "projects", folder="projects").get_json()["results"]] == []
    assert [e["name"] for e in search(client, "liver/deep", folder="projects").get_json()["results"]] == ["deep.zarr"]


def test_a_scope_by_absolute_path_and_the_same_limits(tree):
    app = _app(tree, dataset_search_max_depth=1)
    client = app.test_client()
    scope = str(tree / "data" / "projects")
    found = search(client, "deep", folder=scope).get_json()
    assert found["results"] == [] and found["truncated"] is True, "depth counts from the scope"
    app.config["dataset_search_max_depth"] = 2
    assert len(search(client, "deep", folder=scope).get_json()["results"]) == 2
    app.config["dataset_folder_max_entries"] = 1
    capped = search(client, "zarr", folder=scope).get_json()
    assert len(capped["results"]) == 1 and capped["truncated"] is True


def test_a_missing_scope_is_the_missing_folder_reply(tree):
    reply = search(_app(tree).test_client(), "x", folder="nope")
    assert reply.status_code == 404 and reply.get_json()["reason"] == "not_found"


def test_a_store_as_scope_has_no_results(tree):
    body = search(_app(tree).test_client(), "zarr", folder="a.zarr").get_json()
    assert body["results"] == [] and body["truncated"] is False


def test_a_scoped_search_does_not_walk_the_admin_roots(tmp_path):
    import json
    from annzarro.tests.server.admin_helpers import ADMIN, login as admin_login, make_app, unsafe_headers
    parent = tmp_path / "atlases"
    shutil.copytree(FIXTURE, parent / "lab" / "labcells.zarr")
    (tmp_path / "data").mkdir(exist_ok=True)
    shutil.copytree(FIXTURE, tmp_path / "data" / "sub" / "own.zarr")
    app = make_app(tmp_path, admin_data_roots=[str(parent)])
    admin = admin_login(app, ADMIN)
    assert admin.post("/api/v1/admin/data-roots", data=json.dumps({"path": str(parent / "lab")}),
                      headers=unsafe_headers(admin)).status_code == 201
    assert [e["name"] for e in search(admin, "labcells").get_json()["results"]] == ["labcells.zarr"]
    assert search(admin, "labcells", folder="sub").get_json()["results"] == []
    assert [e["name"] for e in search(admin, "own", folder="sub").get_json()["results"]] == ["own.zarr"]
    assert [e["name"] for e in search(admin, "labcells", folder=str(parent / "lab")).get_json()["results"]] == ["labcells.zarr"]


def test_a_hosted_server_refuses_a_scope_outside_its_roots(tree):
    outside = tree / "outside"
    shutil.copytree(FIXTURE, outside / "secret.zarr")
    client = _app(tree, host="0.0.0.0").test_client()
    for scope in (str(outside), "../outside"):
        reply = search(client, "secret", folder=scope)
        assert reply.status_code == 403 and reply.get_json()["reason"] == "outside_data_dir", scope


@pytest.fixture
def shared(tree):
    data = tree / "data"
    manager = AuthManager(user_file=str(tree / "users.json"))
    manager.add_user("alice", PASSWORD, is_admin=True)
    manager.add_user("bob", PASSWORD, is_admin=False)
    app = _app(tree, auth_enabled=True)
    access.add_grant(app.config, "bob", "dir", str(data / "projects" / "liver"), actor="alice")
    access.set_restricted(app.config, "bob", True)
    return app


def login(app, name):
    client = app.test_client()
    assert client.post("/login", data={"username": name, "password": PASSWORD}).status_code == 302
    return client


def test_a_restricted_users_scope_must_be_inside_their_grants(shared, tree):
    bob = login(shared, "bob")
    data = tree / "data"
    inside = search(bob, "deep", folder=str(data / "projects" / "liver"))
    assert [e["name"] for e in inside.get_json()["results"]] == ["deep.zarr"]
    assert inside.get_json()["results"][0]["rel_path"] == os.path.join("liver", "deep.zarr")
    missing = search(bob, "deep", folder=str(data / "nope"))
    assert missing.status_code == 404
    for scope in (str(data), str(data / "projects"), str(data / "projects" / "heart"), "projects", ".."):
        reply = search(bob, "deep", folder=scope)
        assert (reply.status_code, reply.data) == (missing.status_code, missing.data), scope


def test_a_restricted_users_listing_sorts_their_grants(shared, tree):
    bob = login(shared, "bob")
    body = folder(bob, sort="modified", order="desc").get_json()
    assert names(body) == ["liver"] and body["entries"][0]["modified"] > 0
