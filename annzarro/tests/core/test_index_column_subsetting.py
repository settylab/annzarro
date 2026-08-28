"""The `_index` column of a SUBSET obs read must be subset too.

``get_obs_var`` slices every data column by ``indices``, but read the index
member separately and unconditionally as ``root[obj][index_col][:]`` -- the
full array. A caller asking for two rows therefore got two-element data
columns beside a full-length ``_index``, so row LABELS no longer lined up
with row DATA. Nothing raised and nothing logged: the payload was well
formed and simply described different rows in different keys.

Measured on 8295639 with a six-cell store and ``indices=[1, 3]``::

    _index -> ['cell_0' ... 'cell_5']   (6)
    score  -> [1.0, 3.0]                 (2)

Routing the index member through ``_get_categorical_values(member, indices)``
fixes it, and this is the arm that holds it fixed. The length equality is the
load-bearing assertion; the value check is what distinguishes "subset" from
"truncated to the right length".
"""

import numpy as np
import pytest
import zarr

from annzarro.core.zarr_reader import ZarrReader

_ZARR_V3 = int(zarr.__version__.split(".")[0]) >= 3

CELLS = [f"cell_{i}" for i in range(6)]
GENES = [f"gene_{j}" for j in range(4)]
PICKED = [1, 3]


def _open_root(path, mode="w"):
    if _ZARR_V3:
        return zarr.open_group(str(path), mode=mode, zarr_format=2)
    return zarr.open_group(str(path), mode=mode)


def _strarr(group, name, values):
    if _ZARR_V3:
        arr = group.create_array(name, shape=(len(values),), dtype=str)
        arr[:] = list(values)
        return arr
    numcodecs = pytest.importorskip("numcodecs")
    return group.create_dataset(
        name, data=np.array(values, dtype=object), dtype=object,
        object_codec=numcodecs.VLenUTF8(), shape=(len(values),))


def _numarr(group, name, values, dtype=None):
    arr = np.asarray(values) if dtype is None else np.asarray(values, dtype=dtype)
    if _ZARR_V3:
        out = group.create_array(name, shape=arr.shape, dtype=arr.dtype)
        out[:] = arr
        return out
    return group.create_dataset(name, data=arr)


@pytest.fixture
def store(tmp_path):
    p = tmp_path / "subset.zarr"
    root = _open_root(p)
    root.attrs.update({"encoding-type": "anndata", "encoding-version": "0.1.0"})
    _numarr(root, "X",
            np.arange(len(CELLS) * len(GENES), dtype=np.float32)
              .reshape(len(CELLS), len(GENES)))

    obs = root.create_group("obs")
    obs.attrs.update({"encoding-type": "dataframe", "encoding-version": "0.2.0",
                      "_index": "_index", "column-order": ["score"]})
    _strarr(obs, "_index", CELLS)
    _numarr(obs, "score", np.arange(len(CELLS), dtype=np.float32))

    var = root.create_group("var")
    var.attrs.update({"encoding-type": "dataframe", "encoding-version": "0.2.0",
                      "_index": "_index", "column-order": []})
    _strarr(var, "_index", GENES)
    return p


def test_subset_index_matches_subset_columns(store):
    data = ZarrReader(enable_caching=False).get_obs_var(
        "cells", dataset_path=str(store), indices=PICKED)["data"]

    assert len(data["_index"]) == len(data["score"]), (
        "_index and data columns describe different row counts: "
        f"{len(data['_index'])} labels for {len(data['score'])} values")
    assert data["_index"] == [CELLS[i] for i in PICKED]
    assert data["score"] == [float(i) for i in PICKED]


def test_full_read_is_unchanged(store):
    """Control. The no-``indices`` path must still return every row.

    It does NOT catch a truncating fix, and an earlier revision of this
    docstring claimed it did. Measured, with `cell_names` truncated to
    ``[:len(indices)]``: this test PASSES and the value assertion in the test
    above is what kills the mutant. The module docstring had it right --
    "the value check is what distinguishes subset from truncated" -- so the
    file contradicted itself, and the claim was the wrong half.

    What this arm actually guards is the opposite mutant: a fix that subsets
    correctly but breaks the full read -- slicing unconditionally, or
    returning ``[]`` when ``indices`` is None. That path carries almost all
    the traffic, so it is worth an arm; it is just not the truncation guard.
    """
    data = ZarrReader(enable_caching=False).get_obs_var(
        "cells", dataset_path=str(store))["data"]

    assert data["_index"] == CELLS
    assert data["score"] == [float(i) for i in range(len(CELLS))]
