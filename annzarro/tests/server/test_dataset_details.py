"""/api/v1/datasets/details: one store's root metadata and budgeted store check for the dataset browser.

Metadata only (never X), cached by the stat signature, bounded by a time budget, and answering for a store
the requester may not read exactly as it does for one that is not there.
"""
import os
import shutil
import time

import pytest
import zarr

from annzarro.core import store_check
from annzarro.server import access
from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app
from annzarro.server.routes import data_routes, dataset_details
from annzarro.tests.core.h5ad_twin import h5ad_twin
from annzarro.tests.core.test_store_check import new_store

DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
FIXTURE = os.path.join(DATA, "fixture_small.zarr")
FIXTURE_V3 = os.path.join(DATA, "fixture_small_v3.zarr")
PASSWORD = "pw-for-tests"
ZARR3 = int(zarr.__version__.split(".")[0]) >= 3

URL = "/api/v1/datasets/details"


def _config(tmp_path, **extra):
    config = {"TESTING": True, "host": "127.0.0.1", "data_dir": str(tmp_path / "data"),
              "log_file": str(tmp_path / "t.log"), "user_file": str(tmp_path / "users.json"),
              "secret_key": "test-only-secret"}
    config.update(extra)
    return config


@pytest.fixture(autouse=True)
def fresh_caches():
    data_routes._LISTING_PROBE_CACHE.clear()
    dataset_details.clear_cache()
    yield
    data_routes._LISTING_PROBE_CACHE.clear()
    dataset_details.clear_cache()


@pytest.fixture
def data(tmp_path):
    root = tmp_path / "data"
    root.mkdir()
    shutil.copytree(FIXTURE, root / "v2.zarr")
    shutil.copytree(FIXTURE_V3, root / "v3.zarr")
    h5ad_twin(FIXTURE, root / "table.h5ad")
    (root / "sub").mkdir()
    shutil.copytree(FIXTURE, root / "sub" / "deep.zarr")
    os.symlink(root / "v2.zarr", root / "link.zarr")
    return root


@pytest.fixture
def app(tmp_path, data):
    return create_app(_config(tmp_path))


@pytest.fixture
def client(app):
    return app.test_client()


def details(client, path, **args):
    return client.get(URL, query_string={"path": str(path), **args})


# --- what it says -------------------------------------------------------------------------

def test_zarr_v2_store(client, data):
    body = details(client, data / "v2.zarr").get_json()
    assert body["name"] == "v2.zarr" and body["path"] == str(data / "v2.zarr") and body["rel_path"] == "v2.zarr"
    assert (body["cells"], body["genes"]) == (200, 20)
    assert (body["format"], body["zarr_format"], body["sharded"]) == ("zarr format 2", 2, False)
    assert body["modified"] > 0 and body["size_bytes"] is None and body["readable"] and body["error"] is None
    assert {"name": "cell_type", "kind": "categorical"} in body["obs_columns"]
    assert {"name": "total_counts", "kind": "float"} in body["obs_columns"]
    assert body["obs_columns_total"] == 3 and [c["name"] for c in body["var_columns"]] == ["gene_name"]
    assert body["obsm_keys"] == ["X_umap"] and body["layers_keys"] == [] and body["uns_count"] == 0
    assert body["is_link"] is False and body["link_target"] is None


@pytest.mark.skipif(not ZARR3, reason="zarr format 3 needs zarr >= 3")
def test_zarr_v3_store(client, data):
    body = details(client, data / "v3.zarr").get_json()
    assert (body["format"], body["zarr_format"], body["sharded"]) == ("zarr format 3", 3, False)
    assert (body["cells"], body["genes"]) == (200, 20) and body["obsm_keys"] == ["X_umap"]


@pytest.mark.skipif(not ZARR3, reason="zarr format 3 needs zarr >= 3")
def test_sharded_store(tmp_path):
    root = tmp_path / "data"
    root.mkdir()
    group = new_store(root / "sharded.zarr", 3, n_obs=2000, n_vars=50, x="dense")
    del group["X"]
    group.create_array("X", shape=(2000, 50), dtype="float32", chunks=(100, 50), shards=(1000, 50))
    body = details(create_app(_config(tmp_path)).test_client(), root / "sharded.zarr").get_json()
    assert (body["format"], body["zarr_format"], body["sharded"]) == ("zarr format 3, sharded", 3, True)
    assert (body["cells"], body["genes"]) == (2000, 50)


def test_a_store_on_another_drive_than_the_data_directory(client, tmp_path, monkeypatch):
    """On Windows ``os.path.relpath`` raises ValueError across drives (the desktop app's data
    directory on C:, a store opened from D:): the details answer with the absolute path instead of
    a 500 (found by the Windows build's packaged-app test of v0.5.2)."""
    other = tmp_path / "other"
    other.mkdir()
    shutil.copytree(FIXTURE, other / "elsewhere.zarr")
    real_relpath = os.path.relpath

    def windows_relpath(path, start=os.curdir):
        if str(other) in str(path):
            raise ValueError("path is on mount 'D:', start on mount 'C:'")
        return real_relpath(path, start)
    monkeypatch.setattr(os.path, "relpath", windows_relpath)
    reply = details(client, other / "elsewhere.zarr")
    assert reply.status_code == 200, reply.get_json()
    body = reply.get_json()
    assert body["rel_path"] == str(other / "elsewhere.zarr") and (body["cells"], body["genes"]) == (200, 20)


def test_h5ad_file(client, data):
    body = details(client, data / "table.h5ad").get_json()
    assert body["format"] == "h5ad" and body["zarr_format"] is None
    assert body["size_bytes"] == os.path.getsize(data / "table.h5ad") > 0
    assert (body["cells"], body["genes"]) == (200, 20)
    assert sorted(c["name"] for c in body["obs_columns"]) == ["cell_type", "leiden", "total_counts"]
    assert body["obsm_keys"] == ["X_umap"]
    assert body["store_check"]["ran"] is False and body["store_check"]["reason"] == "h5ad"


def test_a_relative_path_is_in_the_data_directory(client, data):
    body = details(client, "sub/deep.zarr").get_json()
    assert body["path"] == str(data / "sub" / "deep.zarr") and body["rel_path"] == os.path.join("sub", "deep.zarr")


def test_a_link_names_its_target(client, data):
    body = details(client, data / "link.zarr").get_json()
    assert body["is_link"] is True and body["link_target"] == os.path.realpath(data / "v2.zarr")


def test_a_broken_store_is_a_200_with_the_reason(client, data):
    (data / "broken.zarr").mkdir()
    body = details(client, data / "broken.zarr").get_json()
    assert body["readable"] is False and body["error"] and body["cells"] is None
    assert body["store_check"]["ran"] is False and body["store_check"]["reason"] == "unreadable"


def test_a_missing_store_answers_as_data_info_does(client, data):
    gone = data / "gone.zarr"
    mine = details(client, gone)
    theirs = client.get("/api/v1/data/info", query_string={"dataset_path": str(gone)})
    assert (mine.status_code, mine.get_json()) == (theirs.status_code, theirs.get_json()) and mine.status_code == 404


def test_path_is_required_and_check_is_validated(client, data):
    assert client.get(URL).status_code == 400
    assert details(client, data / "v2.zarr", check="2").status_code == 400


def test_never_reads_a_chunk(client, data, monkeypatch):
    def refuse(*a, **k):
        raise AssertionError("an array was read")
    monkeypatch.setattr(zarr.Array, "__getitem__", refuse)
    monkeypatch.setattr(zarr.Array, "get_basic_selection", refuse, raising=False)
    assert details(client, data / "v2.zarr").status_code == 200


def test_column_names_are_capped(client, data, monkeypatch):
    from annzarro.core import store_details
    monkeypatch.setattr(store_details, "MAX_NAMES", 2)
    body = details(client, data / "v2.zarr").get_json()
    assert len(body["obs_columns"]) == 2 and body["obs_columns_total"] == 3


# --- store check, budget ----------------------------------------------------------------------

def test_local_store_check_runs_by_default_and_check_0_skips_it(client, data):
    ran = details(client, data / "v2.zarr").get_json()["store_check"]
    assert ran["ran"] is True and ran["complete"] is True and ran["budget_reached"] is False
    assert ran["worst"] in ("ok", "info", "warning", "slow") and isinstance(ran["findings"], list)
    assert ran["docs"].endswith("chunking.html")
    skipped = details(client, data / "v2.zarr", check=0).get_json()["store_check"]
    assert skipped["ran"] is False and skipped["reason"] == "not_requested"


def test_a_budget_of_zero_turns_the_check_off(tmp_path, data):
    client = create_app(_config(tmp_path, dataset_details_check_budget_s=0)).test_client()
    check = details(client, data / "v2.zarr", check=1).get_json()["store_check"]
    assert check["ran"] is False and check["reason"] == "disabled"


def test_a_slow_check_answers_at_the_budget_with_what_it_has(tmp_path, data, monkeypatch):
    real = {name: getattr(store_check._Checker, name) for name in ("dense", "sparse")}

    def slow(name):
        def wrapped(self, *a, **k):
            time.sleep(0.3)
            return real[name](self, *a, **k)
        return wrapped
    for name in real:
        monkeypatch.setattr(store_check._Checker, name, slow(name))
    client = create_app(_config(tmp_path, dataset_details_check_budget_s=0.05)).test_client()
    body = details(client, data / "v2.zarr").get_json()
    check = body["store_check"]
    assert check["ran"] is True and check["complete"] is False and check["budget_reached"] is True
    assert check["budget_s"] == 0.05 and isinstance(check["findings"], list)
    assert body["cells"] == 200, "the metadata does not wait for the check"


# --- cache ----------------------------------------------------------------------------------

def test_the_second_request_is_served_from_the_cache_until_the_store_changes(client, data, monkeypatch):
    from annzarro.core import store_details
    described, checked = [], []
    real_describe, real_check = store_details.describe_store, store_check.check_store
    monkeypatch.setattr(store_details, "describe_store", lambda p: (described.append(p), real_describe(p))[1])
    monkeypatch.setattr(store_check, "check_store", lambda p, **k: (checked.append(p), real_check(p, **k))[1])
    store = data / "v2.zarr"
    first = details(client, store).get_json()
    again = details(client, store).get_json()
    assert first == again and len(described) == 1 and len(checked) == 1
    later = time.time() + 5
    os.utime(store / ".zgroup", (later, later))
    details(client, store)
    assert len(described) == 2 and len(checked) == 2, "a rewritten store is read again"


def test_a_check_asked_for_later_is_added_to_the_cached_entry(client, data, monkeypatch):
    checked = []
    real = store_check.check_store
    monkeypatch.setattr(store_check, "check_store", lambda p, **k: (checked.append(p), real(p, **k))[1])
    store = data / "v2.zarr"
    assert details(client, store, check=0).get_json()["store_check"]["ran"] is False
    assert not checked
    assert details(client, store, check=1).get_json()["store_check"]["ran"] is True
    assert details(client, store, check=1).get_json()["store_check"]["ran"] is True
    assert len(checked) == 1


# --- remote stores -----------------------------------------------------------------------------

REMOTE = "s3://lab-bucket/atlas.zarr"


@pytest.fixture
def remote_probe(monkeypatch):
    from annzarro.core import remote
    calls = {"probe": 0, "check": 0}
    monkeypatch.setattr(remote, "check_remote_access", lambda url: None)

    def probe(path):
        calls["probe"] += 1
        return {"name": "atlas.zarr", "remote": True, "error": None, "readable": True, "format": "zarr format 3",
                "zarr_format": 3, "sharded": None, "modified": None, "size_bytes": None, "cells": 95_000_000,
                "genes": 30000}

    def check(path, budget):
        calls["check"] += 1
        return {"ran": True, "reason": None, "complete": True, "budget_reached": False, "budget_s": budget,
                "worst": "slow", "counts": {}, "findings": [], "docs": "x"}
    monkeypatch.setattr(dataset_details, "_remote_meta", probe)
    monkeypatch.setattr(dataset_details, "_run_check", check)
    return calls


def test_a_remote_store_is_probed_and_checked_only_when_asked(client, remote_probe):
    plain = details(client, REMOTE).get_json()
    assert plain["cells"] == 95_000_000 and plain["path"] == REMOTE and plain["remote"] is True
    assert plain["store_check"]["ran"] is False and plain["store_check"]["reason"] == "not_requested"
    assert remote_probe == {"probe": 1, "check": 0}
    asked = details(client, REMOTE, check=1).get_json()
    assert asked["store_check"]["ran"] is True and remote_probe == {"probe": 1, "check": 1}, "probe cached, check run"


def test_remote_stores_follow_the_server_policy(tmp_path):
    client = create_app(_config(tmp_path, remote_stores="deny")).test_client()
    reply = details(client, REMOTE)
    assert reply.status_code == 403 and reply.get_json()["reason"] == "access_denied"


# --- who may ask -----------------------------------------------------------------------------

@pytest.fixture
def shared(tmp_path, data):
    """data/{in.zarr, out.zarr, pub/p1.zarr}: bob is restricted to in.zarr and pub; carol is unrestricted."""
    shutil.copytree(FIXTURE, data / "in.zarr")
    shutil.copytree(FIXTURE, data / "out.zarr")
    (data / "pub").mkdir()
    shutil.copytree(FIXTURE, data / "pub" / "p1.zarr")
    os.symlink(data / "out.zarr", data / "pub" / "escape.zarr")
    manager = AuthManager(user_file=str(tmp_path / "users.json"))
    for name, admin in (("alice", True), ("bob", False), ("carol", False)):
        manager.add_user(name, PASSWORD, is_admin=admin)
    app = create_app(_config(tmp_path, auth_enabled=True))
    access.add_grant(app.config, "bob", "store", str(data / "in.zarr"), actor="alice")
    access.add_grant(app.config, "bob", "dir", str(data / "pub"), actor="alice")
    access.set_restricted(app.config, "bob", True)
    app.data = data
    return app


def login(app, name):
    client = app.test_client()
    assert client.post("/login", data={"username": name, "password": PASSWORD}).status_code == 302
    return client


def test_a_restricted_user_reads_a_granted_store_without_absolute_paths(shared):
    bob = login(shared, "bob")
    body = details(bob, shared.data / "pub" / "p1.zarr").get_json()
    assert body["cells"] == 200 and body["path"] is None and body["link_target"] is None
    assert body["rel_path"] == os.path.join("pub", "p1.zarr")
    assert str(shared.data) not in str(body)
    assert details(bob, shared.data / "in.zarr").get_json()["rel_path"] == "in.zarr"


def test_forbidden_and_missing_answer_alike(shared):
    bob = login(shared, "bob")
    missing = details(bob, shared.data / "nope.zarr")
    assert missing.status_code == 404
    shape = lambda reply, spelled: (reply.status_code, reply.get_data(as_text=True).replace(str(spelled), "PATH"))  # noqa: E731
    for spelled in (shared.data / "out.zarr", shared.data / "hidden.zarr", shared.data / "pub" / "escape.zarr"):
        assert shape(details(bob, spelled), spelled) == shape(missing, shared.data / "nope.zarr"), spelled
    # the same words /data/info uses for a store that is not there
    info = bob.get("/api/v1/data/info", query_string={"dataset_path": str(shared.data / "out.zarr")})
    assert (info.status_code, info.get_json()["reason"], info.get_json()["exception"]) == \
        (404, missing.get_json()["reason"], missing.get_json()["exception"])


def test_a_relative_path_is_echoed_as_the_client_wrote_it(shared):
    bob = login(shared, "bob")
    body = details(bob, "out.zarr").get_json()
    assert "out.zarr" in body["error"] and str(shared.data) not in body["error"]


def test_unrestricted_and_admin_users_see_absolute_paths(shared):
    for who in ("carol", "alice"):
        body = details(login(shared, who), shared.data / "out.zarr").get_json()
        assert body["path"] == str(shared.data / "out.zarr"), who
    link = details(login(shared, "carol"), shared.data / "pub" / "escape.zarr").get_json()
    assert link["link_target"] == os.path.realpath(shared.data / "out.zarr")


def test_login_comes_first(shared):
    reply = shared.test_client().get(URL, query_string={"path": str(shared.data / "in.zarr")})
    assert reply.status_code in (302, 401)


def test_a_hosted_server_refuses_a_path_outside_its_roots(tmp_path, data):
    outside = tmp_path / "outside"
    shutil.copytree(FIXTURE, outside / "secret.zarr")
    app = create_app(_config(tmp_path, host="0.0.0.0"))
    reply = details(app.test_client(), outside / "secret.zarr")
    assert reply.status_code == 403 and reply.get_json()["reason"] == "outside_data_dir"
    assert details(app.test_client(), "../outside/secret.zarr").status_code == 403


def test_an_admin_data_root_is_readable_like_the_data_directory(tmp_path, data):
    from annzarro.tests.server.admin_helpers import ADMIN, USER, login as admin_login, make_app, unsafe_headers
    import json
    parent = tmp_path / "atlases"
    shutil.copytree(FIXTURE, parent / "lab2" / "cells.zarr")
    app = make_app(tmp_path, admin_data_roots=[str(parent)])
    admin, alice = admin_login(app, ADMIN), admin_login(app, USER)
    store = parent / "lab2" / "cells.zarr"
    assert details(alice, store).status_code == 403, "outside every root until an admin adds it"
    added = admin.post("/api/v1/admin/data-roots", data=json.dumps({"path": str(parent / "lab2")}),
                       headers=unsafe_headers(admin))
    assert added.status_code == 201
    assert details(alice, store).get_json()["cells"] == 200
