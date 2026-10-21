"""
store_walk.iter_stores: the walk the dataset name search stands on. Nested folders, hidden folders
and ``sessions``, link loops, a restricted user's grants, and the depth, entry and time limits.
"""
import os
import time

import pytest

from annzarro.server import access, store_walk
from annzarro.server.core import create_app
from annzarro.server.routes import dataset_folders


def _make(path):
    (path / "zarr.json").parent.mkdir(parents=True, exist_ok=True)
    (path / "zarr.json").write_text("{}")


@pytest.fixture
def world(tmp_path):
    data = tmp_path / "data"
    _make(data / "top.zarr")
    _make(data / "a" / "b" / "deep.zarr")
    _make(data / "a" / "mid.zarr")
    _make(data / ".hidden" / "no.zarr")
    _make(data / "sessions" / "no.zarr")
    (data / "sessions" / "set.json").write_text("{}")       # panel sets still live here: the folder is skipped
    _make(data / "a" / "sessions" / "yes.zarr")
    app = create_app({"TESTING": True, "host": "127.0.0.1", "data_dir": str(data), "log_file": str(tmp_path / "t.log"),
                      "user_file": str(tmp_path / "users.json"), "secret_key": "test-only-secret"})
    with app.app_context():
        yield app.config, data


def _names(it):
    return [e["rel_path"] for e in it]


def test_yields_every_store_breadth_first_skipping_hidden_and_the_top_sessions_folder(world):
    config, _ = world
    assert _names(store_walk.iter_stores(config)) == ["top.zarr", "a/mid.zarr", "a/b/deep.zarr", "a/sessions/yes.zarr"]


def test_never_enters_a_store_and_yields_listing_entries(world):
    config, data = world
    _make(data / "top.zarr" / "inner.zarr")
    entries = list(store_walk.iter_stores(config))
    assert not any("inner.zarr" in e["path"] for e in entries)
    top = next(e for e in entries if e["name"] == "top.zarr")
    assert top["kind"] == "store" and top["path"] == str(data / "top.zarr") and top["h5ad"] is False


def test_scope_starts_there_and_a_scope_that_is_a_store_yields_nothing(world):
    config, data = world
    assert _names(store_walk.iter_stores(config, scope=str(data / "a"))) == ["a/mid.zarr", "a/b/deep.zarr", "a/sessions/yes.zarr"]
    assert list(store_walk.iter_stores(config, scope=str(data / "top.zarr"))) == []
    with pytest.raises(FileNotFoundError):
        store_walk.iter_stores(config, scope=str(data / "nope"))      # at the call, not at the first next()


def test_a_link_loop_is_entered_once(world):
    config, data = world
    os.symlink(data / "a", data / "a" / "b" / "loop")
    names = _names(store_walk.iter_stores(config))
    assert names.count("a/b/deep.zarr") == 1 and sorted(names) == sorted(set(names))


def test_a_linked_folder_seen_twice_is_walked_once(world):
    config, data = world
    os.symlink(data / "a" / "b", data / "again")
    paths = [os.path.realpath(e["path"]) for e in store_walk.iter_stores(config)]
    assert len(paths) == len(set(paths))


def test_depth_limit_truncates(world):
    config, _ = world
    stats = store_walk.WalkStats()
    assert _names(store_walk.iter_stores(config, max_depth=2, stats=stats)) == ["top.zarr", "a/mid.zarr"]
    assert stats.truncated
    stats = store_walk.WalkStats()
    list(store_walk.iter_stores(config, max_depth=6, stats=stats))
    assert not stats.truncated and stats.visited > 0


def test_entry_limit_truncates(world):
    config, _ = world
    stats = store_walk.WalkStats()
    list(store_walk.iter_stores(config, max_visited=2, stats=stats))
    assert stats.truncated and stats.visited == 3


def test_deadline_truncates(world):
    config, _ = world
    stats = store_walk.WalkStats()
    assert list(store_walk.iter_stores(config, deadline=time.monotonic() - 1, stats=stats)) == []
    assert stats.truncated


def test_a_consumer_that_sets_truncated_ends_the_walk(world):
    config, _ = world
    stats, seen = store_walk.WalkStats(), []
    for entry in store_walk.iter_stores(config, stats=stats):
        seen.append(entry["name"])
        stats.truncated = True
    assert seen == ["top.zarr"]


def test_a_restricted_user_gets_granted_stores_then_the_walk_of_granted_folders_within_the_grant(world, monkeypatch):
    config, data = world
    outside = data.parent / "outside"
    _make(outside / "secret.zarr")
    os.symlink(outside / "secret.zarr", data / "a" / "leak.zarr")
    grants = [{"name": "a", "path": str(data / "a"), "kind": "folder", "is_link": False, "rel_path": "a"},
              {"name": "top.zarr", "path": str(data / "top.zarr"), "kind": "store", "h5ad": False, "is_link": False,
               "rel_path": "top.zarr"}]
    monkeypatch.setattr(dataset_folders, "_grant_entries", lambda user: grants)
    monkeypatch.setattr(access, "may_read", lambda user, path: os.path.realpath(path).startswith(str(data.resolve())))
    got = [e["name"] for e in store_walk.iter_stores(config, user="bob")]
    assert got[0] == "top.zarr"
    assert sorted(got[1:]) == ["deep.zarr", "mid.zarr", "yes.zarr"]      # the link out of the grant is not listed
    assert "secret.zarr" not in got and "leak.zarr" not in got
