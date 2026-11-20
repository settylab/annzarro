"""Oracle: scanpy ``DotPlot`` (dot_color_df, dot_size_df) and ``MatrixPlot`` (values_df) on F0's grouping fixture.

Consumers: E5 (server group features), X2a (cell-gene model). Writes ``dotplot_matrixplot.npz``.

Pinned versions (must match VERSIONS.json; the script refuses to run otherwise):
    scanpy 1.12.6, anndata 0.13.4, scipy 1.18.1, numpy 2.5.5, pandas 3.1.1

Run ONLY in the throwaway venv (never the repo venv):
    <venv>/bin/python make_dotplot_matrixplot.py            # from this folder; writes next to the script

Inputs: genes ``GENE_SETS['b_markers']`` (GENE000..GENE011, includes GENE003 that nobody expresses); layers
``X`` (scaled, signed), ``logged`` and ``counts``; groupbys ``cell_type`` (6 levels, one of 5 cells),
``condition`` (2), ``score_bin`` = ``pandas.cut(score, 4)`` codes as categories ``bin0``..``bin3``, and
``tiny`` (cells 0-1 = ``tiny0``, cells 2-4 = ``tiny1``, the rest ``rest``) which gives groups of 2 and 3 cells, so
some non-constant gene has no expressing cell in a group (P3: scanpy writes 0).
The matrices are handed to scanpy as float64 (the fixture's float32 values, widened exactly), so scanpy's own
float32 accumulation does not enter and parity at 1e-9 relative is meaningful.
"""
import os
import sys
import warnings

import numpy as np

PINS = {"scanpy": "1.12.6", "anndata": "0.13.4", "scipy": "1.18.1", "numpy": "2.5.5", "pandas": "3.1.1"}
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common  # noqa: E402

_common.check_versions(PINS)
import anndata as ad  # noqa: E402
import pandas as pd  # noqa: E402
import scanpy as sc  # noqa: E402

warnings.filterwarnings("ignore")
LAYERS = ["X", "logged", "counts"]
GROUPBYS = ["cell_type", "condition", "score_bin", "tiny"]
CUTOFFS = [0.0, 0.5]
SCALES = [None, "var", "group"]


def tag(v):
    return "none" if v is None else str(v)


def main(out):
    data, gene_sets, names = _common.load_fixture()
    genes = list(gene_sets["b_markers"])
    obs = data.obs.copy()
    edges, codes = _common.numeric_bins(obs["score"].to_numpy(), 4)
    obs["score_bin"] = pd.Categorical([f"bin{c}" for c in codes], categories=[f"bin{i}" for i in range(4)])
    tiny = np.where(np.arange(len(obs)) < 2, "tiny0", np.where(np.arange(len(obs)) < 5, "tiny1", "rest"))
    obs["tiny"] = pd.Categorical(tiny, categories=["tiny0", "tiny1", "rest"])
    adata = ad.AnnData(X=data.x.astype(np.float64), obs=obs, var=pd.DataFrame(index=names))
    adata.layers["logged"] = data.logged.astype(np.float64)
    adata.layers["counts"] = data.counts.astype(np.float64)
    res = {"genes": np.array(genes), "score_bin_edges": edges, "score_bin_codes": codes}
    for g in GROUPBYS:
        res[f"groups__{g}"] = np.array(list(adata.obs[g].cat.categories))
        res[f"n_cells__{g}"] = adata.obs[g].value_counts(sort=False).to_numpy(np.int64)
    for layer in LAYERS:
        lay = None if layer == "X" else layer
        for g in GROUPBYS:
            for ss in SCALES:
                mp = sc.pl.MatrixPlot(adata, genes, g, layer=lay, standard_scale=ss)
                res[f"matrix__{layer}__{g}__ss{tag(ss)}"] = mp.values_df.to_numpy(np.float64)
                for cut in CUTOFFS:
                    for mo in (False, True):
                        dp = sc.pl.DotPlot(adata, genes, g, layer=lay, expression_cutoff=cut,
                                           mean_only_expressed=mo, standard_scale=ss)
                        k = f"dot__{layer}__{g}__cut{cut}__mo{int(mo)}__ss{tag(ss)}"
                        assert list(dp.dot_color_df.index) == list(res[f"groups__{g}"])
                        assert list(dp.dot_color_df.columns) == genes
                        res[k + "__color"] = dp.dot_color_df.to_numpy(np.float64)
                        res[k + "__size"] = dp.dot_size_df.to_numpy(np.float64)
    res["fixture_digest"] = np.array(_common.fixture_digest(data))
    np.savez_compressed(out, **res)
    print(out, len(res), "arrays")


if __name__ == "__main__":
    main(os.path.join(os.path.dirname(os.path.abspath(__file__)), "dotplot_matrixplot.npz"))
