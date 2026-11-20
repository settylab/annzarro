"""The grouping fixture (grouping_store.py): the store reads back as the data, the references agree with
hand-checkable facts, and the expected-number files are not stale."""
import itertools
import json

import numpy as np
import pytest

from annzarro.core import get_reader
from annzarro.tests.core import grouping_store as gs

LAYOUT_BACKEND = list(itertools.product(gs.LAYOUTS, gs.BACKENDS))


@pytest.fixture(scope="module")
def data():
    return gs.make_data()


@pytest.fixture(scope="module")
def stores(tmp_path_factory):
    base = tmp_path_factory.mktemp("grouping")
    return {(lay, be): gs.make_store(base / f"{lay}_{be}.{'zarr' if be == 'zarr' else 'h5ad'}", lay, be)
            for lay, be in LAYOUT_BACKEND}


# --- the data ----------------------------------------------------------------------------------------------

def test_obs_columns_are_as_documented(data):
    obs = data.obs
    assert obs.shape == (1200, 11)
    assert obs["cell_type"].value_counts().reindex([n for n, _ in gs.CELL_TYPES]).tolist() == [500, 300, 200, 150, 45, 5]
    assert obs["condition"].nunique() == 2
    assert obs["sample"].nunique() == 30 and (obs["sample"] == "other").sum() == 40
    assert len(obs["many"].cat.categories) == 2001 and obs["many"].nunique() == 1200
    assert obs["pseudotime"].isna().sum() == 20 and obs["pseudotime"].nunique() <= 25
    assert obs["pseudotime"].value_counts().iloc[0] >= 40                       # heavy ties
    assert abs((obs["depth"] == 0).mean() - 0.6) < 0.05
    assert (obs["constant"] == obs["constant"].iloc[0]).all()
    assert (obs["signed"] < 0).any() and (obs["signed"] > 0).any()
    assert obs["is_doublet"].dtype == bool and obs["is_doublet"].any()
    assert obs["batch"].dtype == np.int64 and obs["batch"].nunique() == 12
    assert obs["score"].dtype == np.float64


def test_layers_obsm_obsp(data):
    assert (data.x < 0).any() and (data.logged >= 0).all()
    assert (data.counts == np.round(data.counts)).all() and (data.counts[:, 3] == 0).all()
    assert data.obsm["X_umap"].shape == (1200, 2) and data.obsm["X_wide"].shape == (1200, 50)
    assert data.obsp.shape == (1200, 1200) and 0 < np.count_nonzero(data.obsp) < 20_000
    assert gs.make_data() is data                                                # one build per process


def test_gene_sets():
    s = gs.GENE_SETS
    assert [len(s[k]) for k in ("b_markers", "t_markers", "with_missing", "all")] == [12, 12, 12, 40]
    have = {gs.gene(i) for i in range(40)}
    assert len([g for g in s["with_missing"] if g in have]) == 9
    assert not set(s["b_markers"]) & set(s["t_markers"])
    assert gs.SIGNATURES["up_only"]["down"] == [] and gs.SIGNATURES["up_and_down"]["down"]


# --- the store ---------------------------------------------------------------------------------------------

@pytest.mark.parametrize("layout,backend", LAYOUT_BACKEND)
def test_store_reads_back_as_the_data(stores, data, layout, backend):
    path = stores[layout, backend]
    reader = get_reader(path)
    assert len(reader.get_cell_gene_names(path, "cells")) == 1200
    assert reader.get_cell_gene_names(path, "genes") == data.var_names
    codes, cats = reader.get_obs_var_codes("cells", path, "sample")
    assert list(cats) == gs.sample_names() and (np.asarray(codes) == data.obs["sample"].cat.codes.to_numpy()).all()
    codes, cats = reader.get_obs_var_codes("cells", path, "many")
    assert len(cats) <= 2001 and len(np.asarray(codes)) == 1200
    for col in ("score", "depth", "signed", "batch"):
        got = np.asarray(reader.get_obs_var_numeric("cells", path, col))
        assert np.array_equal(got, data.obs[col].to_numpy()), col
    pt = np.asarray(reader.get_obs_var_numeric("cells", path, "pseudotime"), dtype=np.float64)
    assert np.array_equal(pt, data.obs["pseudotime"].to_numpy(), equal_nan=True)
    umap = np.asarray(reader.get_obsm_varm("cells", "X_umap", path))
    assert np.array_equal(umap, data.obsm["X_umap"])


@pytest.mark.parametrize("layout,backend", LAYOUT_BACKEND)
def test_x_and_layers_read_back(stores, data, layout, backend):
    path = stores[layout, backend]
    reader = get_reader(path)
    rows, cols = [0, 5, 600, 1199], [0, 3, 17, 39]
    assert np.array_equal(np.asarray(reader.get_X(path, rows, cols)), data.x[np.ix_(rows, cols)])
    for name in ("logged", "counts"):
        got = np.asarray(reader.get_layer(name, path, rows, cols))
        assert np.array_equal(got, data.layer(name)[np.ix_(rows, cols)]), name


# --- the references ----------------------------------------------------------------------------------------

def test_reference_groups_by_hand(data):
    r = gs.reference_groups(data, gs.GROUPING_RECIPES["cell_type"]["partitionings"])
    assert [(g["key"], g["n"]) for g in r["groups"]] == [(["c:" + n], k) for n, k in gs.CELL_TYPES]
    assert r["n_shown"] == r["n_grouped"] == 1200
    assert (np.bincount(r["codes"]) == [k for _, k in gs.CELL_TYPES]).all()


def test_reference_groups_brute_force_pandas_crosstab(data):
    r = gs.reference_groups(data, gs.GROUPING_RECIPES["cell_type_x_condition"]["partitionings"])
    tab = data.obs.groupby(["cell_type", "condition"], observed=True).size()
    assert [g["n"] for g in r["groups"]] == tab.tolist()
    assert [g["key"] for g in r["groups"]] == [[f"c:{a}", f"c:{b}"] for a, b in tab.index]


def test_reference_moments_equal_pandas_groupby(data):
    f = gs.FEATURES[0]
    r = gs.reference_groups(data, gs.GROUPING_RECIPES["cell_type"]["partitionings"], features=[f])
    col = data.logged[:, data.var_names.index(f["name"])].astype(np.float64)
    for g, m in zip(data.obs["cell_type"].cat.categories, r["moments"]["f0"]):
        v = col[(data.obs["cell_type"] == g).to_numpy()]
        assert m[0] == len(v) and m[1] == pytest.approx(v.sum(), rel=1e-12) and m[2] == pytest.approx((v * v).sum(), rel=1e-12)
        assert m[3] == (v > 0).sum() and m[4] == pytest.approx(v[v > 0].sum(), rel=1e-12)


def test_typed_ids_keep_a_category_other_apart_from_the_rest(data):
    r = gs.reference_groups(data, gs.GROUPING_RECIPES["sample_other_vs_at_other"]["partitionings"])
    assert [(g["key"][0], g["n"]) for g in r["groups"]] == [("c:other", 40), ("c:S00", 40), ("@other", 1120)]


def test_binning_conventions(data):
    pt = gs.reference_groups(data, gs.GROUPING_RECIPES["pseudotime_width4"]["partitionings"])
    edges = pt["partitionings"][0]["edges"]
    assert edges == [0.0, 0.25, 0.5, 0.75, 1.0] or len(edges) == 5
    assert pt["partitionings"][0]["levels"][-1] == "@na" and pt["groups"][-1]["n"] == 20          # no value is last
    assert pt["n_grouped"] == 1200
    assert gs.reference_groups(data, gs.GROUPING_RECIPES["pseudotime_width4_exclude"]["partitionings"])["n_grouped"] == 1180
    ties = gs.reference_groups(data, gs.GROUPING_RECIPES["pseudotime_count4_ties"]["partitionings"])
    assert ties["partitionings"][0]["bins_made"] <= 4
    zero = gs.reference_groups(data, gs.GROUPING_RECIPES["depth_width3_zero_bin"]["partitionings"])
    assert zero["groups"][0]["key"] == ["@zero"] and zero["groups"][0]["n"] == int((data.obs["depth"] == 0).sum())
    const = gs.reference_groups(data, gs.GROUPING_RECIPES["constant_degenerate"]["partitionings"])
    assert [g["key"] for g in const["groups"]] == [["bin:0"]] and const["partitionings"][0]["bins_made"] == 1
    last = gs.reference_groups(data, [gs._binned("batch", "equal_width", 4)])                       # last bin is closed
    assert sum(g["n"] for g in last["groups"]) == 1200


def test_edges_from_shown_differs_from_all(data):
    shown = gs.reference_groups(data, gs.GROUPING_RECIPES["pseudotime_width4_shown_third_edges_shown"]["partitionings"], gs.SHOWN_THIRD)
    allc = gs.reference_groups(data, gs.GROUPING_RECIPES["pseudotime_width4_shown_third_edges_all"]["partitionings"], gs.SHOWN_THIRD)
    assert shown["n_shown"] == allc["n_shown"] == 400
    assert shown["partitionings"][0]["edges_n"] == pytest.approx(400, abs=20) and allc["partitionings"][0]["edges_n"] == 1180


def test_small_group_modes(data):
    keep, collect, hide = (gs.reference_groups(data, gs.GROUPING_RECIPES[f"small_{m}"]["partitionings"],
                                               small=gs.GROUPING_RECIPES[f"small_{m}"]["small"]) for m in ("keep", "collect", "hide"))
    assert len(keep["groups"]) == 6 and keep["n_grouped"] == 1200
    assert collect["groups"][-1] == {"key": ["@small"], "n": 5} and len(collect["groups"]) == 6
    assert len(hide["groups"]) == 5 and hide["n_grouped"] == 1195


def test_level_limit_and_members(data):
    assert gs.reference_groups(data, gs.GROUPING_RECIPES["many_over_limit"]["partitionings"])["refused"] == \
        {"reason": "too_many_levels", "count": 2001, "limit": 2000}
    m = gs.reference_groups(data, gs.GROUPING_RECIPES["depth_above_2"]["partitionings"])
    assert [g["key"] for g in m["groups"]] == [["@in"], ["@out"]]
    assert m["groups"][0]["n"] == int((data.obs["depth"] > 2).sum())


def test_reference_grid(data):
    g = gs.reference_grid(data, gs.GRID_RECIPES["cell_type_x_condition"]["partitionings"], measure=gs.GRID_RECIPES["cell_type_x_condition"]["measure"])
    tab = data.obs.groupby(["cell_type", "condition"], observed=False).size()
    assert g["counts"] == tab.tolist() and g["n_counted"] == 1200
    assert [m[0] for m in g["measure"]] == tab.tolist()
    three = gs.reference_grid(data, gs.GRID_RECIPES["three_axes"]["partitionings"])
    assert len(three["counts"]) == 6 * 2 * 2 and sum(three["counts"]) == 1200
    other = gs.reference_grid(data, gs.GRID_RECIPES["kept_other_x_condition"]["partitionings"])
    assert other["axes"][0]["levels"] == ["c:T cell", "@other"] and sum(other["counts"]) == 1200


# --- the numbers on disk -----------------------------------------------------------------------------------

def test_expected_numbers_are_not_stale():
    with open(gs.EXPECTED_PATH) as fh:
        on_disk = json.load(fh)
    assert gs.same(on_disk, gs.build_expected()), "tests/data/grouping_expected.json is stale: python -m annzarro.tests.core.grouping_store"


def test_js_columns_are_not_stale():
    with open(gs.COLUMNS_PATH) as fh:
        on_disk = json.load(fh)
    assert gs.same(on_disk, gs.build_columns()), "tests/js/fixtures/grouping_columns.json is stale: python -m annzarro.tests.core.grouping_store"
