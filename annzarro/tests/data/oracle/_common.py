"""Shared helpers of the oracle maker scripts (R2). Not a test module; runs only in the throwaway oracle venv.

``load_fixture()`` rebuilds F0's grouping fixture (``tests/core/grouping_store.py``) WITHOUT importing the
annzarro package (the throwaway venv has no flask or zarr): it executes only the data-making part of that file
(constants, ``gene``, ``cell``, ``sample_names``, ``GroupingData``, ``make_data``, ``GENE_SETS``) from its source.
``fixture_digest()`` hashes the numbers, so a test in the repo venv can tell when the fixture moved under an oracle.
"""
import ast
import hashlib
import importlib.metadata as md
import os
import sys
from functools import lru_cache

HERE = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(os.path.dirname(HERE), "..", "core", "grouping_store.py")
_NAMES = {"N_OBS", "N_VAR", "CELL_TYPES", "CONDITIONS", "N_SAMPLES", "OTHER_SAMPLE", "N_MANY", "gene", "cell",
          "GroupingData", "sample_names", "make_data", "GENE_SETS"}
PACKAGES = ("scanpy", "anndata", "scipy", "numpy", "pandas")


def check_versions(pins):
    """Refuse to run unless every pinned package is installed at exactly its pinned version."""
    bad = {}
    for pkg in PACKAGES:
        have = md.version(pkg)
        if pins.get(pkg) != have:
            bad[pkg] = (pins.get(pkg), have)
    if bad:
        sys.exit("refusing to run, version mismatch (pinned, installed): %r\n"
                 "Run this script only in the throwaway oracle venv (see README.md)." % bad)


@lru_cache(maxsize=1)
def _namespace():
    import numpy as np
    import pandas as pd
    import scipy.sparse as sp
    with open(STORE, encoding="utf-8") as f:
        tree = ast.parse(f.read())
    keep = []
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in _NAMES:
            keep.append(node)
        elif isinstance(node, ast.Assign):
            targets = [e for t in node.targets for e in (t.elts if isinstance(t, ast.Tuple) else [t])]
            if any(isinstance(t, ast.Name) and t.id in _NAMES for t in targets):
                keep.append(node)
    ns = {"np": np, "pd": pd, "sp": sp, "__name__": "grouping_store_extract"}
    exec("from functools import lru_cache", ns)
    exec(compile(ast.Module(body=keep, type_ignores=[]), STORE, "exec"), ns)
    return ns


def load_fixture():
    """Returns (GroupingData, GENE_SETS, gene-name list)."""
    ns = _namespace()
    data = ns["make_data"]()
    return data, ns["GENE_SETS"], [ns["gene"](i) for i in range(ns["N_VAR"])]


def fixture_digest(data):
    import numpy as np
    h = hashlib.sha256()
    for a in (data.x, data.logged, data.counts):
        h.update(np.ascontiguousarray(a, dtype=np.float32).tobytes())
    for col in ("pseudotime", "depth", "signed", "score"):
        # to 6 decimals: numpy's gamma draw (`depth`) differs in its last bit between an ARM build (fused multiply-add) and an
        # x86 one, and a digest of the raw bits would then differ between a Mac and a CI runner (found on CI, 0.8.0)
        h.update(np.ascontiguousarray(np.round(data.obs[col].to_numpy(np.float64), 6)).tobytes())
    for col in ("cell_type", "condition"):
        h.update(np.ascontiguousarray(data.obs[col].cat.codes.to_numpy(np.int16)).tobytes())
    return h.hexdigest()


def numeric_bins(values, n):
    """pandas.cut equal-width bins as scanpy/pandas users get them: (edges, codes), codes -1 for NaN."""
    import pandas as pd
    cut, edges = pd.cut(pd.Series(values), bins=n, retbins=True)
    import numpy as np
    return np.asarray(edges, dtype=np.float64), cut.cat.codes.to_numpy(np.int8)
