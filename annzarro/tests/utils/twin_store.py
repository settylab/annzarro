"""A format 2 AnnData store with every kind of array the read routes serve, and its format 3
twins, for tests that compare what each one answers.

``fixture_small.zarr`` plus a dense layer, a CSR layer and a CSR obsp whose arrays span several
chunks, a dense obsp and varp chunked by row blocks, and category colors in ``uns``; written
with zarr alone. ``convert_twins`` rewrites it as format 3 twice, plain (same chunks) and sharded
(small inner chunks, shards of several inner chunks, 1-D sparse arrays sharded too). Needs zarr 3.
"""
import os
import shutil

import numpy as np
import zarr

FIXTURE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fixture_small.zarr")
N_OBS, N_VAR = 200, 20


def _format2_fixture():
    """The committed format 2 fixture; under ``ANNZARRO_TEST_ZARR_FORMAT=3`` conftest has put a
    converted copy in its place and the original beside it."""
    aside = os.path.join(os.path.dirname(FIXTURE), ".fixture_small.zarr.format2")
    return aside if os.path.isdir(aside) else FIXTURE


def _encode(node, kind, version="0.2.0", **attrs):
    node.attrs.update({"encoding-type": kind, "encoding-version": version, **attrs})
    return node


def build_v2_twin(path):
    shutil.copytree(_format2_fixture(), path)
    root = zarr.open_group(path, mode="r+")
    rng = np.random.default_rng(7)
    dense = rng.random((N_OBS, N_VAR), dtype="float32")
    layer = root["layers"].create_array("dense", shape=dense.shape, chunks=(100, 10), dtype="float32")
    layer[:] = dense
    _encode(layer, "array")
    pair = rng.random((N_OBS, N_OBS), dtype="float32")
    conn = root["obsp"].create_array("conn", shape=pair.shape, chunks=(20, N_OBS), dtype="float32")
    conn[:] = pair
    _encode(conn, "array")
    corr = root["varp"].create_array("corr", shape=(N_VAR, N_VAR), chunks=(5, N_VAR), dtype="float32")
    corr[:] = rng.random((N_VAR, N_VAR), dtype="float32")
    _encode(corr, "array")
    # sparse: a CSR layer and a CSR obsp, 5 and 4 chunks per component
    for slot, key, shape in (("layers", "csr", (N_OBS, N_VAR)), ("obsp", "knn", (N_OBS, N_OBS))):
        mask = rng.random(shape) < 0.1
        values = (rng.random(shape) * mask).astype("float32")
        indptr = np.zeros(shape[0] + 1, dtype="int32")
        indptr[1:] = np.cumsum(mask.sum(axis=1))
        group = _encode(root[slot].create_group(key), "csr_matrix", "0.1.0", shape=list(shape))
        nnz = int(mask.sum())
        chunk = -(-nnz // 5)
        data = group.create_array("data", shape=(nnz,), chunks=(chunk,), dtype="float32")
        data[:] = values[mask]
        indices = group.create_array("indices", shape=(nnz,), chunks=(chunk,), dtype="int32")
        indices[:] = np.nonzero(mask)[1].astype("int32")
        group.create_array("indptr", shape=indptr.shape, dtype="int32")[:] = indptr
    colors = root["uns"].create_array("cell_type_colors", shape=(3,), dtype=str)
    colors[:] = np.array(["#1f77b4", "#ff7f0e", "#2ca02c"])
    _encode(colors, "string-array")
    zarr.consolidate_metadata(path)




def convert_twins(v2, base):
    """{"plain": path, "sharded": path} next to each other under ``base``."""
    from annzarro.tests.utils.make_fixture_zarr_v3 import convert
    plain = convert(v2, os.path.join(base, "twin_plain.zarr"))
    sharded = convert(v2, os.path.join(base, "twin_sharded.zarr"), sharded=True, target=400, shard_factor=2,
                      pair_shard_factor=4, min_shard_bytes=0)
    return {"plain": plain, "sharded": sharded}
