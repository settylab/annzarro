"""
A store with every AnnData slot filled, built with zarr alone (the test env
has no anndata): fixture_small.zarr plus a dense layer, obsp/varp matrices
and uns entries of each common encoding (string scalar, numeric scalar,
nested dict, numeric and string arrays). Consolidated, like anndata writes.
"""
import os
import shutil

import numpy as np
import pytest
import zarr

FIXTURE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "data", "fixture_small.zarr")
N_OBS, N_VAR = 200, 20


def _encode(node, kind, version="0.2.0"):
    node.attrs.update({"encoding-type": kind, "encoding-version": version})
    return node


def make_rich_store(path):
    """Write the store at ``path`` (replacing it) and return ``str(path)``."""
    if int(zarr.__version__.split(".")[0]) < 3:
        pytest.skip("builds the store with the zarr 3 API")
    path = str(path)
    shutil.rmtree(path, ignore_errors=True)
    shutil.copytree(FIXTURE, path)
    root = zarr.open_group(path, mode="a")
    _encode(root["layers"].create_array(
        "counts", data=np.arange(N_OBS * N_VAR, dtype="float32").reshape(N_OBS, N_VAR)), "array")
    _encode(root["obsp"].create_array("conn", data=np.eye(N_OBS, dtype="float32")), "array")
    _encode(root["varp"].create_array("corr", data=np.eye(N_VAR, dtype="float32")), "array")

    uns = root["uns"]
    title = uns.create_array("title", shape=(), dtype=str)
    title[()] = "hello"
    _encode(title, "string")
    run = _encode(uns.create_group("run"), "dict", "0.1.0")
    n = run.create_array("n", shape=(), dtype="int64")
    n[()] = 7
    _encode(n, "numeric-scalar")
    when = run.create_array("when", shape=(), dtype=str)
    when[()] = "2026-10-02"
    _encode(when, "string")
    _encode(uns.create_array("vec", data=np.array([1.0, 2.0, 3.0])), "array")
    names = uns.create_array("names", shape=(2,), dtype=str)
    names[:] = np.array(["a", "b"])
    _encode(names, "string-array")

    zarr.consolidate_metadata(path)
    return path
