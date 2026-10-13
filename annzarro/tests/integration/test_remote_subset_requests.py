"""A gene on a cell subset of a remote CSR X fetches each chunk once.

Over HTTP every chunk read is a request, so reading each selected row on its own
(one decode of a whole chunk per row) was also one request per row and part.
"""
import dataclasses
import functools
import http.server
import re
import threading

import numpy as np
import pytest
import scipy.sparse as sp

from annzarro.core import remote
from annzarro.core.zarr_reader import ZarrReader
from annzarro.tests.integration.test_remote_http_store import _Handler
from annzarro.tests.zarr_compat import SHARDED, open_group, write_array

pytest.importorskip("fsspec")
pytest.importorskip("aiohttp")

N_CELLS, N_GENES, CHUNK = 4000, 60, 600


@pytest.fixture
def served(tmp_path):
    mat = sp.random(N_CELLS, N_GENES, density=0.1, format="csr", dtype=np.float32, random_state=0)
    g = open_group(tmp_path / "toy.zarr").create_group("X")
    g.attrs.update({"encoding-type": "csr_matrix", "encoding-version": "0.1.0", "shape": [N_CELLS, N_GENES]})
    for name in ("data", "indices"):
        write_array(g, name, getattr(mat, name), chunks=(CHUNK,))
    write_array(g, "indptr", mat.indptr, chunks=(500,))
    handler = type("Handler", (_Handler,), {"requests": []})
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), functools.partial(handler, directory=str(tmp_path)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield mat, f"http://127.0.0.1:{server.server_port}/toy.zarr", handler
    server.shutdown()
    server.server_close()


@pytest.mark.skipif(SHARDED, reason="the plain http.server cannot answer the range requests a shard needs")
def test_subset_gene_fetches_each_chunk_at_most_once(served):
    mat, url, handler = served
    # no chunk cache, or it would answer the repeats and hide them
    policy = dataclasses.replace(remote.get_remote_policy(), chunk_cache_mb=0)
    group = remote.open_remote_group(url, policy)["X"]
    rows = np.sort(np.random.default_rng(1).choice(N_CELLS, 800, replace=False))
    before = len(handler.requests)
    got = ZarrReader(enable_caching=False)._rows_of_major_slices(
        group, mat.shape, rows, [7], axis="row")
    made = [p for p in handler.requests[before:] if "/X/" in p]
    assert np.array_equal(got.toarray(), mat[rows][:, [7]].toarray())
    chunks = [p for p in made if re.search(r"/(data|indices|indptr)/(c/)?\d+$", p)]
    assert chunks and len(chunks) == len(set(chunks)), "a chunk was requested twice"
    assert len(chunks) <= 2 * -(-mat.nnz // CHUNK) + -(-(N_CELLS + 1) // 500), len(chunks)
    print("chunk requests:", len(chunks))
