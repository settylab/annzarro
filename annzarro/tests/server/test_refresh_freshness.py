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
    app = create_app({"TESTING": True, "data_dir": str(tmp_path), "log_file": str(tmp_path / "l.log")})
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
