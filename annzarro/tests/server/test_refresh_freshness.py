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
