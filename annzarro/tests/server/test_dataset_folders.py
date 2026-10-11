"""
/api/v1/datasets/folder lists one folder of the data directory (the dataset
picker's lazy tree): confined like every path, capped per request, and
cheap (a store's format and mtime come from its root metadata file).
"""
import os
import shutil

import pytest

from annzarro.server.core import create_app
from annzarro.server.routes import data_routes

FIXTURE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fixture_small.zarr")


def _app(tmp_path, **extra):
    config = {"TESTING": True, "host": "127.0.0.1", "data_dir": str(tmp_path / "data"),
              "log_file": str(tmp_path / "test.log"), "user_file": str(tmp_path / "users.json"),
              "secret_key": "test-only-secret"}
    config.update(extra)
    return create_app(config)


@pytest.fixture
def layout(tmp_path):
    data = tmp_path / "data"
    (data / "projects" / "liver").mkdir(parents=True)
    shutil.copytree(FIXTURE, data / "top.zarr")
    shutil.copytree(FIXTURE, data / "projects" / "liver" / "deep.zarr")
    (data / "projects" / "liver" / "broken.zarr").mkdir()
    (data / ".hidden").mkdir()
    outside = tmp_path / "outside"
    (outside / "secret.zarr").mkdir(parents=True)
    os.symlink(outside, data / "linkdir")
    os.symlink(outside / "secret.zarr", data / "link.zarr")
    data_routes._LISTING_PROBE_CACHE.clear()
    yield tmp_path
    data_routes._LISTING_PROBE_CACHE.clear()


def _get(client, **args):
    return client.get("/api/v1/datasets/folder", query_string=args)


def test_root_lists_folders_before_stores(layout):
    body = _get(_app(layout).test_client()).get_json()
    names = [(e["kind"], e["name"]) for e in body["entries"]]
    assert names[:2] == [("folder", "linkdir"), ("folder", "projects")]
    assert ("store", "top.zarr") in names and not any(n == ".hidden" for _, n in names)
    top = next(e for e in body["entries"] if e["name"] == "top.zarr")
    assert top["cells"] == 200 and top["genes"] == 20
    assert top["format"].startswith("zarr format ") and top["modified"] > 0
    assert body["parent"] is None and not body["more"]


def test_subfolder_by_relative_path_with_unreadable_store_row(layout):
    body = _get(_app(layout).test_client(), folder="projects/liver").get_json()
    by = {e["name"]: e for e in body["entries"]}
    assert by["deep.zarr"]["cells"] == 200
    assert by["broken.zarr"]["error"] and by["broken.zarr"]["cells"] is None   # a row, not dropped
    assert body["rel_path"] == os.path.join("projects", "liver")


def test_missing_folder_is_404(layout):
    assert _get(_app(layout).test_client(), folder="nope").status_code == 404


def test_cap_pages_and_only_the_page_is_probed(layout):
    data = layout / "data" / "many"
    data.mkdir()
    for i in range(7):
        shutil.copytree(FIXTURE, data / f"s{i}.zarr")
    client = _app(layout, dataset_folder_max_entries=3).test_client()
    calls = []
    real = data_routes.zarr_reader.get_basic_counts
    data_routes.zarr_reader.get_basic_counts = lambda p: (calls.append(p), real(p))[1]
    try:
        first = _get(client, folder="many", limit=1000).get_json()    # a larger limit is capped
        assert [e["name"] for e in first["entries"]] == ["s0.zarr", "s1.zarr", "s2.zarr"]
        assert first["more"] and first["total"] == 7 and first["limit"] == 3
        assert len(calls) == 3, "stores outside the page were opened"
        last = _get(client, folder="many", offset=6).get_json()
        assert [e["name"] for e in last["entries"]] == ["s6.zarr"] and not last["more"]
    finally:
        data_routes.zarr_reader.get_basic_counts = real


def test_store_meta_reads_only_root_metadata(layout, monkeypatch):
    from annzarro.server.routes import dataset_folders
    walked = []
    monkeypatch.setattr(os, "walk", lambda *a, **k: walked.append(a) or iter(()))
    meta = dataset_folders.store_meta(str(layout / "data" / "top.zarr"))
    assert meta["format"] and not walked


def test_hosted_refuses_outside_dotdot_and_symlink_escape(layout):
    client = _app(layout, host="0.0.0.0").test_client()
    for folder in (str(layout / "outside"), "../outside", "projects/../../outside", "linkdir"):
        resp = _get(client, folder=folder)
        assert resp.status_code == 403 and resp.get_json()["reason"] == "outside_data_dir", folder
    root = _get(client).get_json()["entries"]
    assert "linkdir" not in [e["name"] for e in root] and "link.zarr" not in [e["name"] for e in root], "escaping links not offered"


def test_hosted_non_admin_with_login_cannot_leave_the_data_dir(layout):
    from annzarro.server.auth import AuthManager
    manager = AuthManager(user_file=str(layout / "users.json"))
    manager.create_user("alice", "pw")
    manager.create_user("root", "pw", is_admin=True)
    app = _app(layout, host="0.0.0.0", auth_enabled=True)
    anonymous = app.test_client()
    assert _get(anonymous, folder="projects").status_code in (302, 401), "login first"
    alice = app.test_client()
    alice.post("/login", data={"username": "alice", "password": "pw"})
    assert _get(alice, folder="projects").status_code == 200
    resp = _get(alice, folder=str(layout / "outside"))
    assert resp.status_code == 403 and resp.get_json()["reason"] == "outside_data_dir"
    assert "outside" not in resp.get_json()["error"].replace("outside the data directory", "")
    root = app.test_client()
    root.post("/login", data={"username": "root", "password": "pw"})
    assert _get(root, folder=str(layout / "outside")).status_code == 200, "admins may, as everywhere"


# --- search over the tree -----------------------------------------------------------

def _search(client, q, **args):
    return client.get("/api/v1/datasets/search", query_string={"q": q, **args})


def test_search_finds_stores_in_unexpanded_subfolders_by_name_and_path(layout):
    client = _app(layout).test_client()
    body = _search(client, "deep").get_json()
    assert [e["rel_path"] for e in body["results"]] == [os.path.join("projects", "liver", "deep.zarr")]
    assert body["results"][0]["cells"] == 200 and not body["truncated"]
    assert [e["name"] for e in _search(client, "projects/liver").get_json()["results"]] == ["broken.zarr", "deep.zarr"]
    assert _search(client, "DEEP").get_json()["results"], "case-insensitive"
    assert _search(client, "").get_json()["results"] == []


@pytest.fixture
def regex_guard(monkeypatch):
    """A build with the name search's regex guard (here one that lets every pattern through)."""
    from annzarro.core import name_index
    monkeypatch.setattr(name_index, "check_regex", lambda pattern: None, raising=False)


def test_regex_search_is_refused_without_the_regex_guard(layout, monkeypatch):
    from annzarro.core import name_index
    monkeypatch.delattr(name_index, "check_regex", raising=False)
    client = _app(layout).test_client()
    resp = _search(client, "deep", mode="regex")
    assert resp.status_code == 400 and resp.get_json()["reason"] == "regex_unavailable"
    assert _search(client, "deep").status_code == 200, "a plain-text search is not affected"


def test_regex_search_is_accepted_with_the_regex_guard(layout, regex_guard):
    hit = _search(_app(layout).test_client(), "^deep", mode="regex")
    assert hit.status_code == 200 and [e["name"] for e in hit.get_json()["results"]] == ["deep.zarr"]


def test_search_regex_and_refusals(layout, regex_guard):
    client = _app(layout).test_client()
    hit = _search(client, r"^deep\.zarr$|top", mode="regex").get_json()["results"]
    assert {e["name"] for e in hit} == {"deep.zarr", "top.zarr"}
    bad = _search(client, "(", mode="regex")
    assert bad.status_code == 400 and bad.get_json()["reason"] == "invalid_regex"
    long = _search(client, "a" * 201, mode="regex")
    assert long.status_code == 400 and long.get_json()["reason"] == "query_too_long"
    assert _search(client, "(", mode="substring").status_code == 200, "a substring query is literal"


def test_search_uses_the_name_search_regex_guard_when_the_build_has_it(layout, monkeypatch):
    from annzarro.core import name_index

    class Refused(ValueError):
        reason = "regex_too_complex"
    def check(pattern):
        raise Refused("refused")
    monkeypatch.setattr(name_index, "check_regex", check, raising=False)
    resp = _search(_app(layout).test_client(), "(a+)+", mode="regex")
    assert resp.status_code == 400 and resp.get_json()["reason"] == "regex_too_complex"


def test_search_caps_matches_depth_and_entries(layout):
    many = layout / "data" / "many"
    many.mkdir()
    for i in range(6):
        shutil.copytree(FIXTURE, many / f"s{i}.zarr")
    capped = _search(_app(layout, dataset_folder_max_entries=3).test_client(), "s").get_json()
    assert len(capped["results"]) == 3 and capped["truncated"]
    shallow = _search(_app(layout, dataset_search_max_depth=1).test_client(), "deep").get_json()
    assert shallow["results"] == [] and shallow["truncated"], "depth cap: says so"
    few = _search(_app(layout, dataset_search_max_entries=2).test_client(), "deep").get_json()
    assert few["truncated"] and few["visited"] <= 3


def test_search_is_confined_and_never_walks_out_through_links(layout):
    for host in ("127.0.0.1", "0.0.0.0"):
        names = [e["name"] for e in _search(_app(layout, host=host).test_client(), "secret").get_json()["results"]]
        if host == "0.0.0.0":
            assert names == [], "hosted: a link out of the data directory is not searched or offered"
    loop = layout / "data" / "projects" / "again"
    os.symlink(layout / "data" / "projects", loop)
    assert _search(_app(layout).test_client(), "deep").status_code == 200, "a link loop ends"


def test_search_hosted_needs_login(layout):
    from annzarro.server.auth import AuthManager
    AuthManager(user_file=str(layout / "users.json")).create_user("alice", "pw")
    app = _app(layout, host="0.0.0.0", auth_enabled=True)
    assert _search(app.test_client(), "deep").status_code in (302, 401)
    alice = app.test_client()
    alice.post("/login", data={"username": "alice", "password": "pw"})
    assert [e["name"] for e in _search(alice, "deep").get_json()["results"]] == ["deep.zarr"]


# --- what the picker's typed-path field may promise ---------------------------------------

def test_auth_me_reports_whether_remote_stores_work_here(layout, monkeypatch):
    for name in ("ANNZARRO_REMOTE_STORES", "ANNZARRO_REMOTE_ALLOWLIST"):
        monkeypatch.delenv(name, raising=False)

    def me(**config):
        return _app(layout, **config).test_client().get("/api/v1/auth/me").get_json()

    assert me()["remote_stores"] is True, "a local single-user server opens remote stores"
    shared = me(host="0.0.0.0")
    assert shared["remote_stores"] is False and shared["may_open_any_path"] is False
    assert me(host="0.0.0.0", remote_allowlist=["https://example.org/stores/"])["remote_stores"] is True
    assert me(remote_stores="deny")["remote_stores"] is False
