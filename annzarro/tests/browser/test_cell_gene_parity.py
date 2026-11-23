"""Parity with scanpy from a link (X6; SHR-43, CXG-9, CXG-10, CXG-20, CXG-21 to CXG-26, requirements 5.3).

A link carries a Cell-Gene Plot; the CSV it exports in the browser (Download CSV, the real button) is held against R2's
oracle, ``tests/data/oracle/dotplot_matrixplot.npz`` (scanpy 1.12.6 ``DotPlot.dot_color_df`` and ``dot_size_df``,
``MatrixPlot.values_df``), within 1e-9 relative. The store is the oracle's own input, F0's grouping fixture
(tests/core/grouping_store.py): 1,200 cells, the gene set ``b_markers`` = GENE000..GENE011 (GENE003 expressed by no
cell), layers X (signed), ``logged`` and ``counts``.

Parity: for every layer, the groupbys ``cell_type``, ``condition`` and ``score_bin`` (four equal-width bins of
``score``), ``expression_cutoff`` 0 and 0.5, ``mean_only_expressed`` off and on, and ``standard_scale`` none, ``var``
and ``group``; in dot mode (colour and size) and in heatmap mode (``matrixplot``). The cell axis is a grouping that
offers the statistics and layers asked, as a user would build it.

The oracle's ``tiny`` groupby (groups of cells 0-1 and 2-4) is not a recipe a grouping can express; the P3 zero it
covers is shown here by GENE003, which no cell expresses.

How a statistic maps (the CSV's columns):
- ``dot_color_df`` with ``mean_only_expressed`` off: Color ``mean`` (no threshold; scanpy's cutoff does not enter).
- ``dot_color_df`` with ``mean_only_expressed`` on: Color ``mean_expressing`` with ``detect_above`` = the cutoff.
- ``dot_size_df``: Size ``pct_expressing`` with ``detect_above`` = the cutoff. AnnZarro writes a percentage (0 to 100),
  scanpy a fraction: the CSV's value is 100 times scanpy's.
- ``standard_scale``: Scale ``var`` or ``group``; the CSV has the Color column as computed and as displayed.

Each intended difference of 5.3 (and of the statistics behind it) has its own test below, which shows the difference
and says why:
1.  ``num_categories``: AnnZarro's equal-width bins are [lo, hi), pandas' are (a, b].
2.  ``use_raw``: ``.raw`` is never offered as a layer; the figure matches scanpy only on the same matrix.
3.  ``mean_only_expressed``: a group with no expressing cell is 0, as scanpy writes it, and the CSV says so.
4.  ``standard_scale``: a constant gene gives 0, as in scanpy (and two z-score scalings scanpy does not have).
5.  ``dendrogram``: same method as ``sc.tl.dendrogram`` (complete, Pearson), on the displayed values, not on group
    means of ``X_pca`` (CXG-26), and the panel says so.
6.  ``dot_size_df``: % expressing (0 to 100), not a fraction (in every parity case above).
7.  A layer with negative values: % expressing and mean of expressing cells are not read on it (OD 8, SHR-27), where
    scanpy computes them.

Needs Playwright with Chromium; skipped otherwise, unless ANNZARRO_REQUIRE_BROWSER=1.
"""
import csv
import io
import json
import os

import numpy as np
import pytest

if os.environ.get("ANNZARRO_REQUIRE_BROWSER") == "1":
    import playwright.sync_api as playwright  # noqa: E402
else:
    playwright = pytest.importorskip("playwright.sync_api")

from annzarro.tests import zarr_compat  # noqa: E402
from annzarro.tests.browser import test_cell_gene_panel as _panel  # noqa: E402
from annzarro.tests.browser import test_focus_outside_subset as _focus  # noqa: E402
from annzarro.tests.browser.test_cell_gene_panel import (  # noqa: E402,F401 (the page fixture)
    page, _open, _plot, _sig, _drawn, P, TP, S1, GA, GENES)
from annzarro.tests.browser.test_memory_guard import until  # noqa: E402
from annzarro.tests.browser.test_names_dataset_scope import _serve  # noqa: E402
from annzarro.tests.rich_info_store import _frame  # noqa: E402

ORACLE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "oracle")
DOT = np.load(os.path.join(ORACLE, "dotplot_matrixplot.npz"), allow_pickle=False)
BINS = np.load(os.path.join(ORACLE, "num_categories.npz"), allow_pickle=False)
LINK = np.load(os.path.join(ORACLE, "linkage.npz"), allow_pickle=False)
B = [str(g) for g in DOT["genes"]]
assert B == GENES[:12]
REL = 1e-9
STATS = ["mean", "pct_expressing", "mean_expressing"]
LAYERS = ["X", "logged", "counts"]
LABEL = {"mean": "Mean", "pct_expressing": "% expressing", "mean_expressing": "Mean of expressing cells"}
SCALED = {"none": "not scaled", "var": "scaled 0 to 1 per gene", "group": "scaled 0 to 1 per group",
          "z_groups": "z-score per gene, across groups", "z_pooled": "z-score per gene, against all grouped cells"}
NOTE = "no expressing cells"


# ------------------------------------------------------------------ the store, with a .raw

def _make_store(path):
    """The oracle's store, plus a ``.raw`` (a copy of ``counts``) so that use_raw has something to leave out."""
    _panel._make_store(path)
    root = zarr_compat.open_group(str(path), mode="r+")
    if "raw" in root:
        del root["raw"]                   # the null placeholder anndata writes for raw=None
    raw = root.require_group("raw")
    raw.attrs.update({"encoding-type": "raw", "encoding-version": "0.1.0"})
    zarr_compat.write_array(raw, "X", _panel.DATA.counts.astype("float32"))
    _frame(raw, "var", ["gene_name"], rows=len(GENES))
    zarr_compat.consolidate(str(path))
    return str(path)


@pytest.fixture(scope="module")
def served(tmp_path_factory):
    original = _focus._make_store
    _focus._make_store = _make_store
    try:
        proc, root, store = _serve(tmp_path_factory)
    finally:
        _focus._make_store = original
    yield root, store
    proc.terminate()
    proc.wait(10)


# ------------------------------------------------------------------ helpers

def _grouping(groupby):
    """A grouping of one factor that offers what the oracle has, as a user would set it up."""
    if groupby == "score_bin":
        part = {"source": {"type": "obs", "key": "score"}, "binning": {"method": "equal_width", "bins": 4}}
    else:
        part = {"source": {"type": "obs", "key": groupby}}
    return {"id": GA, "title": "Grouping 1", "version": 1, "partitionings": [part], "offered": STATS, "layers": LAYERS}


def _link(page, served, plot, grouping, genes=B):
    _open(page, served, {P: _plot(cellAxis={"type": "cell-group", "key": GA}, sections=[{"source": S1, "rows": "genes"}], **plot),
                         S1: _sig(S1, "B markers", genes), GA: grouping}, open_ids=(P, S1))
    _drawn(page)


def _csv(page):
    """Download CSV, the button in Plot Options ▸ Export: the header and the rows, as text."""
    if page.locator("[data-popover='plot-options']").count() == 0:
        page.click(f"{TP} .cgene-options-btn")
    with page.expect_download() as got:
        page.click("[data-popover='plot-options'] .cgene-csv-btn")
    with open(got.value.path(), encoding="utf-8") as f:
        rows = list(csv.reader(io.StringIO(f.read())))
    return rows[0], rows[1:]


def _rescale(page, scaling):
    """Change Scale in the panel (no request), and wait until the drawing is of it."""
    page.select_option(f"{TP} .cgene-scale", scaling)
    until(page, "([s, t]) => { const p = document.querySelector(s + ' .cgene-plot');"
                " return !!p && !!p.data && JSON.stringify(p.data).includes(t); }", [TP, SCALED[scaling]])


def _column(head, body, title, groups):
    """One CSV column as a (12 genes x groups) array in the oracle's layout (groups x genes), NaN for an empty field."""
    j = head.index(title)
    out = np.full((len(groups), len(B)), np.nan)
    for row in body:
        gi, ri = groups.index(row[2]), B.index(row[1])
        out[gi, ri] = float(row[j]) if row[j] != "" else np.nan
    return out


def _group_labels(body, groupby):
    """The CSV's group labels in the oracle's order, checked against the oracle's cell counts."""
    first = [r for r in body if r[1] == B[0]]
    labels = [r[2] for r in first]
    cells = [int(r[3]) for r in first]
    want = [str(g) for g in DOT[f"groups__{groupby}"]]
    if groupby == "score_bin":
        assert len(labels) == len(want), labels            # equal-width bins, in their order
    else:
        assert sorted(labels) == sorted(want), labels
        order = [labels.index(w) for w in want]
        labels, cells = [labels[k] for k in order], [cells[k] for k in order]
    assert cells == DOT[f"n_cells__{groupby}"].tolist(), "the groups are the oracle's groups"
    return labels


def _assert_close(got, want, what):
    """Within 1e-9 relative; an oracle 0 is 0 exactly. Never widened: a miss names the worst cell."""
    assert got.shape == want.shape, what
    assert not np.isnan(got).any(), f"{what}: a value is missing where scanpy has one"
    err = np.abs(got - want)
    bad = err > REL * np.abs(want)
    if bad.any():
        k = np.unravel_index(np.argmax(np.where(bad, err / np.maximum(np.abs(want), 1e-300), 0)), got.shape)
        raise AssertionError(f"{what}: {int(bad.sum())} of {got.size} values off; worst at group {k[0]}, {B[k[1]]}: "
                             f"{got[k]!r} vs scanpy {want[k]!r} (relative {err[k] / max(abs(want[k]), 1e-300):.3g})")


def _key(layer, groupby, cut, mo, ss):
    return f"dot__{layer}__{groupby}__cut{cut}__mo{mo}__ss{ss}"


# ------------------------------------------------------------------ parity: dot mode

DOT_CASES = [(layer, groupby, cut, mo) for layer in ("logged", "counts") for groupby in ("cell_type", "condition", "score_bin")
             for cut in (0.0, 0.5) for mo in (0, 1)]
DOT_CASES += [("X", groupby, 0.0, 0) for groupby in ("cell_type", "condition", "score_bin")]


@pytest.mark.parametrize("layer, groupby, cut, mo", DOT_CASES, ids=[f"{a}-{b}-cut{c}-mo{d}" for a, b, c, d in DOT_CASES])
def test_the_csv_of_a_link_equals_scanpy_dotplot(page, served, layer, groupby, cut, mo):
    stat = "mean_expressing" if mo else "mean"
    color = {"stat": stat, "layer": layer, **({"detect_above": cut} if mo else {})}
    # on X (negative values) Size cannot be % expressing (difference 7); it is drawn on one size and the CSV has none
    size = {"stat": "pct_expressing", "layer": layer, "detect_above": cut}
    _link(page, served, {"color": color, "size": size, "scale": "var"}, _grouping(groupby))
    for ss in ("var", "group"):
        if ss != "var":
            _rescale(page, ss)
        head, body = _csv(page)
        assert len(body) == len(B) * len(DOT[f"groups__{groupby}"])
        groups = _group_labels(body, groupby)
        key = _key(layer, groupby, cut, mo, ss)
        title = f"{LABEL[stat]} · {layer} · "
        _assert_close(_column(head, body, title + SCALED["none"], groups), DOT[_key(layer, groupby, cut, mo, "none") + "__color"],
                      f"dot_color_df, {key}, as computed")
        _assert_close(_column(head, body, title + SCALED[ss], groups), DOT[key + "__color"], f"dot_color_df, {key}, as displayed")
        size_title = f"{LABEL['pct_expressing']} · {layer} · {SCALED['none']}"
        if layer == "X":
            assert size_title not in head, "no % expressing on a layer with negative values"
            continue
        # scanpy's size is a fraction; AnnZarro's % expressing is a percentage (difference 6)
        _assert_close(_column(head, body, size_title, groups) / 100, DOT[key + "__size"], f"dot_size_df, {key}")


# ------------------------------------------------------------------ parity: heatmap mode (matrixplot)

@pytest.mark.parametrize("layer", LAYERS)
@pytest.mark.parametrize("groupby", ["cell_type", "score_bin"])
def test_the_csv_of_a_heatmap_link_equals_scanpy_matrixplot(page, served, layer, groupby):
    _link(page, served, {"mode": "heatmap", "color": {"stat": "mean", "layer": layer}, "scale": "var"}, _grouping(groupby))
    for ss in ("var", "group"):
        if ss != "var":
            _rescale(page, ss)
        head, body = _csv(page)
        groups = _group_labels(body, groupby)
        title = f"{LABEL['mean']} · {layer} · "
        _assert_close(_column(head, body, title + SCALED["none"], groups), DOT[f"matrix__{layer}__{groupby}__ssnone"],
                      f"matrixplot {layer} {groupby} none")
        _assert_close(_column(head, body, title + SCALED[ss], groups), DOT[f"matrix__{layer}__{groupby}__ss{ss}"],
                      f"matrixplot {layer} {groupby} {ss}")
        assert not any(h.startswith(LABEL["pct_expressing"]) for h in head), "a heatmap has no size"


# ------------------------------------------------------------------ 1. num_categories: [lo, hi) against (a, b]

@pytest.mark.parametrize("n", [4, 8])
def test_difference_1_a_value_on_an_inner_edge_falls_in_the_upper_bin_not_the_lower_as_in_pandas(page, served, n):
    """pandas.cut (scanpy's num_categories) closes a bin above, (a, b]; AnnZarro's bins are [lo, hi), the highest
    closed. pseudotime has values exactly on k/24, so on the inner edges of 4 and 8 bins: those cells move up a bin."""
    codes, halfopen = BINS[f"codes__pseudotime__{n}"], BINS[f"halfopen__pseudotime__{n}"]
    pandas_counts = np.bincount(codes[codes >= 0], minlength=n).tolist()
    ours_expected = np.bincount(halfopen[halfopen >= 0], minlength=n).tolist()
    assert pandas_counts != ours_expected, "the case must have values on an inner edge"
    grouping = {"id": GA, "title": "Grouping 1", "version": 1,
                "partitionings": [{"source": {"type": "obs", "key": "pseudotime"}, "binning": {"method": "equal_width", "bins": n}}]}
    _link(page, served, {"color": {"stat": "mean", "layer": "logged"}, "size": {"stat": "pct_expressing", "layer": "logged"}},
          grouping, genes=B[:1])
    head, body = _csv(page)
    cells = [int(r[3]) for r in body]
    assert cells[:n] == ours_expected, (head, [r[2:4] for r in body])
    assert cells[:n] != pandas_counts
    # the cells pandas puts in the lower bin are exactly those on an inner edge
    edges = BINS[f"edges__pseudotime__{n}"]
    values = BINS["values__pseudotime"]
    on_edge = np.isin(values, edges[1:-1])
    assert int((codes != halfopen).sum()) == int(on_edge.sum()) > 0


# ------------------------------------------------------------------ 2. use_raw

def test_difference_2_raw_is_never_offered_as_a_layer(page, served):
    """scanpy reads .raw by default when it exists (use_raw); AnnZarro does not offer .raw in plots, so the figure equals
    scanpy's only when the same matrix is chosen (here, scanpy with use_raw=False and the same layer)."""
    _, store = served
    assert "X" in zarr_compat.open_group(store, mode="r")["raw"], "the dataset has a .raw"
    # even a grouping whose recipe names "raw" does not get it: the dataset's layers are X and its layers
    _link(page, served, {"color": {"stat": "mean", "layer": "logged"}, "size": {"stat": "pct_expressing", "layer": "logged"}},
          {**_grouping("cell_type"), "layers": [*LAYERS, "raw"]})
    for sel in (".cgene-color", ".cgene-size"):
        values = page.locator(f"{TP} {sel}").evaluate("e => [...e.options].map(o => o.value)")
        layers = {v.split("@", 1)[1] for v in values if "@" in v}
        assert layers == set(LAYERS), (sel, values)


# ------------------------------------------------------------------ 3 and 4. no expressing cell; a constant gene

def test_differences_3_and_4_no_expressing_cell_is_0_as_scanpy_and_the_csv_says_so_a_constant_gene_scales_to_0(page, served):
    """mean_only_expressed: scanpy fills a group without an expressing cell with 0 (P3, the operator's decision: the same
    number), and AnnZarro adds the note "no expressing cells" so the 0 is not read as a measured mean. GENE003 is
    expressed by no cell: 0 in every group, noted in every group. Under standard_scale='var' the constant GENE003
    gives 0, as in scanpy, where a division by its range of 0 would give NaN."""
    _link(page, served, {"color": {"stat": "mean_expressing", "layer": "logged", "detect_above": 0.5},
                         "size": {"stat": "pct_expressing", "layer": "logged", "detect_above": 0.5}, "scale": "var"},
          _grouping("cell_type"))
    head, body = _csv(page)
    assert head[-1] == "Note"
    computed = head.index("Mean of expressing cells · logged · not scaled")
    shown = head.index("Mean of expressing cells · logged · scaled 0 to 1 per gene")
    dead = [r for r in body if r[1] == "GENE003"]
    assert len(dead) == 6
    assert all(r[computed] == "0" and r[shown] == "0" and r[-1] == NOTE for r in dead), dead
    want = DOT[_key("logged", "cell_type", 0.5, 1, "none") + "__color"][:, B.index("GENE003")]
    assert (want == 0).all(), "scanpy writes 0 too"
    # a measured mean is never noted
    assert all(r[-1] == "" for r in body if r[1] != "GENE003" and float(r[computed]) > 0)
    # the two scalings scanpy does not have: z-scores of a constant gene are 0 as well, never NaN
    for z in ("z_groups", "z_pooled"):
        _rescale(page, z)
        head, body = _csv(page)
        j = head.index(f"Mean of expressing cells · logged · {SCALED[z]}")
        assert all(r[j] == "0" for r in body if r[1] == "GENE003")


# ------------------------------------------------------------------ 5. dendrogram (CXG-21 to CXG-26)

CLUSTER = {"linkage": "complete", "distance": "correlation"}


def _order(body):
    groups, genes = [], []
    for r in body:
        if r[2] not in groups:
            groups.append(r[2])
        if r[1] not in genes:
            genes.append(r[1])
    return groups, genes


def test_difference_5_clustering_is_scanpys_method_on_the_displayed_values_not_on_x_pca(page, served):
    """sc.tl.dendrogram clusters groups with complete linkage on Pearson correlation of the groups' means of X_pca. The
    panel uses the same linkage and distance (the defaults), on the values as displayed (CXG-26). Held against scipy on
    the displayed matrix (R2's linkage.npz: means of `logged` per cell type, 6 x 12; and its transpose without the
    constant GENE003), the order is scipy's; and it follows the display: another scaling, another order."""
    _link(page, served, {"color": {"stat": "mean", "layer": "logged"}, "size": {"stat": "pct_expressing", "layer": "logged"},
                         "cluster": {"genes": "sections", "groups": "all", **CLUSTER}}, _grouping("cell_type"))
    page.click(f"{TP} .cgene-cluster-btn")
    summary = page.locator("[data-popover='cluster'] .cgene-cluster-menu .cgene-cluster-summary").inner_text()
    assert summary == "Complete linkage, Pearson correlation, on the values as displayed."
    head, body = _csv(page)
    groups, genes = _order(body)
    types = [str(g) for g in DOT["groups__cell_type"]]
    assert groups == [types[i] for i in LINK["means_ct__leaves_correlation_complete"]], groups
    expressed = [g for g in B if g != "GENE003"]
    want_genes = [expressed[i] for i in LINK["genes_ct__leaves_correlation_complete"]] + ["GENE003"]
    assert genes == want_genes, "scipy's leaf order; the constant gene cannot be correlated and goes last (CXG-24)"
    # the input is the display: scaled 0 to 1 per gene, the groups' profiles change and so does their order (0 to 1 per
    # group would not: a linear map of each group's values leaves their correlations as they are)
    _rescale(page, "var")
    until(page, "([s, want]) => { const p = document.querySelector(s + ' .cgene-plot');"
                " const t = p && p.layout && p.layout.yaxis && p.layout.yaxis.ticktext; return !!t && JSON.stringify(t) !== want; }",
          [TP, json.dumps(page.evaluate("(s) => document.querySelector(s + ' .cgene-plot').layout.yaxis.ticktext", TP))])
    regrouped, _ = _order(_csv(page)[1])
    assert sorted(regrouped) == sorted(groups) and regrouped != groups


# ------------------------------------------------------------------ 7. a layer with negative values

def test_difference_7_no_pct_expressing_on_a_layer_with_negative_values(page, served):
    """scanpy computes dot_size_df on any matrix (the share of values above the cutoff, here of a scaled, signed X);
    AnnZarro does not read % expressing on a layer with negative values (OD 8, SHR-27): the dots are drawn on one size,
    the panel says why, and the CSV has no size column. The colour (the mean) still equals scanpy's."""
    _link(page, served, {"color": {"stat": "mean", "layer": "X"}, "size": {"stat": "pct_expressing", "layer": "X"}},
          _grouping("cell_type"))
    head, body = _csv(page)
    assert "% expressing · X · not scaled" not in head
    assert "Mean · X · not scaled" in head
    assert DOT[_key("X", "cell_type", 0.0, 0, "none") + "__size"].max() > 0, "scanpy has a size for it"
    hint = page.locator(f"{TP} .cgene-panel").inner_text()
    assert "is not available on X: X has negative values. Choose a layer." in hint, hint
