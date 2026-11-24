"""A z-scored gene feature (design aggregation-unify-080, 2.1 and 2.5): ``{"kind": "gene", "transform": "zscore"}``.

The five moments of a z feature are the moments of the gene's clipped z-score over the cells of each group, where
the z-score's mean and SD are taken over ALL cells of the dataset (population SD, zeros included, a non-finite cell
left out), as ``gene_score`` does for a one-gene ``zscore_mean`` signature. The browser's statistic is ``sum / n``.

Checked against the definition in float64 (1e-9) and against the score engine's one-gene signature (float32 output,
so within float32 rounding), in every layout, with a subset shown, with a rare gene that hits the clip, with
non-finite values, with a constant gene, and for the wire: one read for a raw and a z feature of a gene.
"""
import itertools

import numpy as np
import pytest

from annzarro.core import cell_groups as cg
from annzarro.core import gene_score as gsc
from annzarro.core import get_reader
from annzarro.core import group_features as gf
from annzarro.tests.core import grouping_store as gs

LAYOUTS = list(gs.LAYOUTS)
PARTS = [{"source": {"type": "obs", "key": "cell_type"}}]
RARE, NAN_GENE, CONSTANT, COMMON = 5, 9, 7, 12
RARE_ROWS = (10, 400, 800)


@pytest.fixture(scope="module")
def data():
    base = gs.make_data()
    logged, counts, x = base.logged.copy(), base.counts.copy(), base.x.copy()
    for arr in (logged, counts):
        arr[:, RARE] = 0.0
        arr[list(RARE_ROWS), RARE] = 1000.0                  # z about 20: past the clip
        arr[:, CONSTANT] = 2.0                               # constant, but not zero
    rng = np.random.default_rng(3)
    bad = rng.choice(gs.N_OBS, 90, replace=False)
    logged[bad[:50], NAN_GENE] = np.nan
    logged[bad[50:70], NAN_GENE] = np.inf
    logged[bad[70:], NAN_GENE] = -np.inf
    return gs.GroupingData(base.obs, x, logged, counts, base.obsm, base.obsp)


@pytest.fixture(scope="module")
def stores(tmp_path_factory, data):
    base = tmp_path_factory.mktemp("gfz")
    return {lay: gs.make_store(base / f"{lay}.zarr", lay, "zarr", data=data) for lay in LAYOUTS}


def feature(fid, gene_index, layer, transform="zscore", clip=10, detect_above=None, **extra):
    f = {"id": fid, "kind": "gene", "name": gs.gene(gene_index), "layer": layer}
    if transform is not None:
        f["transform"] = transform
        f["clip"] = clip
    if detect_above is not None:
        f["detect_above"] = detect_above
    f.update(extra)
    return f


def run(path, features, rows=None):
    body = {"shape": "grouping", "partitionings": PARTS, "features": list(features)}
    p = gf.plan(get_reader(path), path, cg.parse_request(body))
    events = list(gf.compute(p, rows))
    assert events[-1][0] == "result"
    return events[-1][1]


def plan(path, features):
    body = {"shape": "grouping", "partitionings": PARTS, "features": list(features)}
    return gf.plan(get_reader(path), path, cg.parse_request(body))


def cell_group(res):
    codes = res.grouping.codes.astype(np.int64)
    codes[codes == (0xFF if res.grouping.codes.dtype == np.uint8 else 0xFFFF)] = -1
    return codes


def ref_z(column, clip=10.0):
    """The definition, in float64: z over every finite cell of the dataset, clipped; NaN where not finite. None when
    the gene has no spread."""
    x = np.asarray(column, dtype=np.float64)
    finite = np.isfinite(x)
    mu = x[finite].mean()
    sd = np.sqrt(((x[finite] - mu) ** 2).mean())
    if not sd > 0 or x[finite].min() == x[finite].max():
        return None
    z = np.full(x.shape, np.nan)
    z[finite] = (x[finite] - mu) / sd
    return z if clip is None else np.clip(z, -clip, clip)


def ref_moments(values, groups, k, above=0.0):
    return np.array([gs.moments(values[groups == g], above) for g in range(k)], dtype=np.float64)


def close(mine, want, rtol=1e-9, atol=1e-12):
    np.testing.assert_allclose(np.asarray(mine, dtype=np.float64), np.asarray(want, dtype=np.float64),
                               rtol=rtol, atol=atol)


def one_gene_signature_means(path, name, layer, rows, groups, k):
    """Per group, the mean of the score engine's one-gene ``zscore_mean`` signature over the cells with a score."""
    p = gsc.plan(get_reader(path), path, gsc.parse_recipe({"genes": [name], "method": "zscore_mean", "input": layer}))
    values = [r for e, r in gsc.compute(p, rows) if e == "result"][0].values.astype(np.float64)
    return np.array([np.nanmean(values[groups == g]) if np.isfinite(values[groups == g]).any() else np.nan
                     for g in range(k)])


CASES = [(COMMON, "logged"), (COMMON, "counts"), (RARE, "counts"), (RARE, "logged"), (NAN_GENE, "logged"),
         (3, "counts")]


@pytest.mark.parametrize("layout", LAYOUTS)
@pytest.mark.parametrize("shown", [None, "third"])
def test_group_mean_of_z_equals_the_one_gene_signature(data, stores, layout, shown):
    """(1) and (2): CSC, CSR and dense; with a subset shown the reference is still all the dataset's cells."""
    rows = None if shown is None else np.asarray(gs.SHOWN_THIRD)
    feats = [feature(f"f{i}", g, layer) for i, (g, layer) in enumerate(CASES) if (g, layer) != (3, "counts")]
    res = run(stores[layout], feats, rows)
    groups = cell_group(res)
    k = len(res.grouping.groups)
    sel = np.arange(gs.N_OBS) if rows is None else rows
    for i, f in enumerate(feats):
        column = data.layer(f["layer"])[:, data.var_names.index(f["name"])]
        z = ref_z(column)[sel]
        m = res.feature_moments[i]
        close(m, ref_moments(z, groups, k))                                    # all five moments, by definition
        mean = m[:, 1] / m[:, 0]
        sig = one_gene_signature_means(stores[layout], f["name"], f["layer"], rows, groups, k)
        np.testing.assert_allclose(mean, sig, rtol=1e-6, atol=1e-6)          # float32 score values
    assert [s["status"] for s in res.features] == ["ok"] * len(feats)


@pytest.mark.parametrize("layout", LAYOUTS)
def test_a_rare_gene_hits_the_clip_and_still_matches(data, stores, layout):
    """(3): three cells at z about 20 are clipped to 10; the group mean is the clipped one."""
    column = data.layer("counts")[:, RARE].astype(np.float64)
    raw_z = (column - column.mean()) / column.std()
    assert raw_z.max() > 15                                                    # the fixture really passes the clip
    res = run(stores[layout], [feature("a", RARE, "counts"), feature("b", RARE, "counts", clip=None)])
    groups = cell_group(res)
    k = len(res.grouping.groups)
    close(res.feature_moments[0], ref_moments(ref_z(column), groups, k))
    close(res.feature_moments[1], ref_moments(ref_z(column, None), groups, k))    # clip null: not clipped
    assert res.feature_moments[0][:, 1].sum() < res.feature_moments[1][:, 1].sum()


@pytest.mark.parametrize("layout", LAYOUTS)
def test_non_finite_cells_are_left_out_of_the_reference_and_the_mean(data, stores, layout):
    """(4): NaN and infinite cells are in neither the mean and SD nor a group's n."""
    res = run(stores[layout], [feature("a", NAN_GENE, "logged", detect_above=0.25)])
    groups = cell_group(res)
    k = len(res.grouping.groups)
    column = data.layer("logged")[:, NAN_GENE]
    close(res.feature_moments[0], ref_moments(ref_z(column), groups, k, 0.25))
    finite_per_group = [int(np.isfinite(column[groups == g]).sum()) for g in range(k)]
    assert res.feature_moments[0][:, 0].tolist() == finite_per_group


@pytest.mark.parametrize("layout", LAYOUTS)
def test_a_gene_without_spread_is_constant_and_has_no_value(stores, layout):
    """(5): a constant gene (2.0 everywhere, or all zero) is status constant, with moments of 0 (n = 0 reads as NaN)."""
    res = run(stores[layout], [feature("c", CONSTANT, "logged"), feature("z", 3, "counts"),
                               feature("ok", COMMON, "logged")])
    assert [s["status"] for s in res.features] == ["constant", "constant", "ok"]
    assert (res.feature_moments[0] == 0).all() and (res.feature_moments[1] == 0).all()
    assert (res.feature_moments[2][:, 0] > 0).all()


def test_a_raw_and_a_z_feature_of_one_gene_share_one_read(stores, data):
    """(6): the gene is read once; the plan, the entries told and the raw moments are those of the raw feature alone."""
    path = stores["csc"]
    raw = feature("raw", COMMON, "counts", transform=None, detect_above=0.5)
    both = [raw, feature("z", COMMON, "counts"), feature("z2", COMMON, "counts", detect_above=1.0)]
    alone, together = plan(path, [raw]), plan(path, both)
    assert together.work.entries == alone.work.entries > 0
    assert [len(r.columns) for r in together.work.reads] == [1]
    told = []
    p = plan(path, both)
    events = list(gf.compute(p, None, on_entries=told.append))
    res = events[-1][1]
    assert sum(told) == p.work.entries
    groups = cell_group(res)
    k = len(res.grouping.groups)
    column = data.layer("counts")[:, COMMON]
    close(res.feature_moments[0], ref_moments(column, groups, k, 0.5))
    close(res.feature_moments[1], ref_moments(ref_z(column), groups, k))
    close(res.feature_moments[2], ref_moments(ref_z(column), groups, k, 1.0))


def test_a_z_feature_beside_a_raw_one_changes_neither(stores, data):
    """The raw feature's moments are the same with and without a z feature of its gene."""
    path = stores["csr"]
    raw = feature("raw", COMMON, "logged", transform=None)
    a = run(path, [raw]).feature_moments[0]
    b = run(path, [feature("z", COMMON, "logged"), raw]).feature_moments[1]
    close(a, b, rtol=0, atol=0)


@pytest.mark.parametrize("features,reason", [
    ([{"id": "a", "kind": "gene", "name": "GENE000", "clip": 10}], "bad_feature"),          # (7) clip needs transform
    ([{"id": "a", "kind": "gene", "name": "GENE000", "clip": None}], "bad_feature"),
    ([{"id": "a", "kind": "gene", "name": "GENE000", "transform": "rank"}], "bad_feature"),
    ([{"id": "a", "kind": "gene", "name": "GENE000", "transform": "zscore", "clip": 0}], "bad_clip"),
    ([{"id": "a", "kind": "gene", "name": "GENE000", "transform": "zscore", "clip": "10"}], "bad_clip"),
    ([{"id": "a", "kind": "score", "recipe": {"genes": ["GENE000"]}, "transform": "zscore"}], "unknown_field"),
])
def test_bad_z_features_are_refused(features, reason):
    with pytest.raises(gsc.ScoreError) as e:
        gf.parse_features(features)
    assert e.value.reason == reason and e.value.status == 400


def test_a_z_feature_defaults_to_the_signatures_clip():
    (f,) = gf.parse_features([{"id": "a", "kind": "gene", "name": "GENE000", "transform": "zscore"}])
    assert f.transform == "zscore" and f.clip == gsc.DEFAULT_CLIP == 10.0
    (g,) = gf.parse_features([{"id": "a", "kind": "gene", "name": "GENE000"}])
    assert g.transform is None and g.clip is None


def test_the_reference_helper_is_the_score_engines():
    """``gene_reference`` is what ``_Accumulator`` takes a gene's mean and SD from: dense, sparse and non-finite."""
    values = np.array([0.0, 1.0, 2.0, np.nan, 5.0])
    ref = gsc.gene_reference(values, 5)
    finite = values[np.isfinite(values)]
    assert ref.n_finite == 4 and ref.mean == pytest.approx(finite.mean()) and ref.sd == pytest.approx(finite.std())
    assert not ref.constant
    sparse = gsc.gene_reference(np.array([3.0, 3.0]), 10)                         # eight implicit zeros
    assert sparse.n_finite == 10 and sparse.mean == pytest.approx(0.6) and not sparse.constant
    assert gsc.gene_reference(np.array([2.0, 2.0, 2.0]), 3).constant
    assert gsc.gene_reference(np.zeros(0), 4).constant


def test_the_reference_helper_takes_totals_when_given():
    values = np.array([0.0, 1.0, 2.0, np.nan, 5.0, 0.0, 0.0])
    finite = values[np.isfinite(values)]
    full = gsc.gene_reference(values, 7)
    given = gsc.gene_reference(None, 7, totals=(finite.size, float(finite.sum()), float((finite ** 2).sum())))
    assert given.n_finite == full.n_finite and given.mean == pytest.approx(full.mean, rel=1e-12)
    assert given.sd == pytest.approx(full.sd, rel=1e-9) and not given.constant
    assert gsc.gene_reference(None, 5, totals=(5, 10.0, 20.0)).constant               # five 2.0s
    assert gsc.gene_reference(None, 5, totals=(0, 0.0, 0.0)).constant
