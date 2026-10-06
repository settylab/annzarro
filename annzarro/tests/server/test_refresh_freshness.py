"""A store changed on disk while the server runs is served fresh after a refresh.

The validation run on v0.3.1 (annzarro-paper notes/sources/
annzarro_v0.3.1_refresh.py) wrote to served stores from a second process
and found the old values served after every refresh mechanism short of a
restart. Each test here writes the same way and checks the reply.
"""
import os

import h5py
import pytest

from annzarro.tests.core.h5ad_twin import h5ad_twin
from annzarro.tests.server.rich_store import make_rich_store


@pytest.fixture
def server(tmp_path):
    from annzarro.server.core import create_app
    import annzarro.core as core
    core.zarr_reader.clear_cache()
    core.h5ad_reader_obj.clear_cache()
    app = create_app({"TESTING": True, "data_dir": str(tmp_path), "log_file": str(tmp_path / "l.log"),
                      "refresh_min_interval_s": 0})
    yield app.test_client()
    core.zarr_reader.clear_cache()
    core.h5ad_reader_obj.clear_cache()


def _first_total_counts(client, path):
    r = client.get("/api/v1/data/obs", query_string={"dataset_path": path, "columns": "total_counts"})
    assert r.status_code == 200, r.get_data(as_text=True)
    return r.get_json()["data"]["total_counts"][0]


def _keep_mtime(path):
    """Put back the file's modification time, so only a refresh can tell."""
    st = os.stat(path)
    return lambda: os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns))


def test_cache_reset_clears_the_h5ad_reader(server, tmp_path):
    """POST /cache/reset cleared the zarr reader only: an .h5ad was served
    from its cached reads until the server restarted."""
    path = h5ad_twin(make_rich_store(tmp_path / "r.zarr"), tmp_path / "r.h5ad")
    old = _first_total_counts(server, path)
    restore = _keep_mtime(path)
    with h5py.File(path, "r+") as f:
        f["obs/total_counts"][0] = old + 1000
    restore()
    assert server.post("/api/v1/cache/reset", query_string={"dataset_path": path}).status_code == 200
    assert _first_total_counts(server, path) == old + 1000


def _read(client, path, etag=None):
    headers = {"If-None-Match": etag} if etag else {}
    return client.get("/api/v1/data/obs", query_string={"dataset_path": path, "columns": "total_counts"},
                      headers=headers)


@pytest.mark.parametrize("kind", ["h5ad", "zarr"])
def test_a_new_etag_comes_with_the_new_body(server, tmp_path, kind):
    """The ETag followed the store's stat() fingerprint, the body came from the
    result cache keyed by request alone: after a rewrite the browser got the
    new tag with the old body, and kept that pair. Both follow one token now."""
    import zarr
    zpath = make_rich_store(tmp_path / "r.zarr")
    path = h5ad_twin(zpath, tmp_path / "r.h5ad") if kind == "h5ad" else zpath
    first = _read(server, path)
    old, tag = first.get_json()["data"]["total_counts"][0], first.headers["ETag"]
    assert _read(server, path, tag).status_code == 304
    if kind == "h5ad":
        with h5py.File(path, "r+") as f:
            f["obs/total_counts"][0] = old + 1000
    else:
        # what anndata.io.write_elem does: the array is written anew
        root = zarr.open_group(path, mode="r+", use_consolidated=False)
        values = root["obs/total_counts"][:]
        values[0] = old + 1000
        attrs = dict(root["obs/total_counts"].attrs)
        del root["obs/total_counts"]
        root["obs"].create_array("total_counts", data=values).attrs.update(attrs)
        zarr.consolidate_metadata(path)
    again = _read(server, path, tag)
    assert again.status_code == 200, "the store changed: no 304"
    assert again.headers["ETag"] != tag
    assert again.get_json()["data"]["total_counts"][0] == old + 1000, "new tag, old body"


def _slice_write(path, value):
    """``g['obs/total_counts'][0] = v``: chunk files only, no metadata, no group touched."""
    import zarr
    root = zarr.open_group(path, mode="r+", use_consolidated=False)
    root["obs/total_counts"][0] = value


def test_a_chunk_write_gets_a_new_etag_after_a_cache_reset(server, tmp_path):
    """No stat() of the store's top level sees a chunk write, so after one
    even a cache reset left the ETag as it was: the browser revalidated,
    got 304 and kept its old body. A reset now starts a new generation."""
    path = make_rich_store(tmp_path / "r.zarr")
    first = _read(server, path)
    old, tag = first.get_json()["data"]["total_counts"][0], first.headers["ETag"]
    _slice_write(path, old + 1000)
    assert _read(server, path, tag).status_code == 304, "a chunk write alone is not seen (by design)"
    assert server.post("/api/v1/cache/reset", query_string={"dataset_path": path}).status_code == 200
    again = _read(server, path, tag)
    assert again.status_code == 200 and again.headers["ETag"] != tag
    assert again.get_json()["data"]["total_counts"][0] == old + 1000


def test_a_bump_from_another_process_reaches_this_one(server, tmp_path):
    """A hosted server's reset reached only the gunicorn worker that answered
    it. The generation lives in a file every worker stats: here a bump made
    outside this process's caches (as another worker's would be) drops them."""
    from annzarro.core import freshness
    path = make_rich_store(tmp_path / "r.zarr")
    old = _first_total_counts(server, path)
    _slice_write(path, old + 1000)
    assert _first_total_counts(server, path) == old, "served from the result cache"
    folder = freshness._generation_dir()
    freshness.bump(path)
    assert (folder / freshness._key(path)).exists(), "the generation is a file, shared by every worker"
    assert _first_total_counts(server, path) == old + 1000


def _hosted(tmp_path):
    from annzarro.server.auth import AuthManager
    from annzarro.server.core import create_app
    users = tmp_path / "users.json"
    manager = AuthManager(user_file=str(users))
    manager.create_user("bob", "pw")
    app = create_app({"TESTING": True, "host": "127.0.0.1", "data_dir": str(tmp_path),
                      "log_file": str(tmp_path / "t.log"), "auth_enabled": True, "user_file": str(users),
                      "refresh_min_interval_s": 0})
    client = app.test_client()
    client.post("/login", data={"username": "bob", "password": "pw"})
    return client


def test_any_user_can_refresh_a_changed_store(tmp_path):
    """On a hosted server only an admin may reset the shared cache, so a user
    never saw a change until a restart. data/refresh is open to every user:
    it starts a new generation only when the store on disk changed."""
    import annzarro.core as core
    core.zarr_reader.clear_cache()
    bob = _hosted(tmp_path)
    path = make_rich_store(tmp_path / "r.zarr")
    assert bob.post("/api/v1/cache/reset", query_string={"dataset_path": path}).status_code == 403
    old = _first_total_counts(bob, path)
    first = bob.post("/api/v1/data/refresh", query_string={"dataset_path": path})
    assert first.status_code == 200, first.get_data(as_text=True)
    tag = _read(bob, path).headers["ETag"]
    # nothing changed: the generation, the tags and everyone's caches stay
    unchanged = bob.post("/api/v1/data/refresh", query_string={"dataset_path": path}).get_json()
    assert unchanged["changed"] is False and unchanged["status"] == "full"
    assert _read(bob, path, tag).status_code == 304
    _slice_write(path, old + 1000)
    changed = bob.post("/api/v1/data/refresh", query_string={"dataset_path": path}).get_json()
    assert changed["changed"] is True
    again = _read(bob, path, tag)
    assert again.status_code == 200 and again.get_json()["data"]["total_counts"][0] == old + 1000
    core.zarr_reader.clear_cache()


def test_refresh_needs_a_dataset_it_may_read(tmp_path):
    bob = _hosted(tmp_path)
    assert bob.post("/api/v1/data/refresh").status_code == 400
    outside = bob.post("/api/v1/data/refresh", query_string={"dataset_path": "/etc"})
    assert outside.status_code == 403, outside.get_data(as_text=True)
    assert bob.post("/api/v1/data/refresh", query_string={"dataset_path": str(tmp_path / "none.zarr")}).status_code == 404
    from annzarro.server.core import create_app
    anonymous = create_app({"TESTING": True, "data_dir": str(tmp_path), "log_file": str(tmp_path / "a.log"),
                            "auth_enabled": True, "user_file": str(tmp_path / "users.json")}).test_client()
    assert anonymous.post("/api/v1/data/refresh", query_string={"dataset_path": str(tmp_path)}).status_code == 401


def _structure(client, path):
    return client.get("/api/v1/data/dataset_structure", query_string={"dataset_path": path}).get_json()


def test_an_element_added_without_consolidating_appears_after_a_refresh(server, tmp_path):
    """anndata's write_elem into a consolidated store, without
    zarr.consolidate_metadata: the new column was missing from the menus and
    the API answered 404 key_not_found, with nothing saying why, through every
    refresh. A refresh now finds the consolidated metadata out of date, reads
    the store without it, and the structure carries a notice with the fix."""
    import numpy as np
    import zarr
    path = make_rich_store(tmp_path / "r.zarr")
    assert _structure(server, path)["consolidated_metadata"] is None
    root = zarr.open_group(path, mode="r+", use_consolidated=False)
    obs = root["obs"]
    new = obs.create_array("new_score", data=np.arange(200, dtype="float64"))
    new.attrs.update({"encoding-type": "array", "encoding-version": "0.2.0"})
    obs.attrs["column-order"] = list(obs.attrs["column-order"]) + ["new_score"]
    q = {"dataset_path": path, "columns": "new_score"}
    assert server.get("/api/v1/data/obs", query_string=q).status_code == 404
    r = server.post("/api/v1/data/refresh", query_string={"dataset_path": path}).get_json()
    assert r["changed"] is True
    assert r["consolidated_metadata"]["stale"] is True
    assert "obs/new_score is on disk but not in it" in r["consolidated_metadata"]["message"]
    assert "zarr.consolidate_metadata" in r["consolidated_metadata"]["message"]
    reply = server.get("/api/v1/data/obs", query_string=q)
    assert reply.status_code == 200, reply.get_data(as_text=True)
    assert reply.get_json()["data"]["new_score"][:3] == [0, 1, 2]
    structure = _structure(server, path)
    assert "new_score" in structure["obs"]["columns"]
    assert structure["consolidated_metadata"]["stale"] is True
    # consolidated again: the notice goes with the next refresh
    zarr.consolidate_metadata(path)
    assert server.post("/api/v1/data/refresh", query_string={"dataset_path": path}).get_json()["consolidated_metadata"] is None
    assert _structure(server, path)["consolidated_metadata"] is None


def test_a_dtype_change_without_consolidating_reads_the_new_array(server, tmp_path):
    """obs/total_counts replaced by float32 with other chunks, not re-consolidated:
    after Ctrl+R the panel showed the OLD values with no message. After a
    refresh the array is read with its own metadata."""
    import numpy as np
    import zarr
    path = make_rich_store(tmp_path / "r.zarr")
    old = _first_total_counts(server, path)
    root = zarr.open_group(path, mode="r+", use_consolidated=False)
    attrs = dict(root["obs/total_counts"].attrs)
    del root["obs/total_counts"]
    root["obs"].create_array("total_counts", data=np.full(200, 7.5, dtype="float32"),
                             chunks=(50,)).attrs.update(attrs)
    server.post("/api/v1/data/refresh", query_string={"dataset_path": path})
    assert _first_total_counts(server, path) == 7.5 != old
    assert "obs/total_counts" in _structure(server, path)["consolidated_metadata"]["detail"]


def test_zarr_format_3_consolidated_additions(server, tmp_path):
    """The same for a format-3 store, whose consolidated metadata is in the root zarr.json."""
    import shutil
    import numpy as np
    import zarr
    src = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fixture_small_v3.zarr")
    path = str(tmp_path / "v3.zarr")
    shutil.copytree(src, path)
    zarr.consolidate_metadata(path)
    root = zarr.open_group(path, mode="r+", use_consolidated=False)
    obs = root["obs"]
    n = obs[obs.attrs.get("_index", "_index")].shape[0]
    obs.create_array("new_score", data=np.arange(n, dtype="float64")).attrs.update(
        {"encoding-type": "array", "encoding-version": "0.2.0"})
    obs.attrs["column-order"] = list(obs.attrs["column-order"]) + ["new_score"]
    q = {"dataset_path": path, "columns": "new_score"}
    assert server.get("/api/v1/data/obs", query_string=q).status_code == 404
    r = server.post("/api/v1/data/refresh", query_string={"dataset_path": path}).get_json()
    assert "obs/new_score is on disk but not in it" in r["consolidated_metadata"]["detail"]
    assert server.get("/api/v1/data/obs", query_string=q).status_code == 200


def test_a_refresh_inside_the_interval_waits_for_a_walk_after_it(tmp_path):
    """Any user may refresh, so a dataset is walked at most once per
    server.refresh_min_interval_s; but a refresh must never be answered with
    a walk older than itself. Write, refresh at t=0, write again, refresh at
    t=1: the second refresh waits for the walk at the interval's end and the
    second write is served."""
    import time as _time
    from annzarro.server.core import create_app
    import annzarro.core as core
    core.zarr_reader.clear_cache()
    client = create_app({"TESTING": True, "data_dir": str(tmp_path), "log_file": str(tmp_path / "l.log"),
                         "refresh_min_interval_s": 3}).test_client()
    path = make_rich_store(tmp_path / "r.zarr")
    q = {"dataset_path": path}
    old = _first_total_counts(client, path)
    _slice_write(path, old + 1000)
    t0 = _time.monotonic()
    first = client.post("/api/v1/data/refresh", query_string=q).get_json()
    assert first["status"] == "full" and first["waited_s"] == 0
    assert _first_total_counts(client, path) == old + 1000
    _slice_write(path, old + 2000)
    _time.sleep(1)
    second = client.post("/api/v1/data/refresh", query_string=q).get_json()
    assert _time.monotonic() - t0 >= 3, "walked again inside the interval"
    assert second["changed"] is True and 1.5 <= second["waited_s"] <= 3
    assert _first_total_counts(client, path) == old + 2000
    core.zarr_reader.clear_cache()


def test_refreshes_waiting_for_the_next_walk_share_it(tmp_path):
    import threading
    from annzarro.core import freshness
    path = make_rich_store(tmp_path / "r.zarr")
    freshness.revalidate(path, min_interval_s=0)           # the walk the window starts from
    walks = []

    def inspect():
        walks.append(1)
        return {}
    results = []
    threads = [threading.Thread(target=lambda: results.append(
        freshness.revalidate(path, min_interval_s=1.5, inspect=inspect))) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(walks) == 1, walks
    assert len(results) == 5 and sum(1 for r in results if r.get("shared")) == 4


def test_a_store_too_large_to_walk_is_partial_not_bumped(tmp_path):
    """The walk stops at its budget (the 95.6M-cell store has far more chunk
    files than 3 s of stat() calls): the answer says so, and the generation,
    with every user's cached reads, stays; an admin's reset still bumps it."""
    from annzarro.core import freshness
    path = make_rich_store(tmp_path / "r.zarr")
    many = os.path.join(path, "uns", "many")
    os.makedirs(many)
    for i in range(3000):
        open(os.path.join(many, str(i)), "w").close()
    gen = freshness.generation(path)
    r = freshness.revalidate(path, min_interval_s=0, budget_s=0.0)
    assert r["status"] == "partial" and r["checked"] is False and r["changed"] is False
    assert "too large to fingerprint fully" in r["message"]
    assert freshness.generation(path) == gen
