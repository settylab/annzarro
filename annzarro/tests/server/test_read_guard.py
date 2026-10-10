"""Pairwise reads are sized from metadata before any chunk is read.

A dense n x n obsp (the lab's "v3 layout", NaN outside blocks) is 120 GB at
175,000 cells. The stores here are tiny; the "huge" matrices exist only as
metadata (a large shape, no chunk written), so a read that tried them would
either fail on the patched reader or take the test down.

  - /zarr/to_anndata reads metadata only: it answers on such a store without
    opening one chunk (pinned here);
  - /data/obsp, /data/varp, /data/by_path, /data/paginated and /data/statistics
    answer 413 ``read_too_large`` naming the element, before reading, when
    the rows x columns they would hold pass ``server.max_read_mb``;
  - a read under the limit is what it was; sparse matrices are sized by nnz.
"""
import os
import shutil

import numpy as np
import pytest
import zarr

from annzarro.core import read_guard
from annzarro.server.core import create_app

FIXTURE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fixture_small.zarr")
N = 200                    # cells of the fixture
BIG = 200_000              # a stored n x n that is never written: 160 GB as float32


def _build(path):
    root = zarr.open_group(path, mode="r+")
    obsp = root["obsp"]
    small = np.arange(N * N, dtype="float32").reshape(N, N)
    obsp.create_array("small", shape=small.shape, chunks=(50, 50), dtype="float32")[:] = small
    obsp.create_array("big", shape=(BIG, BIG), chunks=(1000, 1000), dtype="float32",
                      fill_value=float("nan"))
    # sparse: a real small CSR, and one whose stored arrays are big (metadata only)
    for name, nnz, real in (("sp_small", 3, True), ("sp_big", 50_000_000, False)):
        g = obsp.create_group(name)
        g.attrs.update({"encoding-type": "csr_matrix", "encoding-version": "0.1.0", "shape": [N, N]})
        if real:
            g.create_array("data", shape=(3,), dtype="float32")[:] = [1, 2, 3]
            g.create_array("indices", shape=(3,), dtype="int32")[:] = [0, 1, 2]
            ptr = np.zeros(N + 1, dtype="int32"); ptr[1:] = 3
            g.create_array("indptr", shape=(N + 1,), dtype="int32")[:] = ptr
        else:
            g.create_array("data", shape=(nnz,), chunks=(1_000_000,), dtype="float32")
            g.create_array("indices", shape=(nnz,), chunks=(1_000_000,), dtype="int32")
            g.create_array("indptr", shape=(N + 1,), dtype="int32")
    zarr.consolidate_metadata(path)
    return small


@pytest.fixture
def make_client(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    store = data_dir / "a.zarr"
    shutil.copytree(FIXTURE, store)
    small = _build(str(store))

    def make(**config):
        app = create_app({"TESTING": True, "DEBUG": False, "auth_enabled": False,
                          "data_dir": str(data_dir), **config})
        return app.test_client(), str(store), small

    yield make
    read_guard.configure(None)


@pytest.fixture
def no_chunk_reads(monkeypatch):
    """Any read of array data fails the test."""
    def refuse(*a, **k):
        raise AssertionError("a chunk was read")
    for name in ("get_orthogonal_selection", "get_basic_selection", "get_mask_selection",
                 "get_coordinate_selection", "_get_selection"):
        if hasattr(zarr.Array, name):
            monkeypatch.setattr(zarr.Array, name, refuse)


def _obsp(client, store, key, **q):
    return client.get(f"/api/v1/data/obsp/{key}", query_string={"dataset_path": store, **q})


def test_to_anndata_reads_no_chunk_of_a_huge_dense_obsp(make_client, no_chunk_reads):
    client, store, _ = make_client()
    reply = client.get("/api/v1/zarr/to_anndata", query_string={"dataset_path": store})
    assert reply.status_code == 200
    body = reply.get_json()
    assert {"big", "small", "sp_big"} <= set(body["obsp"])


def test_dense_over_the_limit_is_413_and_names_the_element(make_client, no_chunk_reads):
    # the response cap is raised past the matrix: only the read guard stands.
    # 100 columns of a 200,000-row float32 matrix: 80 MB, over the 64 MB limit
    client, store, _ = make_client(max_read_mb=64, max_response_elements=10 ** 12)
    reply = _obsp(client, store, "big", cols=",".join(str(i) for i in range(100)))
    assert reply.status_code == 413
    err = reply.get_json()
    assert err["reason"] == "read_too_large"
    assert err["elements"][0]["element"] == "obsp/big"
    assert err["elements"][0]["shape"] == [BIG, BIG]
    assert err["requested_mb"] > err["limit_mb"] == 64
    assert "obsp/big" in err["error"] and "server.max_read_mb" in err["error"]


def test_every_pairwise_route_is_guarded(make_client, no_chunk_reads):
    client, store, _ = make_client(max_read_mb=1, max_response_elements=10 ** 12)
    cols = ",".join(str(i) for i in range(10))     # 200,000 x 10 x 4 B = 8 MB
    q = {"dataset_path": store, "cols": cols}
    for url, extra in (("/api/v1/data/obsp/big", {}),
                       ("/api/v1/data/by_path", {"path": "obsp/big"}),
                       ("/api/v1/data/statistics", {"data_path": "obsp/big"}),
                       ("/api/v1/data/paginated", {"matrix_type": "obsp", "key": "big", "rows": "0,1"})):
        reply = client.get(url, query_string={**q, **extra})
        assert reply.status_code == 413, (url, reply.status_code, reply.get_data(as_text=True)[:200])
        assert reply.get_json()["reason"] == "read_too_large", url


def test_paginated_page_past_the_end_does_not_read_everything(make_client, no_chunk_reads):
    client, store, _ = make_client(max_read_mb=1, max_response_elements=10 ** 12)
    rows = ",".join(str(i) for i in range(100))
    reply = client.get("/api/v1/data/paginated", query_string={
        "dataset_path": store, "matrix_type": "obsp", "key": "big", "rows": rows,
        "page": 99, "page_size": 10})
    assert reply.status_code == 413


def test_under_the_limit_is_as_before(make_client):
    client, store, small = make_client()
    reply = _obsp(client, store, "small", rows="3,7", cols="1,5,9")
    assert reply.status_code == 200
    assert np.array(reply.get_json()["data"]).tolist() == small[[3, 7]][:, [1, 5, 9]].tolist()
    column = _obsp(client, store, "small", cols="4")
    assert column.status_code == 200
    assert np.array(column.get_json()["data"]).ravel().tolist() == small[:, 4].tolist()
    paged = client.get("/api/v1/data/paginated", query_string={
        "dataset_path": store, "matrix_type": "obsp", "key": "small", "rows": "0,1,2", "page_size": 2})
    assert paged.status_code == 200


def test_sparse_is_sized_by_nnz(make_client, no_chunk_reads):
    client, store, _ = make_client(max_read_mb=100, max_response_elements=10 ** 12)
    reply = _obsp(client, store, "sp_big", cols="0")      # a CSR column scans all 50M stored entries
    assert reply.status_code == 413
    el = reply.get_json()["elements"][0]
    assert el["element"] == "obsp/sp_big" and el["sparse"] is True
    assert el["estimated_mb"] >= 380                       # 50M x (4 + 4) bytes


def test_sparse_under_the_limit_is_read(make_client):
    client, store, _ = make_client(max_read_mb=100)
    reply = _obsp(client, store, "sp_small", rows="0,1")
    assert reply.status_code == 200
    assert np.array(reply.get_json()["data"])[:, :3].tolist() == [[1, 2, 3], [0, 0, 0]]


def test_limit_applies_to_everyone_and_defaults_to_a_share_of_ram(make_client):
    assert 256 * 2 ** 20 <= read_guard.default_limit_bytes() <= 4096 * 2 ** 20
    client, store, _ = make_client(max_read_mb=0.00001)
    assert _obsp(client, store, "small", rows="0,1", cols="0,1,2,3,4,5,6,7,8,9").status_code == 413


def test_row_of_a_wide_chunked_matrix_is_sized_by_its_chunks(make_client, tmp_path):
    """A row of a (1000, n) chunked array decompresses 1000 rows: sized by the chunk."""
    client, store, _ = make_client(max_read_mb=64, max_response_elements=10 ** 12)
    root = zarr.open_group(store, mode="r+")
    root["obsp"].create_array("wide", shape=(N, 100_000), chunks=(200, 100_000), dtype="float32",
                              fill_value=float("nan"))     # chunk 80 MB, never written
    root["obsp"].create_array("tall", shape=(N, 100_000), chunks=(200, 1000), dtype="float32",
                              fill_value=float("nan"))     # chunk 0.8 MB: ten at a time
    zarr.consolidate_metadata(store)
    wide = client.get("/api/v1/data/obsp/wide", query_string={"dataset_path": store, "rows": "3"})
    assert wide.status_code == 413
    el = wide.get_json()["elements"][0]
    assert el["chunks"] == [200, 100_000] and el["chunk_working_set_mb"] > 64
    assert "rewrite it with smaller chunks" in wide.get_json()["error"]
    ok = client.get("/api/v1/data/obsp/tall", query_string={"dataset_path": store, "rows": "3"})
    assert ok.status_code == 200
