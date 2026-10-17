"""A store with one of each AnnData encoding where it matters, and a hostile MARKER in every name.

Used by the server tests of ``/datasets/info`` and by the browser tests of the Structure tab.
"""
import shutil

import numpy as np

from annzarro.tests import zarr_compat

MARKER = "<img src=x onerror=alert(1)>MARKER"


def _enc(node, kind, version="0.1.0", **attrs):
    node.attrs.update({"encoding-type": kind, "encoding-version": version, **attrs})
    return node


def _frame(group, name, columns, rows=4):
    frame = _enc(group.require_group(name), "dataframe", "0.2.0", **{"_index": "_index", "column-order": list(columns)})
    zarr_compat.write_strings(frame, "_index", [f"r{i}" for i in range(rows)])
    for column in columns:
        zarr_compat.write_array(frame, column, np.arange(rows, dtype="float64"))
    return frame


def sparse(group, name, dense):
    m = np.asarray(dense)
    rows, cols = np.nonzero(m)
    node = _enc(group.require_group(name), "csr_matrix", "0.1.0", shape=list(m.shape))
    zarr_compat.write_array(node, "data", m[rows, cols].astype("float32"))
    zarr_compat.write_array(node, "indices", cols.astype("int32"))
    zarr_compat.write_array(node, "indptr", np.concatenate([[0], np.cumsum((m != 0).sum(axis=1))]).astype("int32"))
    return node


def build_rich_store(store, fixture):
    """Write the store at ``store`` (a copy of ``fixture`` with the additions) and return it."""
    shutil.copytree(fixture, store)
    root = zarr_compat.open_group(store, mode="r+")
    obs, uns = root["obs"], root.require_group("uns")
    # an ordered categorical with 2 colours for 3 categories, and a leiden with the right 5
    obs["cell_type"].attrs["ordered"] = True
    zarr_compat.write_array(uns, "cell_type_colors", np.array(["#ff0000", "red; background:url(x)"]))
    zarr_compat.write_array(uns, "leiden_colors", np.array(["#111111", "#222222", "#333333", "#444444", "#555555"]))
    nullable = zarr_compat.write_array(obs, "age", np.arange(200, dtype="int64"))
    nullable.attrs["encoding-type"] = "nullable-integer"
    zarr_compat.write_array(obs, MARKER, np.arange(200, dtype="float32"))
    obs.attrs["column-order"] = [*obs.attrs["column-order"], "age", MARKER]
    # uns: one of each encoding must be one element, never a group with codes and indptr
    _frame(uns, "df", ["a", "b", "c"])
    cat = _enc(uns.require_group("cat"), "categorical", ordered=False)
    zarr_compat.write_array(cat, "categories", np.array(["x", "y"]))
    zarr_compat.write_array(cat, "codes", np.array([0, 1, 1], dtype="int8"))
    sparse(uns, "mat", np.eye(4))
    zarr_compat.write_array(uns, "n", np.asarray(7))
    zarr_compat.write_array(uns, "note", np.asarray(MARKER))
    zarr_compat.write_array(uns, MARKER, np.asarray("v"))
    zarr_compat.write_array(uns, "big", np.zeros(1000))
    # slots
    sparse(root["obsm"], "X_sparse", np.eye(4))
    _frame(root["obsm"], "frame", ["u", "v"])
    awk = _enc(root["obsm"].require_group("awk"), "awkward-array", length=200, form=MARKER)
    zarr_compat.write_array(awk, "node0-data", np.zeros(3))
    # raw, and a group the AnnData spec does not have
    del root["raw"]                       # the fixture has the null placeholder anndata writes for raw=None
    raw = root.require_group("raw")
    zarr_compat.write_array(raw, "X", np.zeros((200, 30), dtype="float32"))
    _frame(raw, "var", ["gene_name", "hv"], rows=30)
    root.require_group("obst").attrs["encoding-type"] = "dict"
    zarr_compat.consolidate(store)
    return store


