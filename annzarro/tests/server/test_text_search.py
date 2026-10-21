"""The description search over HTTP: who is told what, the policy switch, polling and the refresh limit.

``bob`` is restricted to the store ``liver.zarr`` and the folder ``sub``; ``carol`` is unrestricted and
``alice`` an admin. ``out.zarr`` (title "Secret kidney", README "kidneysecret") is outside bob's grants,
so nothing of it may reach him: no hit, no snippet, no count, no path.
"""
import json
import os
import shutil
import time

import pytest

from annzarro.server import access, text_index
from annzarro.server.admin import overlay, settings
from annzarro.server.auth import AuthManager
from annzarro.server.core import create_app
from annzarro.server.routes import data_routes
from annzarro.tests.server.test_text_index import FIXTURE, annotate, config_for, make_world, wait_idle

PASSWORD = "pw-for-tests"
USERS = {"alice": True, "bob": False, "carol": False}
SEARCH = "/api/v1/datasets/text-search"
STATUS = "/api/v1/datasets/text-index/status"
REFRESH = "/api/v1/datasets/text-index/refresh"


@pytest.fixture(autouse=True)
def fresh_caches():
    data_routes._LISTING_PROBE_CACHE.clear()
    text_index._loaded.clear()
    yield
    data_routes._LISTING_PROBE_CACHE.clear()
    text_index._loaded.clear()


def make_app(tmp_path, **extra):
    make_world(tmp_path)
    manager = AuthManager(user_file=str(tmp_path / "users.json"))
    for name, admin in USERS.items():
        manager.add_user(name, PASSWORD, is_admin=admin)
    app = create_app(config_for(tmp_path, auth_enabled=True, **extra))
    app.data = str(tmp_path / "data")
    return app


@pytest.fixture
def world(tmp_path):
    return make_app(tmp_path)


@pytest.fixture
def granted(world):
    access.add_grant(world.config, "bob", "store", f"{world.data}/liver.zarr", actor="alice")
    access.add_grant(world.config, "bob", "dir", f"{world.data}/sub", actor="alice")
    access.set_restricted(world.config, "bob", True)
    return world


def client(app, name):
    c = app.test_client()
    assert c.post("/login", data={"username": name, "password": PASSWORD}).status_code == 302
    return c


def search(c, app, q, wait=True, **args):
    """The reply of a search once the index is built (the first search starts the crawl and gets nothing)."""
    reply = c.get(SEARCH, query_string={"q": q, **args})
    if wait and reply.status_code == 200 and reply.get_json()["index"]["state"] == "running":
        wait_idle(app)
        reply = c.get(SEARCH, query_string={"q": q, **args})
    return reply


def names(reply):
    return [r["name"] for r in reply.get_json()["results"]]


# --- the flow ---------------------------------------------------------------------------------------

def test_anonymous_requests_are_refused(world):
    anon = world.test_client()
    assert anon.get(SEARCH, query_string={"q": "liver"}).status_code == 401
    assert anon.get(STATUS).status_code == 401
    assert anon.post(REFRESH).status_code == 401


def test_the_first_search_starts_the_crawl_and_the_next_one_finds_the_store(world):
    carol = client(world, "carol")
    first = carol.get(SEARCH, query_string={"q": "liver"})
    body = first.get_json()
    assert first.status_code == 200 and body["results"] == [] and body["index"]["state"] == "running"
    wait_idle(world)
    body = carol.get(SEARCH, query_string={"q": "liver"}).get_json()
    assert body["index"]["state"] == "done" and body["index"]["stale"] is False and body["index"]["built_at"]
    assert body["partial"] is False
    top = body["results"][0]
    assert top["name"] == "liver.zarr" and top["title"] == "Liver atlas" and top["path"] == os.path.realpath(top["path"])
    assert top["rel_path"] == "liver.zarr" and top["cells"] == 200 and top["genes"] == 20 and top["format"]
    assert top["snippet"]["text"] and top["matched"][0] == "title" and top["score"] > 0


def test_a_readme_word_is_found_with_its_snippet_and_highlight(world):
    carol = client(world, "carol")
    body = search(carol, world, "hepatocytes").get_json()
    hit, = body["results"]
    start, end = hit["snippet"]["highlights"][0]
    assert hit["name"] == "liver.zarr" and hit["snippet"]["field"] == "readme"
    assert hit["snippet"]["text"][start:end] == "hepatocytes"
    # the text is data for textContent: markup in a README stays markup
    annotate(f"{world.data}/plain.zarr", {"title": "Markup"}, "<img src=x onerror=alert(1)> payload")
    carol.post(REFRESH)
    wait_idle(world)
    time.sleep(0.01)
    body = search(carol, world, "payload").get_json()
    assert body["results"][0]["snippet"]["text"].startswith("<img src=x")


def test_status_is_pollable_and_reports_progress_while_a_crawl_runs(world):
    carol = client(world, "carol")
    assert carol.get(STATUS).get_json()["state"] == "idle"
    text_index._write_status(world.config, {"state": "running", "started": time.time(), "heartbeat": time.time(),
                                            "done": 2, "total": 8, "errors": 1})
    body = carol.get(STATUS).get_json()
    assert body["state"] == "running" and body["progress"] == {"fraction": 0.25, "done": 2, "total": 8, "errors": 1}


def test_the_refresh_button_is_open_to_everyone_and_limited_to_one_a_minute(tmp_path):
    app = make_app(tmp_path, text_index_min_interval_s=60)
    bob, carol = client(app, "bob"), client(app, "carol")
    first = carol.post(REFRESH)
    assert first.status_code == 200 and first.get_json()["started"] is True
    wait_idle(app)
    for who in (carol, bob):
        again = who.post(REFRESH).get_json()
        assert again["started"] is False and again["state"] == "done"


def test_an_old_index_is_answered_stale_while_a_refresh_starts(world, monkeypatch):
    carol = client(world, "carol")
    assert names(search(carol, world, "liver")) == ["liver.zarr"]
    real = time.time
    monkeypatch.setattr(text_index, "_now", lambda: real() + 700)
    body = carol.get(SEARCH, query_string={"q": "liver"}).get_json()
    assert body["results"][0]["name"] == "liver.zarr" and body["index"]["stale"] is True
    wait_idle(world)


def test_a_query_that_is_refused_or_empty(world):
    carol = client(world, "carol")
    assert carol.get(SEARCH, query_string={"q": "a.*", "mode": "regex"}).get_json()["reason"] == "regex_not_supported"
    assert carol.get(SEARCH, query_string={"q": "x" * 201}).get_json()["reason"] == "query_too_long"
    assert carol.get(SEARCH, query_string={"q": "a b c d e f g h i"}).get_json()["reason"] == "too_many_terms"
    empty = carol.get(SEARCH, query_string={"q": "  "})
    assert empty.status_code == 200 and empty.get_json()["results"] == []
    assert not text_index.index_dir(world.config).exists(), "an empty query started a crawl"


def test_the_folder_scopes_the_search(world):
    carol = client(world, "carol")
    assert names(search(carol, world, "atlas")) == ["liver.zarr", "heart.zarr"] or \
        sorted(names(search(carol, world, "atlas"))) == ["heart.zarr", "liver.zarr"]
    assert names(search(carol, world, "atlas", folder=f"{world.data}/sub")) == ["heart.zarr"]
    assert names(search(carol, world, "atlas", folder="sub")) == ["heart.zarr"]
    missing = carol.get(SEARCH, query_string={"q": "atlas", "folder": "nodir"})
    assert missing.status_code == 404 and missing.get_json()["reason"] == "not_found"


def test_limit_caps_the_results(world):
    carol = client(world, "carol")
    assert len(search(carol, world, "zarr", limit=2).get_json()["results"]) == 2


# --- the policy switch ----------------------------------------------------------------------------------

def test_off_in_the_config_answers_disabled_by_policy_on_every_route_and_crawls_nothing(tmp_path):
    app = make_app(tmp_path, text_index_enabled=False)
    carol = client(app, "carol")
    for reply in (carol.get(SEARCH, query_string={"q": "liver"}), carol.get(STATUS), carol.post(REFRESH)):
        assert reply.status_code == 403
        assert reply.get_json()["reason"] == "disabled_by_policy" and reply.get_json()["key"] == text_index.KEY
    assert not text_index.index_dir(app.config).exists()


def test_an_admin_can_turn_it_off_for_everyone(world):
    overlay.update(world.config, lambda o: o.setdefault("policy", {}).update({text_index.KEY: False}))
    assert client(world, "carol").get(SEARCH, query_string={"q": "liver"}).status_code == 403
    assert client(world, "alice").get(STATUS).status_code == 403


def test_an_admin_can_turn_it_off_for_one_user(world):
    settings.update_user_policy(world.config, "carol", lambda stored: (None, {**stored, text_index.KEY: False}))
    assert client(world, "carol").get(STATUS).status_code == 403
    assert client(world, "alice").get(STATUS).status_code == 200


def test_the_key_is_declared_for_the_effective_policy_and_the_routes(world):
    body = client(world, "carol").get("/api/v1/policy/effective").get_json()
    assert body["values"][text_index.KEY] is True
    from annzarro.server.policy import check_routes
    assert check_routes(world) == []


# --- who is told what ---------------------------------------------------------------------------------------

def test_a_restricted_user_finds_only_what_they_may_open(granted):
    bob = client(granted, "bob")
    body = search(bob, granted, "atlas").get_json()
    assert sorted(names(search(bob, granted, "atlas"))) == ["heart.zarr", "liver.zarr"]
    for query in ("kidneysecret", "kidney", "secret", "out.zarr"):
        reply = search(bob, granted, query)
        assert reply.get_json()["results"] == [], query
        assert "kidney" not in reply.get_data(as_text=True).lower().replace(query.lower(), "")
    assert body["partial"] is False


def test_a_restricted_user_is_told_the_path_of_what_they_may_open_and_the_name_from_the_grant(granted):
    bob = client(granted, "bob")
    reply = search(bob, granted, "atlas")
    rows = {r["name"]: r for r in reply.get_json()["results"]}
    # the path their listings give for the same store: it is what opens the row
    assert rows["liver.zarr"]["path"] == os.path.realpath(f"{granted.data}/liver.zarr")
    assert rows["heart.zarr"]["path"] == os.path.realpath(f"{granted.data}/sub/heart.zarr")
    assert rows["liver.zarr"]["rel_path"] == "liver.zarr" and rows["heart.zarr"]["rel_path"] == os.path.join("sub", "heart.zarr")
    assert bob.get("/api/v1/datasets/details", query_string={"path": rows["heart.zarr"]["path"]}).status_code == 200
    text = reply.get_data(as_text=True)
    assert "out.zarr" not in text and "plain.zarr" not in text


def test_a_restricted_user_is_told_a_fraction_never_a_count(granted):
    bob, carol = client(granted, "bob"), client(granted, "carol")
    text_index._write_status(granted.config, {"state": "running", "started": time.time(), "heartbeat": time.time(),
                                              "done": 3, "total": 12, "errors": 2})
    mine = bob.get(STATUS).get_json()
    assert mine["progress"] == {"fraction": 0.25} and "stores" not in mine
    assert carol.get(STATUS).get_json()["progress"]["total"] == 12
    # the search reply carries the same index summary
    reply = bob.get(SEARCH, query_string={"q": "atlas"}).get_json()
    assert set(reply["index"]) == {"state", "stale", "built_at", "progress"}
    assert "total" not in json.dumps(reply["index"]) and "errors" not in json.dumps(reply["index"])


def test_an_unrestricted_user_and_an_admin_see_every_store_and_the_counts(granted):
    for who in ("carol", "alice"):
        c = client(granted, who)
        assert "out.zarr" in names(search(c, granted, "kidneysecret"))
    body = client(granted, "carol").get(STATUS).get_json()
    assert body["stores"] == 5 and body["partial"] is False


def test_a_grant_added_or_removed_changes_the_hits_at_once_without_a_new_crawl(granted):
    bob = client(granted, "bob")
    assert names(search(bob, granted, "kidneysecret")) == []
    before = os.stat(text_index.index_dir(granted.config) / "index.json.gz").st_mtime_ns
    access.add_grant(granted.config, "bob", "store", f"{granted.data}/out.zarr", actor="alice")
    assert names(search(bob, granted, "kidneysecret")) == ["out.zarr"]
    access.remove_grant(granted.config, "bob", f"{granted.data}/out.zarr")
    assert names(search(bob, granted, "kidneysecret")) == []
    assert os.stat(text_index.index_dir(granted.config) / "index.json.gz").st_mtime_ns == before


def test_a_restricted_users_folder_must_lie_inside_a_grant(granted):
    bob = client(granted, "bob")
    search(bob, granted, "atlas")
    for folder in (granted.data, f"{granted.data}/nodir", f"{granted.data}/sub/../hidden"):
        reply = bob.get(SEARCH, query_string={"q": "atlas", "folder": folder})
        assert reply.status_code == 404 and reply.get_json()["reason"] == "not_found", folder
    inside = bob.get(SEARCH, query_string={"q": "atlas", "folder": f"{granted.data}/sub"})
    assert inside.status_code == 200 and names(inside) == ["heart.zarr"]


def test_a_link_inside_a_grant_that_leads_to_a_denied_store_is_no_hit(granted):
    os.symlink(f"{granted.data}/out.zarr", f"{granted.data}/sub/shortcut.zarr")
    bob = client(granted, "bob")
    reply = search(bob, granted, "kidneysecret")
    assert reply.get_json()["results"] == []


def test_a_store_in_an_admin_added_root_is_found_by_admins_and_not_by_a_restricted_user(tmp_path):
    parent = tmp_path / "atlases"
    (parent / "lab").mkdir(parents=True)
    shutil.copytree(FIXTURE, parent / "lab" / "cells.zarr")
    annotate(parent / "lab" / "cells.zarr", {"title": "Lab cells"}, "labonly protocol")
    app = make_app(tmp_path, admin_data_roots=[str(parent)])
    access.add_grant(app.config, "bob", "store", f"{app.data}/liver.zarr", actor="alice")
    access.set_restricted(app.config, "bob", True)
    overlay.update(app.config, lambda o: o.setdefault("data_roots", []).append({"path": str(parent / "lab")}))
    assert names(search(client(app, "alice"), app, "labonly")) == ["cells.zarr"]
    assert names(search(client(app, "carol"), app, "labonly")) == ["cells.zarr"]
    assert names(search(client(app, "bob"), app, "labonly")) == []


def test_a_root_removed_after_the_crawl_stops_being_served_to_an_unrestricted_user(tmp_path):
    parent = tmp_path / "atlases"
    (parent / "lab").mkdir(parents=True)
    shutil.copytree(FIXTURE, parent / "lab" / "cells.zarr")
    annotate(parent / "lab" / "cells.zarr", {"title": "Lab cells"}, "labonly protocol")
    app = make_app(tmp_path, admin_data_roots=[str(parent)])
    overlay.update(app.config, lambda o: o.setdefault("data_roots", []).append({"path": str(parent / "lab")}))
    carol = client(app, "carol")
    assert names(search(carol, app, "labonly")) == ["cells.zarr"]
    overlay.update(app.config, lambda o: o.update(data_roots=[]))
    assert names(carol.get(SEARCH, query_string={"q": "labonly"})) == []


def test_a_grant_below_the_walk_depth_is_still_crawled(tmp_path):
    app = make_app(tmp_path, dataset_search_max_depth=1)
    access.add_grant(app.config, "bob", "dir", f"{app.data}/sub", actor="alice")
    access.set_restricted(app.config, "bob", True)
    assert names(search(client(app, "bob"), app, "cardiomyocyte")) == ["heart.zarr"]


def test_remote_stores_are_never_crawled_even_with_a_remote_grant(tmp_path):
    app = make_app(tmp_path, remote_stores="allow")
    access.add_grant(app.config, "bob", "remote", "https://granted.example/atlas/", actor="alice")
    access.set_restricted(app.config, "bob", True)
    search(client(app, "carol"), app, "liver")
    assert all("://" not in e["path"] for e in text_index.load(app.config).entries)


def test_a_capped_index_says_so_and_only_an_unrestricted_user_is_told_counts(granted):
    granted.config["text_index_max_stores"] = 3
    carol, bob = client(granted, "carol"), client(granted, "bob")
    body = search(carol, granted, "atlas").get_json()
    assert body["index"]["capped"] is True and body["index"]["max_stores"] == 3 and body["index"]["stores"] == 3
    mine = search(bob, granted, "atlas").get_json()["index"]
    assert mine["capped"] is True and "stores" not in mine and "max_stores" not in mine
    assert carol.get(STATUS).get_json()["capped"] is True
    # the name search is not touched by the cap
    found = carol.get("/api/v1/datasets/search", query_string={"q": "zarr"}).get_json()
    assert len(found["results"]) == 5
