"""A small store with one of every per-cell source (obs, obsm, layer, obsp), in each layout and backend.

It extends ``gene_score_store`` (200 cells, 20 genes, ``counts`` layer) with the columns the per-cell
source reader (``core/cell_sources.py``) must handle, and returns the arrays they were written from, so a
test compares the reader with the data and not with another reading of the store.
"""
import shutil

import numpy as np
import scipy.sparse as sp

from annzarro.tests import zarr_compat
from annzarro.tests.core.gene_score_store import N_OBS, make_matrix, make_store
from annzarro.tests.core.h5ad_twin import h5ad_twin

MANY_CATEGORIES = 70_000            # past core/categories.READ_ALL_MAX (65,536)
CATEGORIES = ["B", "T", "NK", "other"]


def expected():
    """Everything the store holds beside the matrix, as arrays."""
    rng = np.random.default_rng(11)
    codes = rng.integers(0, 4, N_OBS).astype(np.int8)
    codes[[3, 77]] = -1
    pseudotime = rng.random(N_OBS).astype(np.float32)
    pseudotime[[5, 9, 120]] = np.nan
    nullable = rng.integers(0, 50, N_OBS).astype(np.int64)
    nullable_mask = np.zeros(N_OBS, dtype=bool)
    nullable_mask[[0, 100]] = True
    wide = rng.normal(size=(N_OBS, 50)).astype(np.float32)
    sparse_m = sp.random(N_OBS, 10, density=0.2, format="csr", random_state=4, dtype=np.float32)
    dense_p = rng.random((N_OBS, N_OBS)).astype(np.float32)
    knn = sp.random(N_OBS, N_OBS, density=0.05, format="csr", random_state=5, dtype=np.float32)
    return dict(
        ctype_codes=codes, ctype=CATEGORIES,
        many_codes=((np.arange(N_OBS) * 307) % MANY_CATEGORIES).astype(np.int32),
        flag=rng.random(N_OBS) < 0.4,
        depth=rng.integers(0, 10_000, N_OBS).astype(np.int64),
        pseudotime=pseudotime,
        nullable=nullable, nullable_mask=nullable_mask,
        note=np.array([f"note{i % 7}" for i in range(N_OBS)], dtype=object),
        wide=wide, sparse_m=sparse_m, dense_p=dense_p, knn=knn,
    )


def _group(parent, name, encoding, **attrs):
    g = parent.create_group(name)
    g.attrs["encoding-type"] = encoding
    g.attrs["encoding-version"] = "0.1.0"
    for k, v in attrs.items():
        g.attrs[k] = v
    return g


def _sparse(group, name, m, layout):
    m = m.tocsr() if layout == "csr" else m.tocsc()
    g = _group(group, name, f"{layout}_matrix", shape=list(m.shape))
    for part in ("data", "indices", "indptr"):
        arr = np.asarray(getattr(m, part))
        zarr_compat.write_array(g, part, arr, chunks=(max(1, min(len(arr), 64)),))


def make_cell_store(path, layout="csc", backend="zarr"):
    """The store at ``path`` (a .zarr or .h5ad path), X written as ``layout``. Returns ``(path, expected())``."""
    path = str(path)
    zpath = path if backend == "zarr" else path + ".src.zarr"
    x = make_matrix()
    make_store(zpath, x, layout, "zarr", layer=np.round(x * 2).astype(np.float32))
    e = expected()
    root = zarr_compat.open_group(zpath, mode="r+")
    obs = root["obs"]

    cat = _group(obs, "ctype", "categorical", ordered=False)
    zarr_compat.write_array(cat, "codes", e["ctype_codes"], chunks=(64,))
    zarr_compat.write_strings(cat, "categories", e["ctype"])

    many = _group(obs, "many", "categorical", ordered=False)
    zarr_compat.write_array(many, "codes", e["many_codes"], chunks=(64,))
    zarr_compat.write_strings(many, "categories", [f"cat{i}" for i in range(MANY_CATEGORIES)])

    zarr_compat.write_array(obs, "flag", e["flag"], chunks=(64,))
    zarr_compat.write_array(obs, "depth", e["depth"], chunks=(64,))
    zarr_compat.write_array(obs, "pseudotime", e["pseudotime"], chunks=(64,))
    nullable = _group(obs, "nullable", "nullable-integer")
    zarr_compat.write_array(nullable, "values", e["nullable"], chunks=(64,))
    zarr_compat.write_array(nullable, "mask", e["nullable_mask"], chunks=(64,))
    zarr_compat.write_strings(obs, "note", list(e["note"]))
    obs.attrs["column-order"] = ["cell_type", "leiden", "total_counts", "ctype", "many", "flag", "depth",
                                 "pseudotime", "nullable", "note"]

    zarr_compat.write_array(root["obsm"], "wide", e["wide"], chunks=(64, 50))
    _sparse(root["obsm"], "sparse_m", e["sparse_m"], "csr")
    obsp = root["obsp"] if "obsp" in root else root.create_group("obsp")
    zarr_compat.write_array(obsp, "dense_p", e["dense_p"], chunks=(64, N_OBS))
    _sparse(obsp, "knn_csr", e["knn"], "csr")
    _sparse(obsp, "knn_csc", e["knn"], "csc")
    zarr_compat.consolidate(zpath)
    if backend == "zarr":
        return path, e
    h5ad_twin(zpath, path)
    shutil.rmtree(zpath, ignore_errors=True)
    return path, e

