# Oracle files (R2)

Reference values from scanpy and scipy at pinned versions, stored as test data. They are never a runtime or a
test-time dependency: the tests read the `.npz` files with numpy only. Parity means within 1e-9 relative, except the
KDE (2% of the peak). Pins are in `VERSIONS.json` and in each script's docstring; `tests/core/test_oracle_files.py`
checks that the two agree, that the shapes are as documented here, and that the fixture has not moved
(`fixture_digest`).

Pinned: scanpy 1.12.6, anndata 0.13.4, scipy 1.18.1, numpy 2.5.5, pandas 3.1.1 (Python 3.12).

## Regenerate

In a throwaway venv, never the repo venv:

    python3.12 -m venv /tmp/r2-oracle-venv
    /tmp/r2-oracle-venv/bin/pip install scanpy==1.12.6 anndata==0.13.4 scipy==1.18.1 numpy==2.5.5 pandas==3.1.1
    cd annzarro/tests/data/oracle && for m in make_*.py; do /tmp/r2-oracle-venv/bin/python $m; done

Each script refuses to run when the installed versions differ from its pins. `_common.py` rebuilds F0's fixture
(`tests/core/grouping_store.py`, `make_data()`) from that file's source without importing annzarro. When the fixture
changes, `test_fixture_has_not_moved` fails: regenerate, then update `fixture_digest` in `VERSIONS.json`.

## Files

All inputs come from F0's fixture: 1,200 cells x 40 genes (`GENE000`..`GENE039`), layers `X` (scaled, signed),
`logged` (log1p, non-negative), `counts` (integers). The matrices are widened to float64 before scanpy sees them
(scanpy's float32 accumulation would otherwise differ from an exact mean by about 1e-7).

### `dotplot_matrixplot.npz` (E5, X2a), from `make_dotplot_matrixplot.py`

Gene set `b_markers` = `GENE000`..`GENE011` (key `genes`; `GENE003` is expressed by nobody). Layers `X`, `logged`,
`counts`. Groupbys (all `(n_groups, 12)` arrays, rows in the order of `groups__<groupby>`, counts in
`n_cells__<groupby>`):

| groupby | groups |
|---|---|
| `cell_type` | 6 (500, 300, 200, 150, 45, 5 cells) |
| `condition` | 2 |
| `score_bin` | 4: `pandas.cut(score, 4)` codes as `bin0`..`bin3` (`score_bin_edges`, `score_bin_codes` stored) |
| `tiny` | 3: cells 0-1 `tiny0`, cells 2-4 `tiny1`, the rest `rest` (groups of 2 and 3 cells have genes nobody in them expresses) |

Keys: `dot__<layer>__<groupby>__cut<0.0|0.5>__mo<0|1>__ss<none|var|group>__color` and `...__size`
(`dot_color_df`, `dot_size_df`; `cut` = `expression_cutoff`, `mo` = `mean_only_expressed`, `ss` = `standard_scale`),
and `matrix__<layer>__<groupby>__ss<none|var|group>` (`MatrixPlot.values_df`). The file holds 4 x 3 x 3 x 2 x 2 = 144 combinations, so 288 colour and size arrays
(144 of each), and 36 matrices. No value is NaN: scanpy writes 0
for a constant gene under `var` scaling and for a group without an expressing cell.

### `num_categories.npz` (binning), from `make_num_categories.py`

For `score`, `signed`, `depth`, `pseudotime` and n = 2..12: `values__<col>`, `edges__<col>__<n>` (n+1 edges as
`pandas.cut(retbins=True)` returns them), `codes__<col>__<n>` (pandas codes, -1 for NaN) and `halfopen__<col>__<n>`
(AnnZarro convention from the same edges, see below). `pseudotime` has values exactly on inner edges (k/24).

### `linkage.npz` (X1), from `make_linkage.py`

Rows clustered, input stored as `<case>__X`: `means_ct` (6 groups x 12 genes), `genes_ct` (11 genes x 6 groups),
`cells40` (40 cells x 39 genes, layer `X`, `GENE003` dropped), `rand40` (40 x 15 seeded normal, seed in
`rand40__seed`). Condensed distances `<case>__dist_<correlation|euclidean>` (1 - Pearson r, Euclidean). Linkage
`<case>__Z_<dist>_<method>` (scipy's (n-1, 4) matrix) and leaf order `<case>__leaves_<dist>_<method>` for
correlation x complete, correlation x average, euclidean x complete, euclidean x average, euclidean x ward. There
is deliberately no correlation x ward (CXG-21). The script asserts every pairwise distance differs from its
neighbour by more than 3e-7 relative, so no tie and no float32 rounding can reorder merges. Ties are not oracled
here: X1 breaks them by original order, which scipy does not promise.

### `kde.npz` (V3), from `make_kde.py`

Diagonal-bandwidth Gaussian KDE by direct summation, `h = adjust * sd * n^(-1/(d+4))` (Scott per dimension, sample
SD with ddof=1), range 0.1-99.9th percentile padded by 3h, density at grid-cell centres, summed over the cells in
range and divided by their count. `density_floor` uses `max(h, 1.5 * step)`. 1D (512 bins): `score`, `signed`,
`depth`, `pseudotime`. 2D (64 x 64, float32, x first): `umap`, `corr` (`GENE000` x `GENE006`, positively
correlated), `score_depth`. Adjust 0.5, 1, 2 as `a0.5`, `a1`, `a2`. Keys `<case>__<a>__<name>`, names listed in
the script's docstring. The full docstring is the key reference.

## Intended differences from scanpy and scipy

Each has its own consumer test:

1. **Bins are [lo, hi), `pandas.cut` is (a, b].** A value on an inner edge falls in the upper bin in AnnZarro and
   the lower in pandas. `halfopen__*` is the AnnZarro convention on pandas' edges (highest bin closed, so the
   maximum is kept); it differs from `codes__*` only for values on an inner edge (`pseudotime`). pandas also pushes
   the lowest edge down by 0.1% of the range; the oracle keeps its edges as returned, so an engine that does not
   do that compares edge values only after the same adjustment, or compares counts per bin.
2. **Clustering runs on the displayed values**, not scanpy's group means of `X_pca`. The oracle clusters
   explicit matrices with scipy, which is the part that must match (distance, linkage, leaf order).
3. **P3: a group with no expressing cell gets 0**, as scanpy writes it (`tiny` groups, and `GENE003` everywhere),
   under `mean_only_expressed` and in `dot_size_df`. AnnZarro matches that number and adds a hover note
   ("no expressing cells") so the 0 is not read as a measured mean. The implementation plan's open-questions table
   still says "no value"; operator decision P3 says 0, which is what this oracle records.
4. **Constant gene under `standard_scale`**: scanpy gives 0 for the constant row, as does X2a (it did not give
   NaN in this version). `GENE003` is the case.
5. **Density** is not `scipy.stats.gaussian_kde` (full covariance); `corr` is where they would differ.
