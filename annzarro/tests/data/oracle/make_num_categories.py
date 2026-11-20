"""Oracle: ``pandas.cut`` equal-width bins, the reference for the ``num_categories`` option (SHR binning).

Consumers: E1/E2 binning tests and E5. Writes ``num_categories.npz``.

Pinned versions (must match VERSIONS.json; the script refuses to run otherwise):
    scanpy 1.12.6, anndata 0.13.4, scipy 1.18.1, numpy 2.5.5, pandas 3.1.1

Run ONLY in the throwaway venv: ``<venv>/bin/python make_num_categories.py``.

Inputs: fixture obs columns ``score`` (continuous), ``signed`` (both signs), ``depth`` (60% exact zeros),
``pseudotime`` (25 distinct values k/24, 20 NaN: values sit exactly ON equal-width edges for n = 2, 3, 4, 6, 8,
12, 24) and ``batch`` is not binned. For every n in 2..12 and each column: the edges ``pandas.cut`` returns
(``retbins``) and the codes (-1 for NaN). AnnZarro's bins are [lo, hi); pandas.cut's are (a, b], so the two differ
exactly for values on an inner edge. ``halfopen`` holds the AnnZarro-convention codes derived from the SAME edges,
with the lowest edge as pandas.cut returns it (already pushed down by 0.1% of the range) and the highest bin
closed on the right so the maximum is kept: ``codes = min(searchsorted(edges, v, side='right') - 1, n - 1)``.
"""
import os
import sys

import numpy as np

PINS = {"scanpy": "1.12.6", "anndata": "0.13.4", "scipy": "1.18.1", "numpy": "2.5.5", "pandas": "3.1.1"}
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

_common.check_versions(PINS)
import pandas as pd  # noqa: E402

COLUMNS = ["score", "signed", "depth", "pseudotime"]
NS = list(range(2, 13))


def main(out):
    data, _, _ = _common.load_fixture()
    res = {"ns": np.array(NS), "columns": np.array(COLUMNS)}
    for col in COLUMNS:
        v = data.obs[col].to_numpy(np.float64)
        res[f"values__{col}"] = v
        for n in NS:
            cut, edges = pd.cut(pd.Series(v), bins=n, retbins=True)
            codes = cut.cat.codes.to_numpy(np.int8)
            half = np.where(np.isnan(v), -1, np.minimum(np.searchsorted(edges, np.nan_to_num(v), side="right") - 1, n - 1))
            half = np.where(np.isnan(v), -1, half).astype(np.int8)
            res[f"edges__{col}__{n}"] = np.asarray(edges, dtype=np.float64)
            res[f"codes__{col}__{n}"] = codes
            res[f"halfopen__{col}__{n}"] = half
    res["fixture_digest"] = np.array(_common.fixture_digest(data))
    np.savez_compressed(out, **res)
    print(out, len(res), "arrays")


if __name__ == "__main__":
    main(os.path.join(os.path.dirname(os.path.abspath(__file__)), "num_categories.npz"))
