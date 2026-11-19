"""Small stores of every layout a gene score reads, and the dense reference they are checked against.

The store is ``fixture_small.zarr`` (200 cells, genes ``GENE000``...) with its X replaced by a given
dense matrix, written as csc, csr or dense, as zarr or (through ``h5ad_twin``) as .h5ad. ``counts``
is added as a layer, so the layer input is read the same way as X.
"""
import os
import shutil

import numpy as np
import scipy.sparse as sp
import zarr

from annzarro.tests import zarr_compat
from annzarro.tests.core.h5ad_twin import h5ad_twin

FIXTURE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fixture_small.zarr")
N_OBS, N_VAR = 200, 20
LAYOUTS = ("csc", "csr", "dense")
BACKENDS = ("zarr", "h5ad")


def gene(i):
    return f"GENE{i:03d}"


def make_matrix(seed=3):
    """200 x 20: gene 0 common, 1 rare with one huge value (clipped), 2 constant non-zero, 3 all zero,
    4 has NaNs, 5 all NaN, 6 a rare gene, 7 with +inf in one cell; the rest are random."""
    rng = np.random.default_rng(seed)
    x = rng.gamma(2.0, 1.0, (N_OBS, N_VAR)) * (rng.random((N_OBS, N_VAR)) < 0.3)
    x[:, 0] = rng.gamma(2.0, 1.0, N_OBS) * (rng.random(N_OBS) < 0.8)
    x[:, 1] = 0
    x[17, 1] = 100.0
    x[:, 2] = 3.0
    x[:, 3] = 0.0
    x[:, 4] = np.where(rng.random(N_OBS) < 0.5, rng.gamma(2.0, 1.0, N_OBS), 0.0)
    x[[5, 40, 41, 150], 4] = np.nan
    x[:, 5] = np.nan
    x[:, 6] = 0
    x[[3, 90], 6] = [4.0, 8.0]
    x[60, 7] = np.inf
    return x.astype(np.float32)


def _write_matrix(group, name, x, layout, chunks=64):
    """``x`` (dense) stored under ``group[name]`` as ``layout``."""
    if layout == "dense":
        arr = zarr_compat.write_array(group, name, x, chunks=(chunks, x.shape[1]))
        arr.attrs["encoding-type"] = "array"
        arr.attrs["encoding-version"] = "0.2.0"
        return
    m = sp.csc_matrix(x) if layout == "csc" else sp.csr_matrix(x)
    g = group.create_group(name)
    g.attrs["encoding-type"] = f"{layout}_matrix"
    g.attrs["encoding-version"] = "0.1.0"
    g.attrs["shape"] = list(x.shape)
    for part in ("data", "indices", "indptr"):
        arr = np.asarray(getattr(m, part))
        zarr_compat.write_array(g, part, arr, chunks=(max(1, min(len(arr), chunks)),))


def make_store(path, x, layout="csc", backend="zarr", var_names=None, layer=None, layer_layout=None):
    """Write the store at ``path`` (a .zarr or .h5ad path) and return it.

    ``layer`` (a dense matrix) is added as the layer ``counts``, stored as ``layer_layout`` (default
    ``layout``). ``var_names`` replaces the gene names (to repeat one).
    """
    path = str(path)
    zpath = path if backend == "zarr" else path + ".src.zarr"
    shutil.rmtree(zpath, ignore_errors=True)
    shutil.copytree(FIXTURE, zpath)
    root = zarr_compat.open_group(zpath, mode="r+")
    del root["X"]
    _write_matrix(root, "X", x, layout)
    if "counts" in root["layers"]:
        del root["layers"]["counts"]
    if layer is not None:
        _write_matrix(root["layers"], "counts", layer, layer_layout or layout)
    if var_names is not None:
        del root["var"]["_index"]
        zarr_compat.write_strings(root["var"], "_index", list(var_names))
    zarr_compat.consolidate(zpath)
    if backend == "zarr":
        return path
    h5ad_twin(zpath, path)
    shutil.rmtree(zpath, ignore_errors=True)
    return path


def reference(x, genes, method="zscore_mean", clip=10.0):
    """The score by its definition, on the dense matrix, in float64: ``(values, used_columns)``.

    Non-finite values are missing; a cell's score averages the genes it has a value for; the
    z-score mean leaves out a gene with no spread.
    """
    x = np.asarray(x, dtype=np.float64)
    total = np.zeros(x.shape[0])
    count = np.zeros(x.shape[0])
    used = []
    for j in genes:
        col = x[:, j]
        ok = np.isfinite(col)
        if not ok.any():
            continue
        if method == "zscore_mean":
            sd = col[ok].std()
            if col[ok].min() == col[ok].max():
                continue
            t = (col - col[ok].mean()) / sd
            if clip is not None:
                t = np.clip(t, -clip, clip)
        else:
            t = col
        total += np.where(ok, t, 0.0)
        count += ok
        used.append(j)
    with np.errstate(invalid="ignore", divide="ignore"):
        out = np.where(count > 0, total / np.maximum(count, 1), np.nan)
    return out, used
