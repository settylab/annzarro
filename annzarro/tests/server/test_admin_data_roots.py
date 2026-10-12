"""Data directories: who may change them, what is refused, and that a change
reaches every reader (the confinement check, the folder picker, other workers)."""
import http.cookiejar
import json
import os
import re
import shutil
import urllib.error
import urllib.request

import pytest

from annzarro.server.admin import audit, overlay
from annzarro.server.auth import AuthManager
from annzarro.tests.server.admin_helpers import ADMIN, PASSWORD, USER, login, make_app, unsafe_headers
from annzarro.tests.server.test_admin_overlay import _get, servers  # noqa: F401  (the gunicorn fixture)

FIXTURE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fixture_small.zarr")
URL = "/api/v1/admin/data-roots"


@pytest.fixture
def layout(tmp_path):
    parent = tmp_path / "atlases"
    (parent / "lab2").mkdir(parents=True)
    shutil.copytree(FIXTURE, parent / "lab2" / "cells.zarr")
    (parent / "lab3" / "deep").mkdir(parents=True)
    secret = tmp_path / "secret"
    secret.mkdir()
    shutil.copytree(FIXTURE, secret / "hidden.zarr")
    (parent / "escape").symlink_to(secret)
    (parent / "afile").write_text("x")
    return tmp_path


def _app(layout, **config):
    config.setdefault("admin_data_roots", [str(layout / "atlases")])
    config.setdefault("refresh_min_interval_s", 0)
    return make_app(layout, **config)


def _send(client, method, body, url=URL):
    return client.open(url, method=method, data=json.dumps(body), headers=unsafe_headers(client))


def _add(client, path):
    return _send(client, "POST", {"path": str(path)})


def _remove(client, path):
    return _send(client, "DELETE", {"path": str(path)})


def _info(client, path):
    return client.get("/api/v1/data/info", query_string={"dataset_path": str(path)})


# --- who -------------------------------------------------------------------

def test_only_an_admin_reads_or_changes_the_roots(layout):
    app = _app(layout)
    anon, alice = app.test_client(), login(app, USER)
    path = layout / "atlases" / "lab2"
    for client, status in ((anon, 401), (alice, 403)):
        assert client.get(URL).status_code == status
        assert client.get(URL + "/browse").status_code == status
        assert client.get(URL + "/datasets").status_code == status
        if client is alice:
            assert _add(client, path).status_code == 403
            assert _remove(client, path).status_code == 403
        else:
            assert anon.post(URL, json={"path": str(path)}).status_code == 401
    assert not os.path.exists(overlay.path(app.config)), "a refused request wrote the overlay"


def test_listing_names_parents_and_every_source(layout):
    app = _app(layout, allowed_dirs=[str(layout / "secret")])
    admin = login(app, ADMIN)
    assert _add(admin, layout / "atlases" / "lab2").status_code == 201
    body = admin.get(URL).get_json()
    assert body["parents"] == [{"path": str(layout / "atlases"), "ok": True}]
    by = {r["source"]: r for r in body["roots"]}
    assert set(by) == {"data_dir", "config", "admin"}
    assert by["admin"]["path"] == str(layout / "atlases" / "lab2") and by["admin"]["active"]
    assert by["admin"]["added_by"] == ADMIN and by["admin"]["stores"] == 1 and by["admin"]["stores_capped"] is False
    assert by["config"]["stores"] == 1


# --- add -------------------------------------------------------------------

def test_add_returns_the_root_stores_it_and_audits_it(layout):
    app = _app(layout)
    admin = login(app, ADMIN)
    response = _add(admin, layout / "atlases" / "lab2")
    assert response.status_code == 201
    assert response.get_json()["real"] == os.path.realpath(layout / "atlases" / "lab2")
    stored = json.load(open(overlay.path(app.config)))["data_roots"]
    assert [r["path"] for r in stored] == [str(layout / "atlases" / "lab2")] and stored[0]["added_by"] == ADMIN
    record = audit.read(app.admin_dir, limit=1)[0]
    assert (record["action"], record["target"], record["actor"], record["outcome"]) == \
        ("data_roots.add", str(layout / "atlases" / "lab2"), ADMIN, "ok")


def _refusals(layout):
    parent = layout / "atlases"
    return [
        ("outside every parent", layout / "secret", 403, "outside_admin_parents"),
        ("dotdot out of the parent", f"{parent}/lab2/../../secret", 403, "outside_admin_parents"),
        ("symlink inside the parent leading out", parent / "escape", 403, "outside_admin_parents"),
        ("a path below such a symlink", parent / "escape" / "hidden.zarr", 403, "outside_admin_parents"),
        ("a prefix sibling of the parent", str(parent) + "-evil", 403, "outside_admin_parents"),
        ("the filesystem root", "/", 403, "outside_admin_parents"),
        ("relative", "atlases/lab2", 400, "not_absolute"),
        ("home shorthand", "~/atlases", 400, "not_absolute"),
        ("a file", parent / "afile", 400, "not_a_directory"),
        ("a missing directory", parent / "gone", 400, "not_a_directory"),
        ("the data directory", layout / "data", 403, "outside_admin_parents"),
    ]


def test_add_refuses_what_is_outside_the_parents_or_not_a_directory(layout):
    app = _app(layout)
    admin = login(app, ADMIN)
    for label, path, status, reason in _refusals(layout):
        response = _add(admin, path)
        assert (response.status_code, response.get_json()["reason"]) == (status, reason), label
    assert not os.path.exists(overlay.path(app.config)) or overlay.data_roots(app.config) == []
    actions = {r["outcome"] for r in audit.read(app.admin_dir, limit=100)}
    assert {"refused:outside_admin_parents", "refused:not_absolute", "refused:not_a_directory"} <= actions


def test_add_refuses_bad_bodies(layout):
    admin = login(_app(layout), ADMIN)
    for body in ({}, {"path": ""}, {"path": 5}, {"path": ["/a"]}, {"path": "/a\0b"}, {"path": "/" + "a" * 5000}, []):
        assert _send(admin, "POST", body).status_code == 400, body


def test_add_is_off_without_parents(layout):
    app = _app(layout, admin_data_roots=[])
    admin = login(app, ADMIN)
    response = _add(admin, layout / "atlases" / "lab2")
    assert (response.status_code, response.get_json()["reason"]) == (403, "admin_roots_disabled")
    assert admin.get(URL + "/browse").status_code == 403


def test_add_refuses_what_is_already_readable(layout):
    parent = layout / "atlases"
    app = _app(layout, admin_data_roots=[str(parent), str(layout)], allowed_dirs=[str(parent / "lab3")])
    admin = login(app, ADMIN)
    assert (_add(admin, layout / "data").get_json()["reason"]) == "already_allowed"          # data_dir itself
    assert (_add(admin, layout / "data").status_code) == 409
    assert _add(admin, parent / "lab3").status_code == 409                                   # allowed_dirs
    assert _add(admin, parent / "lab3" / "deep").status_code == 409                          # below it
    assert _add(admin, parent / "lab2").status_code == 201
    assert _add(admin, parent / "lab2").status_code == 409                                   # twice
    (parent / "lab2" / "sub").mkdir()
    assert _add(admin, parent / "lab2" / "sub").status_code == 409                           # below an admin root
    assert len(overlay.data_roots(app.config)) == 1


def test_a_link_to_an_allowed_directory_is_added_as_typed_and_resolved(layout):
    parent = layout / "atlases"
    (parent / "latest").symlink_to(parent / "lab2")
    app = _app(layout)
    admin = login(app, ADMIN)
    response = _add(admin, parent / "latest")
    assert response.status_code == 201
    assert response.get_json()["path"] == str(parent / "latest")
    assert response.get_json()["real"] == os.path.realpath(parent / "lab2")


def test_the_root_count_is_capped(layout, monkeypatch):
    from annzarro.server.admin import data_roots
    monkeypatch.setattr(data_roots, "MAX_ADMIN_ROOTS", 2)
    parent = layout / "atlases"
    for n in range(3):
        (parent / f"d{n}").mkdir()
    admin = login(_app(layout), ADMIN)
    assert [_add(admin, parent / f"d{n}").status_code for n in range(3)] == [201, 201, 409]


# --- remove ----------------------------------------------------------------

def test_remove_answers_unknown_and_config_roots(layout):
    app = _app(layout)
    admin = login(app, ADMIN)
    assert _remove(admin, layout / "atlases" / "lab2").get_json()["reason"] == "unknown_root"
    assert _remove(admin, layout / "atlases" / "lab2").status_code == 404
    response = _remove(admin, layout / "data")
    assert (response.status_code, response.get_json()["reason"]) == (409, "from_config")
    assert _remove(admin, "").status_code == 400


def test_remove_counts_the_panel_sets_that_named_the_root(layout):
    app = _app(layout)
    admin = login(app, ADMIN)
    root = layout / "atlases" / "lab2"
    assert _add(admin, root).status_code == 201
    sessions = layout / "data" / "sessions"
    sessions.mkdir()
    for name, dataset in (("a", root / "cells.zarr"), ("b", root / "cells.zarr"), ("c", layout / "data" / "x.zarr"),
                          ("d", "cells.zarr"), ("e", None)):
        (sessions / f"{name}.json").write_text(json.dumps({"name": name, "dataset": str(dataset) if dataset else None}))
    response = _remove(admin, root)
    assert response.status_code == 200
    assert response.get_json() == {"removed": str(root), "panel_sets_affected": 2}
    assert overlay.data_roots(app.config) == []
    record = audit.read(app.admin_dir, limit=1)[0]
    assert (record["action"], record["detail"]["panel_sets_affected"]) == ("data_roots.remove", 2)


def test_a_root_gone_from_disk_can_still_be_removed(layout):
    app = _app(layout)
    admin = login(app, ADMIN)
    gone = layout / "atlases" / "temp"
    gone.mkdir()
    assert _add(admin, gone).status_code == 201
    gone.rmdir()
    entry = [r for r in admin.get(URL).get_json()["roots"] if r["source"] == "admin"][0]
    assert entry["active"] is False and entry["inactive_reason"] == "missing"
    assert _remove(admin, gone).status_code == 200


# --- what the change does to reads -----------------------------------------

def test_add_and_remove_change_what_a_user_may_read(layout):
    app = _app(layout)
    admin, alice = login(app, ADMIN), login(app, USER)
    store = layout / "atlases" / "lab2" / "cells.zarr"
    assert _info(alice, store).status_code == 403
    assert _add(admin, layout / "atlases" / "lab2").status_code == 201
    assert _info(alice, store).status_code == 200, "the next request already sees the root"
    assert _remove(admin, layout / "atlases" / "lab2").status_code == 200
    assert _info(alice, store).status_code == 403, "a removed root's datasets are no longer readable"


def test_siblings_and_symlinks_of_an_admin_root_stay_out(layout):
    app = _app(layout)
    admin, alice = login(app, ADMIN), login(app, USER)
    assert _add(admin, layout / "atlases" / "lab2").status_code == 201
    assert _info(alice, layout / "atlases" / "lab3").status_code == 403
    assert _info(alice, layout / "atlases" / "lab2" / ".." / "lab3").status_code == 403
    (layout / "atlases" / "lab2" / "out.zarr").symlink_to(layout / "secret" / "hidden.zarr")
    assert _info(alice, layout / "atlases" / "lab2" / "out.zarr").status_code == 403


def test_a_symlink_swapped_after_the_add_stops_the_reads(layout):
    parent = layout / "atlases"
    (parent / "swap").symlink_to(parent / "lab2")
    app = _app(layout)
    admin, alice = login(app, ADMIN), login(app, USER)
    assert _add(admin, parent / "swap").status_code == 201
    store = parent / "swap" / "cells.zarr"
    assert _info(alice, store).status_code == 200
    (parent / "swap").unlink()
    (parent / "swap").symlink_to(layout / "secret")
    assert _info(alice, parent / "swap" / "hidden.zarr").status_code == 403
    entry = [r for r in admin.get(URL).get_json()["roots"] if r["source"] == "admin"][0]
    assert (entry["active"], entry["inactive_reason"]) == (False, "outside_parents")


def test_a_parent_dropped_from_the_yaml_stops_the_reads(layout):
    app = _app(layout)
    admin, alice = login(app, ADMIN), login(app, USER)
    assert _add(admin, layout / "atlases" / "lab2").status_code == 201
    store = layout / "atlases" / "lab2" / "cells.zarr"
    assert _info(alice, store).status_code == 200
    app.config["admin_data_roots"] = []
    assert _info(alice, store).status_code == 403


# --- browse and datasets ---------------------------------------------------

def test_browse_lists_directories_inside_a_parent_only(layout):
    app = _app(layout)
    admin = login(app, ADMIN)
    assert _add(admin, layout / "atlases" / "lab2").status_code == 201
    top = admin.get(URL + "/browse").get_json()
    assert top["dirs"] == [{"name": str(layout / "atlases"), "path": str(layout / "atlases"), "is_root": False}]
    body = admin.get(URL + "/browse", query_string={"path": str(layout / "atlases")}).get_json()
    by = {d["name"]: d for d in body["dirs"]}
    assert set(by) == {"lab2", "lab3"}, "a link out, a file and hidden entries are not offered"
    assert by["lab2"]["is_root"] is True and by["lab3"]["is_root"] is False
    assert body["capped"] is False
    inner = admin.get(URL + "/browse", query_string={"path": by["lab3"]["path"]}).get_json()
    assert [d["name"] for d in inner["dirs"]] == ["deep"]


@pytest.mark.parametrize("path, status, reason", [
    ("{secret}", 403, "outside_admin_parents"),
    ("{atlases}/../secret", 403, "outside_admin_parents"),
    ("{atlases}/escape", 403, "outside_admin_parents"),
    ("/", 403, "outside_admin_parents"),
    ("atlases", 400, "not_absolute"),
    ("{atlases}/afile", 404, "not_found"),
    ("{atlases}/gone", 404, "not_found"),
])
def test_browse_refuses_outside_the_parents(layout, path, status, reason):
    admin = login(_app(layout), ADMIN)
    path = path.format(secret=layout / "secret", atlases=layout / "atlases")
    response = admin.get(URL + "/browse", query_string={"path": path})
    assert (response.status_code, response.get_json()["reason"]) == (status, reason)


def test_browse_is_capped(layout):
    parent = layout / "atlases"
    for n in range(6):
        (parent / f"many{n}").mkdir()
    admin = login(_app(layout, dataset_folder_max_entries=3), ADMIN)
    body = admin.get(URL + "/browse", query_string={"path": str(parent)}).get_json()
    assert len(body["dirs"]) == 3 and body["capped"] is True


def test_datasets_lists_a_root_and_nothing_else(layout):
    app = _app(layout)
    admin = login(app, ADMIN)
    root = layout / "atlases" / "lab2"
    query = {"root": str(root)}
    assert admin.get(URL + "/datasets", query_string=query).status_code == 403, "not added yet"
    assert _add(admin, root).status_code == 201
    body = admin.get(URL + "/datasets", query_string=query).get_json()
    assert [(e["kind"], e["name"], e["cells"]) for e in body["entries"]] == [("store", "cells.zarr", 200)]
    (root / "sub").mkdir()
    sub = admin.get(URL + "/datasets", query_string={**query, "folder": "sub"})
    assert sub.status_code == 200 and sub.get_json()["entries"] == []
    for bad in ("../lab3", str(layout / "secret"), "../../secret"):
        response = admin.get(URL + "/datasets", query_string={**query, "folder": bad})
        assert (response.status_code, response.get_json()["reason"]) == (403, "not_a_root"), bad
    assert admin.get(URL + "/datasets", query_string={**query, "folder": "gone"}).status_code == 404
    assert admin.get(URL + "/datasets", query_string={"root": str(layout / "secret")}).status_code == 403
    assert admin.get(URL + "/datasets", query_string={**query, "offset": "x"}).status_code == 400


# --- the picker ------------------------------------------------------------

def test_the_picker_shows_an_added_root_as_a_top_level_folder(layout):
    app = _app(layout)
    admin, alice = login(app, ADMIN), login(app, USER)
    root = layout / "atlases" / "lab2"
    folders = lambda: {e["name"]: e for e in alice.get("/api/v1/datasets/folder").get_json()["entries"]}
    assert "lab2" not in folders()
    assert _add(admin, root).status_code == 201
    entry = folders()["lab2"]
    assert (entry["kind"], entry["path"]) == ("folder", str(root))
    inside = alice.get("/api/v1/datasets/folder", query_string={"folder": entry["path"]}).get_json()
    assert [e["name"] for e in inside["entries"]] == ["cells.zarr"] and inside["parent"] is None
    assert _remove(admin, root).status_code == 200
    assert "lab2" not in folders()
    assert alice.get("/api/v1/datasets/folder", query_string={"folder": str(root)}).status_code == 403


def test_search_finds_a_store_in_an_admin_root_under_the_same_caps(layout):
    app = _app(layout)
    admin, alice = login(app, ADMIN), login(app, USER)
    search = lambda q="cells": alice.get("/api/v1/datasets/search", query_string={"q": q}).get_json()
    assert search()["results"] == []
    assert _add(admin, layout / "atlases" / "lab2").status_code == 201
    found = search()["results"]
    assert [e["path"] for e in found] == [str(layout / "atlases" / "lab2" / "cells.zarr")]
    assert found[0]["cells"] == 200
    assert search("hidden")["results"] == [], "nothing outside the roots"
    (layout / "atlases" / "lab2" / "a" / "b").mkdir(parents=True)
    shutil.copytree(FIXTURE, layout / "atlases" / "lab2" / "a" / "b" / "deepcells.zarr")
    app.config["dataset_search_max_depth"] = 2          # root = depth 1, a = depth 2: b is cut
    result = search("deepcells")
    assert result["results"] == [] and result["truncated"] is True
    app.config["dataset_search_max_depth"] = 6
    assert len(search("deepcells")["results"]) == 1
    assert _remove(admin, layout / "atlases" / "lab2").status_code == 200
    assert search()["results"] == []


def test_an_inactive_root_is_not_offered(layout):
    parent = layout / "atlases"
    app = _app(layout)
    admin, alice = login(app, ADMIN), login(app, USER)
    (parent / "temp").mkdir()
    assert _add(admin, parent / "temp").status_code == 201
    (parent / "temp").rmdir()
    assert "temp" not in {e["name"] for e in alice.get("/api/v1/datasets/folder").get_json()["entries"]}


# --- across workers --------------------------------------------------------

class _Session:
    """A cookie-keeping HTTP client for the gunicorn tests."""

    def __init__(self, base, username):
        self.base = base
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        # the sign-in form carries a one-time token that must come back with the password (csrf.py)
        form = self.opener.open(base + "/login", timeout=20).read().decode()
        login_csrf = re.search(r'name="login_csrf" value="([^"]+)"', form).group(1)
        data = f"username={username}&password={PASSWORD.replace(' ', '+')}&login_csrf={login_csrf}".encode()
        self.opener.open(urllib.request.Request(base + "/login", data=data), timeout=20).read()
        self.csrf = None

    def get(self, path):
        try:
            with self.opener.open(self.base + path, timeout=20) as r:
                return r.status, json.loads(r.read() or b"null")
        except urllib.error.HTTPError as exc:
            return exc.code, None

    def token(self):
        if self.csrf is None:
            with self.opener.open(self.base + "/admin", timeout=20) as r:
                self.csrf = re.search(r'name="annzarro-csrf" content="([^"]+)"', r.read().decode()).group(1)
        return self.csrf

    def send(self, method, path, body):
        request = urllib.request.Request(self.base + path, data=json.dumps(body).encode(), method=method,
                                         headers={"Content-Type": "application/json", "X-AnnZarro-CSRF": self.token()})
        try:
            with self.opener.open(request, timeout=20) as r:
                return r.status
        except urllib.error.HTTPError as exc:
            return exc.code


def test_add_and_remove_reach_every_worker_within_one_request(servers):  # noqa: F811
    start, config, parent = servers
    manager = AuthManager(user_file=config["user_file"])
    manager.create_user(ADMIN, PASSWORD, is_admin=True)
    manager.create_user(USER, PASSWORD)
    root = parent / "lab2"
    shutil.copytree(FIXTURE, root / "cells.zarr")
    os.makedirs(os.path.join(os.path.dirname(os.path.dirname(config["user_file"])), "data"), exist_ok=True)
    url = start(3)
    admin, alice = _Session(url, ADMIN), _Session(url, USER)
    read = f"/api/v1/data/info?dataset_path={root / 'cells.zarr'}"
    folder = "/api/v1/datasets/folder"
    for _ in range(3):
        assert alice.get(read)[0] == 403
        assert admin.send("POST", "/api/v1/admin/data-roots", {"path": str(root)}) == 201
        answers = [alice.get(read)[0] for _ in range(60)]
        assert answers == [200] * 60, "a worker still refused the new root"
        assert all("lab2" in {e["name"] for e in alice.get(folder)[1]["entries"]} for _ in range(20))
        assert admin.send("DELETE", "/api/v1/admin/data-roots", {"path": str(root)}) == 200
        answers = [alice.get(read)[0] for _ in range(60)]
        assert answers == [403] * 60, "a worker still read the removed root"


# --- review follow-ups: counting, a corrupt overlay, server state ----------

def _stores(admin):
    return {r["path"]: r for r in admin.get(URL).get_json()["roots"] if r["source"] == "admin"}


def test_counting_does_not_follow_a_link_out_of_the_root(layout):
    parent = layout / "atlases"
    shutil.copytree(FIXTURE, parent / "lab2" / "inner.zarr")
    (parent / "lab2" / "out").symlink_to(layout / "secret")                    # holds hidden.zarr
    admin = login(_app(layout), ADMIN)
    assert _add(admin, parent / "lab2").status_code == 201
    assert _stores(admin)[str(parent / "lab2")]["stores"] == 2, "cells.zarr and inner.zarr, not the linked hidden.zarr"


def test_one_entry_budget_covers_all_roots_of_a_listing(layout):
    parent = layout / "atlases"
    for name in ("r1", "r2"):
        for n in range(5):
            (parent / name / f"d{n}").mkdir(parents=True)
    app = _app(layout, dataset_scan_max_entries=5)
    admin = login(app, ADMIN)
    assert _add(admin, parent / "r1").status_code == 201
    assert _add(admin, parent / "r2").status_code == 201
    from annzarro.server.admin import data_roots
    data_roots._counts.clear()                          # the adds counted each root on its own
    by = _stores(admin)
    assert by[str(parent / "r1")]["stores_capped"] is False
    assert "stores" not in by[str(parent / "r2")] and by[str(parent / "r2")]["stores_capped"] is True


def test_a_roots_count_is_reused_until_its_directory_changes(layout, monkeypatch):
    from annzarro.server.admin import data_roots
    from annzarro.data import scan
    data_roots._counts.clear()
    calls = []
    real = scan.count_stores_within
    monkeypatch.setattr(scan, "count_stores_within", lambda *a, **k: calls.append(a[0]) or real(*a, **k))
    app = _app(layout)
    admin = login(app, ADMIN)
    root = layout / "atlases" / "lab2"
    assert _add(admin, root).status_code == 201
    walks = lambda: calls.count(os.path.realpath(root))
    assert walks() == 1
    for _ in range(3):
        assert _stores(admin)[str(root)]["stores"] == 1
    assert walks() == 1, "listing again did not walk the root again"
    shutil.copytree(FIXTURE, root / "second.zarr")
    assert _stores(admin)[str(root)]["stores"] == 2
    assert walks() == 2


def test_an_unreadable_overlay_is_reported_and_logged_once_per_request(layout, monkeypatch):
    import logging
    app = _app(layout)
    admin, alice = login(app, ADMIN), login(app, USER)
    assert _add(admin, layout / "atlases" / "lab2").status_code == 201
    assert admin.get(URL).get_json()["overlay"] == {"ok": True, "error": None}
    with open(overlay.path(app.config), "w") as f:
        f.write("{corrupt")
    body = admin.get(URL).get_json()
    assert body["overlay"]["ok"] is False and body["overlay"]["error"]
    assert [r for r in body["roots"] if r["source"] == "admin"] == []
    # an unexpected failure inside the merge: configured roots only, one log line per request
    for n in range(6):
        (layout / "data" / f"folder{n}").mkdir()
    monkeypatch.setattr(overlay, "active_data_roots", lambda config: 1 / 0)
    records = []
    handler = logging.Handler(level=logging.ERROR)
    handler.emit = records.append
    log = logging.getLogger("annzarro.server.confinement")
    log.addHandler(handler)
    try:
        assert alice.get("/api/v1/datasets/folder").status_code == 200
    finally:
        log.removeHandler(handler)
    assert len([r for r in records if "admin-added data directories" in r.getMessage()]) == 1


def test_a_parent_or_a_directory_with_server_state_is_not_added(layout):
    parent = layout / "atlases"
    # the users file's directory (which holds annzarro_admin/) lies below this parent
    app = _app(layout, admin_data_roots=[str(parent), str(layout)])
    admin = login(app, ADMIN)
    for path, reason in ((parent, "is_a_parent"), (layout, "is_a_parent"),
                         (layout / "users", "contains_server_state")):
        response = _add(admin, path)
        assert (response.status_code, response.get_json()["reason"]) == (403, reason), path
    (layout / "elsewhere").mkdir()
    # a directory that contains the data directory's sessions folder
    sessions = layout / "data" / "sessions"
    sessions.mkdir()
    assert _add(admin, layout / "data").get_json()["reason"] == "already_allowed"
    assert overlay.data_roots(app.config) == []


def test_admin_root_entries_carry_no_server_relative_path(layout):
    app = _app(layout)
    admin, alice = login(app, ADMIN), login(app, USER)
    assert _add(admin, layout / "atlases" / "lab2").status_code == 201
    entry = [e for e in alice.get("/api/v1/datasets/folder").get_json()["entries"] if e["name"] == "lab2"][0]
    assert "rel_path" not in entry and entry["admin_root"] is True
