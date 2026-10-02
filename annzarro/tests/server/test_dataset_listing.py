"""
/api/v1/datasets must not open every store on every call.

On the live service the listing took 1.3-4.9 s for 33 datasets because each
call opened each store to read its cell/gene counts. The counts are now
memoised per entry against a stat() signature, so a repeat listing opens
nothing, and a rewritten store is opened again.
"""
import os
import shutil
from unittest.mock import patch

import pytest

from annzarro.server.core import create_app
from annzarro.server.routes import data_routes

FIXTURE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fixture_small.zarr"
)


@pytest.fixture
def client_and_dir(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    shutil.copytree(FIXTURE, data_dir / "a.zarr")
    shutil.copytree(FIXTURE, data_dir / "b.zarr")
    (data_dir / "broken.zarr").mkdir()          # looks like a store, is not one
    getattr(data_routes, "_LISTING_PROBE_CACHE", {}).clear()
    app = create_app({"TESTING": True, "DEBUG": False, "data_dir": str(data_dir)})
    yield app.test_client(), data_dir
    getattr(data_routes, "_LISTING_PROBE_CACHE", {}).clear()


def _list(client):
    resp = client.get("/api/v1/datasets")
    assert resp.status_code == 200
    return resp.get_json()


def test_repeat_listing_opens_no_store(client_and_dir):
    client, _ = client_and_dir
    real = data_routes.zarr_reader.get_basic_counts
    with patch.object(data_routes.zarr_reader, "get_basic_counts", side_effect=real) as probe:
        first = _list(client)
        assert probe.call_count == 3            # a, b and the broken one, once each
        second = _list(client)
        assert probe.call_count == 3, "the second listing re-opened stores"
    assert first == second
    assert [d["name"] for d in first] == ["a.zarr", "b.zarr"]
    assert first[0]["cells"] == 200 and first[0]["genes"] == 20


def test_rewritten_store_is_probed_again(client_and_dir):
    client, data_dir = client_and_dir
    real = data_routes.zarr_reader.get_basic_counts
    with patch.object(data_routes.zarr_reader, "get_basic_counts", side_effect=real) as probe:
        _list(client)
        n = probe.call_count
        # A rewrite replaces the obs group; its mtime moves.
        obs = data_dir / "a.zarr" / "obs"
        st = os.stat(obs)
        os.utime(obs, ns=(st.st_atime_ns, st.st_mtime_ns + 10**9))
        _list(client)
        assert probe.call_count == n + 1, "only the changed store is re-opened"


def test_removed_store_disappears(client_and_dir):
    client, data_dir = client_and_dir
    _list(client)
    shutil.rmtree(data_dir / "b.zarr")
    assert [d["name"] for d in _list(client)] == ["a.zarr"]


def test_lists_top_level_and_datasets_subdirectory(tmp_path):
    """With a datasets/ subdirectory (the desktop app creates one) only that
    was listed; stores at the top of data_dir were hidden."""
    data_dir = tmp_path / "data"
    (data_dir / "datasets").mkdir(parents=True)
    (data_dir / "sessions").mkdir()
    shutil.copytree(FIXTURE, data_dir / "top.zarr")
    shutil.copytree(FIXTURE, data_dir / "datasets" / "nested.zarr")
    getattr(data_routes, "_LISTING_PROBE_CACHE", {}).clear()
    client = create_app({"TESTING": True, "data_dir": str(data_dir),
                         "log_file": str(tmp_path / "l.log")}).test_client()
    listed = _list(client)
    names = sorted(d["name"] for d in listed)
    assert names == ["nested.zarr", "top.zarr"], "both levels; datasets/ and sessions/ are not entries"
    rel = {d["name"]: d["rel_path"] for d in listed}
    assert rel == {"top.zarr": "top.zarr", "nested.zarr": os.path.join("datasets", "nested.zarr")}
