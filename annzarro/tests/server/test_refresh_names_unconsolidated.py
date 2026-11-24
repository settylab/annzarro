"""A column added on disk without re-consolidating, then Refresh: the gene names are still served.

zarr 3's use_consolidated=False covered the root group only; a child group read its own empty
consolidated listing and answered no members, so /data/genes was [] and a Gene Plot said the
dataset reported no gene names (the flow docs/deployment/analyst-workflow.md describes).
"""
import os
import shutil

import numpy as np
import pytest
import zarr

from annzarro.tests.server.rich_store import make_rich_store
from annzarro.tests.server.test_refresh_freshness import server  # noqa: F401 (fixture)

ZARR3 = int(zarr.__version__.split(".")[0]) >= 3
FIXTURES = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")


def _store(tmp_path, fmt):
    if fmt == 2:
        return make_rich_store(tmp_path / "r.zarr")
    path = str(tmp_path / "v3.zarr")
    shutil.copytree(os.path.join(FIXTURES, "fixture_small_v3.zarr"), path)
    zarr.consolidate_metadata(path)
    return path


def _genes(client, path):
    r = client.get("/api/v1/data/genes", query_string={"dataset_path": path})
    assert r.status_code == 200, r.get_data(as_text=True)
    return r.get_json()["genes"]


@pytest.mark.parametrize("fmt", [2, 3])
def test_gene_names_and_the_new_column_are_served_after_a_refresh(server, tmp_path, fmt):
    if not ZARR3:
        pytest.skip("the unconsolidated open of child groups is a zarr 3 matter")
    path = _store(tmp_path, fmt)
    before = _genes(server, path)
    assert before
    root = zarr.open_group(path, mode="r+", use_consolidated=False)
    obs = root["obs"]
    n = obs[obs.attrs.get("_index", "_index")].shape[0]
    obs.create_array("new_score", data=np.arange(n, dtype="float64")).attrs.update(
        {"encoding-type": "array", "encoding-version": "0.2.0"})
    obs.attrs["column-order"] = list(obs.attrs["column-order"]) + ["new_score"]
    r = server.post("/api/v1/data/refresh", query_string={"dataset_path": path}).get_json()
    assert r["consolidated_metadata"]["stale"] is True
    assert _genes(server, path) == before, "the gene names went missing after the refresh"
    reply = server.get("/api/v1/data/obs", query_string={"dataset_path": path, "columns": "new_score"})
    assert reply.status_code == 200 and reply.get_json()["data"]["new_score"][:3] == [0, 1, 2]
    structure = server.get("/api/v1/data/dataset_structure", query_string={"dataset_path": path}).get_json()
    assert "new_score" in structure["obs"]["columns"] and structure["var"]["columns"] is not None


def test_the_store_is_never_written(server, tmp_path):
    if not ZARR3:
        pytest.skip("zarr 3 only")
    path = _store(tmp_path, 2)
    root = zarr.open_group(path, mode="r+", use_consolidated=False)
    root["obs"].attrs["note"] = "edited"
    snap = {os.path.join(d, f): os.stat(os.path.join(d, f)).st_mtime_ns
            for d, _, fs in os.walk(path) for f in fs}
    server.post("/api/v1/data/refresh", query_string={"dataset_path": path})
    _genes(server, path)
    assert snap == {os.path.join(d, f): os.stat(os.path.join(d, f)).st_mtime_ns
                    for d, _, fs in os.walk(path) for f in fs}


def test_a_normal_open_keeps_the_consolidated_listing(server, tmp_path, monkeypatch):
    """The per-group fallback is for a listing found stale only: a store whose .zmetadata matches its
    files is opened through it (a few reads, not one per array), also after a Refresh that changed nothing."""
    if not ZARR3:
        pytest.skip("zarr 3 only")
    from annzarro.core import unconsolidated
    used = []
    real = unconsolidated.open_group
    monkeypatch.setattr(unconsolidated, "open_group", lambda p: used.append(p) or real(p))
    path = _store(tmp_path, 2)
    _genes(server, path)
    server.post("/api/v1/data/refresh", query_string={"dataset_path": path})
    _genes(server, path)
    assert used == [], "a store with a matching listing was read without it"
    # stale: now it is
    root = zarr.open_group(path, mode="r+", use_consolidated=False)
    root["obs"].create_array("late", data=np.arange(200, dtype="float64"))
    server.post("/api/v1/data/refresh", query_string={"dataset_path": path})
    _genes(server, path)
    assert used, "a stale listing was not read around"


def test_the_listing_is_a_few_reads_and_the_fallback_one_per_node(tmp_path):
    """Read counts to open and list a store with 200 obs and 200 var columns (a counting LocalStore)."""
    if not ZARR3:
        pytest.skip("zarr 3 only")
    from zarr.storage import LocalStore
    from annzarro.core import unconsolidated
    from annzarro.tests.zarr_compat import consolidate, open_group
    path = tmp_path / "wide.zarr"
    g = open_group(path, mode="w")
    for name in ("obs", "var"):
        grp = g.create_group(name)
        grp.attrs.update({"_index": "_index", "encoding-type": "dataframe", "encoding-version": "0.2.0"})
        for i in range(200):
            grp.create_array(f"c{i}", data=np.arange(10, dtype="float64"))
    consolidate(path)

    class Counting(LocalStore):
        gets = 0

        async def get(self, *a, **k):
            Counting.gets += 1
            return await super().get(*a, **k)

    def reads(wrap):
        Counting.gets = 0
        store = Counting(str(path), read_only=True)
        root = (zarr.open_group(unconsolidated._WithoutListing(store), mode="r", use_consolidated=False) if wrap
                else zarr.open_group(store, mode="r"))
        for name in ("obs", "var"):
            for key in root[name].keys():
                root[name][key].shape
        return Counting.gets

    assert reads(False) < 20 and reads(True) > 400
