#!/usr/bin/env python
"""Generate the tiny AnnData->zarr fixture used by the deep-link smoke tests.

The fixture is committed under ``annzarro/tests/data/fixture_small.zarr`` so the
test suite is self-contained: the server test env (``.venv-pilot``) does NOT have
``anndata`` installed, so the store must be produced ahead of time and read back
with the bare ``ZarrReader`` (which only needs ``zarr``/``numpy``/``scipy``).

It mirrors the production encoding (anndata ``write_zarr``, zarr v2, CSC ``X`` so
gene-wise column slicing reads one contiguous column) at toy scale, so it
exercises the same code paths the DoLiMap deep-link hits without shipping a real
dataset. Regenerate with an env that has anndata, e.g.::

    /fh/fast/setty_m/user/dotto/nexus/work/annzarro/.venv-convert/bin/python \
        annzarro/tests/utils/make_fixture_zarr.py

Deterministic: a fixed RNG seed keeps the bytes stable across regenerations.
"""
import os
import shutil
import sys

import numpy as np
import pandas as pd
import scipy.sparse as sp
import anndata as ad

# Toy but non-degenerate: enough cells to exercise category encoding and a
# real numeric obs column, small enough that the committed store stays tiny.
N_OBS = 200
N_VAR = 20
SEED = 0


def build():
    rng = np.random.default_rng(SEED)
    # Sparse, CSC-encoded expression (matches convert_to_zarr.py) so a single
    # gene column is contiguous on disk.
    X = sp.random(N_OBS, N_VAR, density=0.3, format="csc", random_state=SEED)
    X.data = np.round(X.data * 10, 3)

    obs = pd.DataFrame(
        {
            # categorical -> anndata writes encoding-type "categorical"
            "cell_type": pd.Categorical(
                rng.choice(["Hepatocyte", "Kupffer", "Endothelial"], size=N_OBS)
            ),
            # numeric continuous column -> the kind a deep-link colors a plot by
            "total_counts": rng.uniform(100.0, 10000.0, size=N_OBS).astype("float64"),
            "leiden": pd.Categorical(rng.integers(0, 5, size=N_OBS).astype(str)),
        },
        index=[f"cell_{i:04d}" for i in range(N_OBS)],
    )
    var = pd.DataFrame(
        {"gene_name": [f"GENE{i:03d}" for i in range(N_VAR)]},
        index=[f"GENE{i:03d}" for i in range(N_VAR)],
    )

    adata = ad.AnnData(X=X, obs=obs, var=var)
    # A 2-D embedding so the obsm deep-link path has something to read.
    adata.obsm["X_umap"] = rng.normal(size=(N_OBS, 2)).astype("float32")
    return adata


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    dst = os.path.join(os.path.dirname(here), "data", "fixture_small.zarr")
    if os.path.exists(dst):
        shutil.rmtree(dst)
    adata = build()
    # chunks on the 1-D sparse arrays, matching the production writer.
    adata.write_zarr(dst, chunks=(1 << 16,))
    print(f"wrote {dst}  shape={adata.shape}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
