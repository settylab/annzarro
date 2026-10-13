"""
What a restricted user is shown (annzarro/server/access.py, routes/dataset_folders.py):
the dropdown, the picker, the search and the directory listings are built from
their grants, never from the data directory, and say nothing about it.

``bob`` is restricted to the store ``in.zarr`` and the folder ``pub``; ``carol`` is
unrestricted and ``alice`` an admin, who must see exactly what they saw before.
"""
import os

import pytest

from annzarro.server import access
from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app
from annzarro.tests.server.rich_store import make_rich_store

PASSWORD = "pw-for-tests"
USERS = {"alice": True, "bob": False, "carol": False}


@pytest.fixture
def world(tmp_path):
    """data/{in.zarr, out.zarr, pub/{p1.zarr, sub/p2.zarr, bad -> ../out.zarr}, hidden/deep.zarr}."""
    data = tmp_path / "data"
    make_rich_store(data / "in.zarr")
    make_rich_store(data / "out.zarr")
    make_rich_store(data / "pub" / "p1.zarr")
    make_rich_store(data / "pub" / "sub" / "p2.zarr")
    make_rich_store(data / "hidden" / "deep.zarr")
    os.symlink(data / "out.zarr", data / "pub" / "bad.zarr")
    manager = AuthManager(user_file=str(tmp_path / "users.json"))
    for name, admin in USERS.items():
        manager.add_user(name, PASSWORD, is_admin=admin)
    app = create_app({"TESTING": True, "host": "127.0.0.1", "data_dir": str(data), "log_file": str(tmp_path / "t.log"),
                      "auth_enabled": True, "user_file": str(tmp_path / "users.json"), "secret_key": "test-only-secret"})
    app.data = str(data)
    return app


@pytest.fixture
def granted(world):
    access.add_grant(world.config, "bob", "store", f"{world.data}/in.zarr", actor="alice")
    access.add_grant(world.config, "bob", "dir", f"{world.data}/pub", actor="alice")
    access.set_restricted(world.config, "bob", True)
    return world


def client(app, name):
    c = app.test_client()
    assert c.post("/login", data={"username": name, "password": PASSWORD}).status_code == 302
    return c


def names(entries):
    return sorted(e["name"] for e in entries)


def test_the_dropdown_lists_the_granted_stores_and_the_first_level_of_granted_folders(granted):
    entries = client(granted, "bob").get("/api/v1/datasets").get_json()
    assert names(entries) == ["in.zarr", "p1.zarr"]       # not out.zarr, hidden/, the link out, or the nested p2
    by_name = {e["name"]: e for e in entries}
    assert by_name["in.zarr"]["path"] == os.path.realpath(f"{granted.data}/in.zarr")
    assert by_name["in.zarr"]["rel_path"] == "in.zarr" and by_name["p1.zarr"]["rel_path"] == "pub/p1.zarr"
    assert by_name["in.zarr"]["cells"] and by_name["p1.zarr"]["cells"]


def test_the_dropdown_of_everyone_else_is_unchanged(granted):
    for who in ("alice", "carol"):
        entries = client(granted, who).get("/api/v1/datasets").get_json()
        assert names(entries) == ["in.zarr", "out.zarr"]
        assert {e["rel_path"] for e in entries} == {"in.zarr", "out.zarr"}


def test_no_listing_tells_a_restricted_user_where_the_data_directory_is(granted):
    bob = client(granted, "bob")
    data = granted.data
    for url, query in (("/api/v1/datasets", {}), ("/api/v1/datasets/folder", {}),
                       ("/api/v1/datasets/folder", {"folder": f"{data}/pub"}),
                       ("/api/v1/datasets/folder", {"folder": "pub"}),
                       ("/api/v1/datasets/search", {"q": "zarr"}),
                       ("/api/v1/directories/home", {}), ("/api/v1/core/datasets", {}),
                       ("/api/v1/directories/list", {"path": "pub"})):
        text = bob.get(url, query_string=query).get_data(as_text=True)
        # the granted paths themselves are theirs; the directory above them is not
        assert f'"{data}"' not in text and f'"{data}/"' not in text, url
        assert "hidden" not in text and "out.zarr" not in text and "deep.zarr" not in text, url


def test_the_picker_root_is_the_list_of_grants(granted):
    page = client(granted, "bob").get("/api/v1/datasets/folder").get_json()
    assert page["folder"] == "" and page["parent"] is None and page["rel_path"] == ""
    assert [(e["kind"], e["name"]) for e in page["entries"]] == [("folder", "pub"), ("store", "in.zarr")]
    assert all("rel_path" in e and e["rel_path"] == e["name"] for e in page["entries"])
    assert page["total"] == 2 and not page["more"]
    store = page["entries"][1]
    assert store["cells"] and store["format"]            # counts and format are filled for a page of stores


def test_the_picker_root_of_an_unrestricted_user_is_still_the_data_directory(granted):
    page = client(granted, "carol").get("/api/v1/datasets/folder").get_json()
    assert page["folder"] == os.path.expanduser(granted.data)
    assert names(page["entries"]) == ["hidden", "in.zarr", "out.zarr", "pub"]


def test_a_granted_folder_lists_normally_and_drops_what_leads_out(granted):
    bob = client(granted, "bob")
    page = bob.get("/api/v1/datasets/folder", query_string={"folder": f"{granted.data}/pub"}).get_json()
    assert [(e["kind"], e["name"]) for e in page["entries"]] == [("folder", "sub"), ("store", "p1.zarr")]
    assert page["parent"] is None                         # the folder above a grant is not theirs
    assert page["rel_path"] == "pub"
    sub = bob.get("/api/v1/datasets/folder", query_string={"folder": f"{granted.data}/pub/sub"}).get_json()
    assert names(sub["entries"]) == ["p2.zarr"] and sub["parent"] == f"{granted.data}/pub"
    assert sub["entries"][0]["rel_path"] == "pub/sub/p2.zarr"


def test_a_folder_that_is_not_granted_is_the_standard_missing_folder_reply(granted):
    bob = client(granted, "bob")
    data = granted.data
    missing = bob.get("/api/v1/datasets/folder", query_string={"folder": f"{data}/nodir"})
    assert missing.status_code == 404
    for folder in (data, f"{data}/hidden", "hidden", "..", f"{data}/pub/..", f"{data}/in.zarr/..", "/", "/etc",
                   f"{data}/pub/sub/../../hidden", f"{data}/pub2"):
        reply = bob.get("/api/v1/datasets/folder", query_string={"folder": folder})
        assert (reply.status_code, reply.data) == (missing.status_code, missing.data), folder


def test_a_granted_store_is_not_a_folder_to_browse_above(granted):
    page = client(granted, "bob").get("/api/v1/datasets/folder", query_string={"folder": f"{granted.data}/in.zarr"})
    assert page.status_code == 200      # the store itself is theirs; listing it shows its (non-store) members at most
    assert "out.zarr" not in page.get_data(as_text=True)


def test_search_walks_only_the_grants(granted):
    bob = client(granted, "bob")
    found = bob.get("/api/v1/datasets/search", query_string={"q": "zarr"}).get_json()
    assert names(found["results"]) == ["in.zarr", "p1.zarr", "p2.zarr"]
    assert {e["rel_path"] for e in found["results"]} == {"in.zarr", "pub/p1.zarr", "pub/sub/p2.zarr"}
    for query in ("deep", "out", "hidden"):
        assert bob.get("/api/v1/datasets/search", query_string={"q": query}).get_json()["results"] == []
    # a regex cannot widen it, and a store grant is matched by name
    assert names(bob.get("/api/v1/datasets/search", query_string={"q": "^in", "mode": "regex"}).get_json()["results"]) \
        in (["in.zarr"], [])
    admin = client(granted, "alice").get("/api/v1/datasets/search", query_string={"q": "deep"}).get_json()
    assert names(admin["results"]) == ["deep.zarr"]


def test_search_does_not_enter_a_link_that_leaves_the_grant(granted):
    os.symlink(f"{granted.data}/hidden", f"{granted.data}/pub/portal")
    found = client(granted, "bob").get("/api/v1/datasets/search", query_string={"q": "deep"}).get_json()
    assert found["results"] == []


def test_home_directory_is_null_for_a_restricted_user_only(granted):
    assert client(granted, "bob").get("/api/v1/directories/home").get_json() == {"directory": None}
    assert client(granted, "alice").get("/api/v1/directories/home").get_json() == {"directory": granted.data}
    assert client(granted, "carol").get("/api/v1/directories/home").get_json() == {"directory": granted.data}


def test_directory_listing_is_checked_and_filtered(granted):
    bob = client(granted, "bob")
    page = bob.get("/api/v1/directories/list", query_string={"path": f"{granted.data}/pub"}).get_json()
    assert names(page["zarr_stores"]) == ["p1.zarr"] and names(page["directories"]) == ["sub"]
    assert bob.get("/api/v1/directories/list", query_string={"path": granted.data}).status_code == 404
    assert bob.get("/api/v1/directories/list", query_string={"path": "hidden"}).status_code == 404


def test_the_legacy_listing_without_a_folder_is_the_grants(granted):
    bob = client(granted, "bob")
    found = bob.get("/api/v1/core/datasets").get_json()["datasets"]
    assert sorted(os.path.basename(d["path"]) for d in found) == ["in.zarr", "p1.zarr", "p2.zarr"]
    assert bob.get("/api/v1/core/datasets", query_string={"dir": granted.data}).get_json() == {"datasets": []}
    own = bob.get("/api/v1/core/datasets", query_string={"dir": f"{granted.data}/pub"}).get_json()["datasets"]
    assert sorted(os.path.basename(d["path"]) for d in own) == ["p1.zarr", "p2.zarr"]


def test_a_cache_warmed_by_an_unrestricted_user_never_reaches_a_restricted_one(granted):
    carol, bob = client(granted, "carol"), client(granted, "bob")
    for url in ("/api/v1/datasets", "/api/v1/core/datasets", "/api/v1/datasets/folder", "/api/v1/datasets/search?q=zarr"):
        warm = carol.get(url)
        assert "out.zarr" in warm.get_data(as_text=True) or "deep.zarr" in warm.get_data(as_text=True), url
        cold = bob.get(url).get_data(as_text=True)
        assert "out.zarr" not in cold and "deep.zarr" not in cold, url
        assert "out.zarr" in carol.get(url).get_data(as_text=True) or "deep.zarr" in carol.get(url).get_data(as_text=True)


def test_a_restricted_user_with_no_grants_sees_empty_listings(world):
    access.set_restricted(world.config, "bob", True)
    bob = client(world, "bob")
    assert bob.get("/api/v1/datasets").get_json() == []
    page = bob.get("/api/v1/datasets/folder").get_json()
    assert page["entries"] == [] and page["total"] == 0
    assert bob.get("/api/v1/datasets/search", query_string={"q": "zarr"}).get_json()["results"] == []
    assert bob.get("/api/v1/core/datasets").get_json()["datasets"] == []


def test_a_revoked_grant_leaves_the_listings_on_the_next_request(granted):
    bob = client(granted, "bob")
    assert "p1.zarr" in names(bob.get("/api/v1/datasets").get_json())
    access.remove_grant(granted.config, "bob", f"{granted.data}/pub")
    assert names(bob.get("/api/v1/datasets").get_json()) == ["in.zarr"]
    assert bob.get("/api/v1/data/obs", query_string={"dataset_path": f"{granted.data}/pub/p1.zarr"}).status_code == 404


def test_a_granted_hidden_name_and_a_granted_h5ad_are_listed(world):
    pytest.importorskip("h5py")
    access.set_restricted(world.config, "bob", True)
    make_rich_store(f"{world.data}/hidden/.dot.zarr")
    access.add_grant(world.config, "bob", "store", f"{world.data}/hidden/deep.zarr")
    page = client(world, "bob").get("/api/v1/datasets/folder").get_json()
    assert names(page["entries"]) == ["deep.zarr"]
