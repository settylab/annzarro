"""The genes shape's engine (annzarro/core/gene_moments.py, ``gene_score._Source.row_moments`` and ``row_coverage``, SO-8a).

The moments of every gene over a group of cells equal NumPy's over the group's rows, in every layout and backend,
for a contiguous group, a scattered one, none and all, at thresholds either side of zero, with non-finite values
(left out of all five moments, as a grouping's features leave them). ``row_coverage`` is the stored entries of the data
chunks the rows touch: the whole layer for a scattered group, its chunks for a contiguous one; it is checked against
a brute-force count of the chunks. A read is cut between chunks, and the reads stay within the coverage.
"""
import itertools

import numpy as np
import pytest
import scipy.sparse as sp

from annzarro.core import cell_groups as cg
from annzarro.core import gene_moments as gm
from annzarro.core import gene_score as gsc
from annzarro.core import get_reader
from annzarro.tests.core import gene_score_store as store
from annzarro.tests.core import grouping_store as gstore

LAYOUT_BACKEND = list(itertools.product(store.LAYOUTS, store.BACKENDS))
THRESHOLDS = [0.0, -0.5, 1.5]


@pytest.fixture(scope="module")
def x():
    return store.make_matrix()


@pytest.fixture(scope="module")
def stores(tmp_path_factory, x):
    base = tmp_path_factory.mktemp("gm")
    return {(lay, be): store.make_store(base / f"{lay}_{be}.{'zarr' if be == 'zarr' else 'h5ad'}", x, lay, be)
            for lay, be in LAYOUT_BACKEND}


def reference(x, mask, thresholds):
    """The moments of every column of ``x`` over the rows of ``mask``, from the definition, with NumPy."""
    v = x[mask].astype(np.float64)
    finite = np.isfinite(v)
    z = np.where(finite, v, 0.0)
    out = np.zeros((x.shape[1], len(thresholds), 5))
    for i, t in enumerate(thresholds):
        above = finite & (v > t)
        out[:, i, 0] = finite.sum(axis=0)
        out[:, i, 1] = z.sum(axis=0)
        out[:, i, 2] = (z * z).sum(axis=0)
        out[:, i, 3] = above.sum(axis=0)
        out[:, i, 4] = np.where(above, v, 0.0).sum(axis=0)
    return out


def masks(n):
    rng = np.random.default_rng(5)
    scattered = np.zeros(n, dtype=bool)
    scattered[rng.choice(n, max(n // 100, 2), replace=False)] = True
    contiguous = np.zeros(n, dtype=bool)
    contiguous[20:70] = True
    odd = np.zeros(n, dtype=bool)
    odd[[0, 3, 4, 5, 90, 199]] = True                       # edges and neighbours, and the cells holding NaN and inf
    odd[[5, 40, 41, 60, 150]] = True
    return {"contiguous": contiguous, "scattered": scattered, "odd": odd, "all": np.ones(n, dtype=bool),
            "none": np.zeros(n, dtype=bool)}


def drain(steps):
    """``(entries read in each step, the return value)`` of a ``row_moments`` generator."""
    reads = []
    while True:
        try:
            reads.append(next(steps))
        except StopIteration as stop:
            return reads, stop.value


def moments(path, mask, thresholds=THRESHOLDS, layer="X", **kw):
    with gsc.open_source(get_reader(path), path, layer) as source:
        return drain(source.row_moments(mask, thresholds, **kw)), source.row_coverage(mask)


# --- the moments -----------------------------------------------------------------------------------------------

@pytest.mark.parametrize("layout,backend", LAYOUT_BACKEND)
@pytest.mark.parametrize("which", ["contiguous", "scattered", "odd", "all", "none"])
def test_moments_of_a_group_equal_numpy_over_its_rows(stores, x, layout, backend, which):
    mask = masks(x.shape[0])[which]
    (reads, got), cover = moments(stores[layout, backend], mask)
    assert got.shape == (x.shape[1], len(THRESHOLDS), 5) and got.dtype == np.float64
    np.testing.assert_allclose(got, reference(x, mask, THRESHOLDS), rtol=1e-9, atol=1e-9)
    assert sum(reads) <= cover                                  # entries read stay within the estimate
    if which == "none":
        assert reads == [] and cover == 0                       # a group of no cell reads nothing


@pytest.mark.parametrize("layout", store.LAYOUTS)
def test_a_negative_threshold_counts_unstored_zeros_and_leaves_non_finite_out(stores, x, layout):
    mask = masks(x.shape[0])["odd"]
    (_, got), _ = moments(stores[layout, "zarr"], mask, [-1.0])
    want = reference(x, mask, [-1.0])
    np.testing.assert_allclose(got, want, rtol=1e-9, atol=1e-9)
    assert got[5, 0, 0] == 0                                    # gene 5 is NaN in every cell: no finite value
    assert got[4, 0, 0] == mask.sum() - np.isnan(x[mask, 4]).sum()


@pytest.mark.parametrize("layout", store.LAYOUTS)
def test_moments_over_a_layer_and_a_subset_of_genes_by_name(stores, x, layout, tmp_path):
    counts = (np.random.default_rng(2).random(x.shape) < 0.3).astype(np.float32) * 5
    path = store.make_store(tmp_path / f"l_{layout}.zarr", x, layout, "zarr", layer=counts)
    mask = masks(x.shape[0])["contiguous"]
    (_, got), _ = moments(path, mask, [0.0], layer="counts")
    np.testing.assert_allclose(got, reference(counts, mask, [0.0]), rtol=1e-9, atol=1e-9)


def test_a_mask_of_the_wrong_length_is_refused(stores):
    path = stores["csr", "zarr"]
    with gsc.open_source(get_reader(path), path, "X") as source:
        with pytest.raises(ValueError):
            source.row_coverage(np.ones(7, dtype=bool))


# --- coverage: the chunks the rows touch -------------------------------------------------------------------------

def chunked(monkeypatch, chunks):
    """Stores written with ``chunks`` entries (a dense array: rows) to a chunk."""
    original = store._write_matrix
    monkeypatch.setattr(store, "_write_matrix", lambda g, n, a, layout, chunks=chunks: original(g, n, a, layout, chunks))


def brute_coverage(x, layout, mask, chunk):
    """Entries of the chunks of the stored arrays that hold a cell of ``mask``, counted chunk by chunk."""
    if layout == "csc":
        return int(sp.csc_matrix(x).nnz) if mask.any() else 0
    if layout == "csr":
        m = sp.csr_matrix(x)
        touched = set()
        for r in np.flatnonzero(mask):
            for k in range(m.indptr[r], m.indptr[r + 1]):
                touched.add(k // chunk)
        return sum(min((c + 1) * chunk, m.nnz) - c * chunk for c in touched)
    touched = {r // chunk for r in np.flatnonzero(mask)}
    return sum(min((c + 1) * chunk, x.shape[0]) - c * chunk for c in touched) * x.shape[1]


@pytest.mark.parametrize("layout", store.LAYOUTS)
@pytest.mark.parametrize("which", ["contiguous", "scattered", "odd", "all", "none"])
def test_coverage_is_the_entries_of_the_chunks_touched(tmp_path, monkeypatch, x, layout, which):
    size = 40 if layout == "dense" else 512            # 5 chunks of rows, or about 8 chunks of entries
    chunked(monkeypatch, size)
    path = store.make_store(tmp_path / f"c_{layout}.zarr", x, layout, "zarr")
    mask = masks(x.shape[0])[which]
    (reads, got), cover = moments(path, mask)
    assert cover == brute_coverage(x, layout, mask, size)
    np.testing.assert_allclose(got, reference(x, mask, THRESHOLDS), rtol=1e-9, atol=1e-9)
    assert sum(reads) <= cover


@pytest.mark.parametrize("layout", store.LAYOUTS)
def test_a_scattered_group_covers_the_whole_layer_and_a_contiguous_one_its_chunks_only(tmp_path, monkeypatch, x,
                                                                                       layout):
    size = 40 if layout == "dense" else 512
    chunked(monkeypatch, size)
    path = store.make_store(tmp_path / f"w_{layout}.zarr", x, layout, "zarr")
    with gsc.open_source(get_reader(path), path, "X") as source:
        whole = source.nnz if layout == "csr" else int(source.indptr[-1]) if layout == "csc" else x.size
        every_tenth = np.zeros(x.shape[0], dtype=bool)
        every_tenth[::10] = True                                # 1 cell in 10 of every chunk
        head = np.zeros(x.shape[0], dtype=bool)
        head[:15] = True
        assert source.row_coverage(every_tenth) == whole
        if layout != "csc":                                     # a CSC matrix is read whole whatever the cells
            assert 0 < source.row_coverage(head) < whole / 2


def test_unchunked_data_covers_the_rows_own_entries(tmp_path, x):
    """An HDF5 dense array is contiguous: a row is read as it is, so the coverage is the rows', not a chunk's."""
    path = store.make_store(tmp_path / "d.h5ad", x, "dense", "h5ad")
    mask = masks(x.shape[0])["odd"]
    (reads, got), cover = moments(path, mask)
    assert cover == int(mask.sum()) * x.shape[1] == sum(reads)
    np.testing.assert_allclose(got, reference(x, mask, THRESHOLDS), rtol=1e-9, atol=1e-9)


@pytest.mark.parametrize("layout", ["csr", "csc", "dense"])
def test_moments_over_many_row_blocks_equal_one_block(tmp_path, monkeypatch, x, layout):
    monkeypatch.setattr(gsc, "ROW_BLOCK", 37)                  # row pointers looked up 37 rows at a time
    chunked(monkeypatch, 40 if layout == "dense" else 100)
    path = store.make_store(tmp_path / f"b_{layout}.zarr", x, layout, "zarr")
    for which in ("contiguous", "scattered", "odd", "all"):
        mask = masks(x.shape[0])[which]
        (reads, got), cover = moments(path, mask)
        np.testing.assert_allclose(got, reference(x, mask, THRESHOLDS), rtol=1e-9, atol=1e-9)
        assert cover == brute_coverage(x, layout, mask, 40 if layout == "dense" else 100) and sum(reads) <= cover


# --- cancel and pause between chunks ----------------------------------------------------------------------------

@pytest.mark.parametrize("layout", store.LAYOUTS)
def test_a_read_is_cut_between_chunks(tmp_path, monkeypatch, x, layout):
    chunked(monkeypatch, 20 if layout == "dense" else 64)
    monkeypatch.setattr(gsc, "STAT_CHUNK", 64)
    monkeypatch.setattr(gsc, "MAX_GROUP_ENTRIES", 64)
    monkeypatch.setattr(gsc, "SEGMENT_ENTRIES", 20 * x.shape[1])
    path = store.make_store(tmp_path / f"s_{layout}.zarr", x, layout, "zarr")
    mask = masks(x.shape[0])["all"]
    asked = []

    def stop():
        asked.append(1)
        return len(asked) > 2                                   # true on the third look: between chunks
    with pytest.raises(gsc.ScoreCancelled):
        moments(path, mask, should_stop=stop)
    assert 3 <= len(asked) <= 6                                 # it stopped early: a few reads, not all of them
    (reads, _), cover = moments(path, mask)
    assert len(reads) > 6 and sum(reads) <= cover               # the whole run has many more reads


@pytest.mark.parametrize("layout", ["csr", "csc"])
def test_a_pause_is_taken_between_reads_and_changes_nothing(tmp_path, monkeypatch, x, layout):
    chunked(monkeypatch, 64)
    monkeypatch.setattr(gsc, "STAT_CHUNK", 64)
    monkeypatch.setattr(gsc, "MAX_GROUP_ENTRIES", 64)
    path = store.make_store(tmp_path / f"p_{layout}.zarr", x, layout, "zarr")
    mask = masks(x.shape[0])["all"]

    class Pause:
        def __init__(self):
            self.waits, self.asks = 0, 0

        def wanted(self):
            self.asks += 1
            return self.asks % 3 == 0

        def wait(self):
            self.waits += 1
    pause = Pause()
    (_, got), _ = moments(path, mask, pause=pause)
    assert pause.waits > 0
    np.testing.assert_allclose(got, reference(x, mask, THRESHOLDS), rtol=1e-9, atol=1e-9)


# --- the request and the plan --------------------------------------------------------------------------------

def grouping_body(**kw):
    return {"shape": "genes", "partitionings": [{"source": {"type": "obs", "key": "cell_type"}}],
            "group": ["c:B cell"], **kw}


def test_the_request_names_cells_by_a_group_or_a_member_and_nothing_else():
    ok = gm.parse_request(grouping_body())
    assert ok.group == ("c:B cell",) and ok.layer == "X" and ok.thresholds == (0.0,) and ok.member is None
    assert gm.parse_request(grouping_body(group='["c:B cell"]', thresholds=[0, 1.5], layer="logged")).thresholds \
        == (0.0, 1.5)
    bits = {"encoding": "bitset-base64", "length": 8, "data": "AQ=="}
    assert gm.parse_request({"shape": "genes", "sets": {"t": bits}, "member": "t"}).member == "t"
    for bad, reason in [
        ({"shape": "genes"}, "bad_request"),
        (grouping_body(member="t", sets={"t": bits}), "bad_request"),
        ({"shape": "genes", "member": "t"}, "set_missing"),
        ({"shape": "genes", "member": "t", "sets": {"t": bits}, "partitionings": []}, "bad_request"),
        (grouping_body(group=[]), "bad_group"),
        (grouping_body(group="not json"), "bad_group"),
        (grouping_body(thresholds=[]), "bad_threshold"),
        (grouping_body(thresholds=[0, 0]), "bad_threshold"),
        (grouping_body(thresholds=[float("inf")]), "bad_threshold"),
        (grouping_body(thresholds=[True]), "bad_threshold"),
        (grouping_body(thresholds=list(range(gm.MAX_THRESHOLDS + 1))), "too_many_thresholds"),
        (grouping_body(features=[]), "unknown_field"),
        (grouping_body(layer=""), "bad_request"),
    ]:
        with pytest.raises(cg.GroupError) as err:
            gm.parse_request(bad)
        assert err.value.reason == reason, bad


def test_the_cells_of_a_group_and_of_a_set_are_a_mask_over_the_dataset(tmp_path):
    path = gstore.make_store(tmp_path / "g.zarr", "csr", "zarr")
    reader, data = get_reader(path), gstore.make_data()
    parsed = gm.parse_request(grouping_body())
    plan = gm.plan(reader, path, parsed)
    assert (plan.n_cells, plan.n_var, plan.layout) == (gstore.N_OBS, gstore.N_VAR, "csr")
    result = None
    for kind, payload in cg.compute(plan.groups):
        result = payload
    mask = gm.mask_of(plan, None, result)
    assert np.array_equal(mask, (data.obs["cell_type"] == "B cell").to_numpy())
    rows = np.arange(0, gstore.N_OBS, 2)
    subset_plan = gm.plan(reader, path, gm.parse_request(grouping_body(subset="x")))
    shown = None
    for kind, payload in cg.compute(subset_plan.groups, rows):
        shown = payload
    sub = gm.mask_of(subset_plan, rows, shown)
    assert np.array_equal(sub, mask & (np.arange(gstore.N_OBS) % 2 == 0))
    with pytest.raises(cg.GroupError) as err:
        gm.mask_of(gm.plan(reader, path, gm.parse_request(grouping_body(group=["c:nobody"]))), None, result)
    assert (err.value.status, err.value.reason) == (422, "group_missing")


def test_a_missing_layer_is_a_404(tmp_path):
    path = gstore.make_store(tmp_path / "g.zarr", "csr", "zarr")
    with pytest.raises(gsc.ScoreError) as err:
        gm.plan(get_reader(path), path, gm.parse_request(grouping_body(layer="nope")))
    assert (err.value.status, err.value.reason) == (404, "key_not_found")


def test_the_tiers_follow_the_one_pair_of_limits(monkeypatch):
    assert [gm.tier_of(s) for s in (0, gm.ASK_FIRST_S, gm.ASK_FIRST_S + 1, gm.REFUSE_S, gm.REFUSE_S + 1)] == \
        ["auto", "auto", "confirm", "confirm", "refused"]
    monkeypatch.setattr(gm, "ASK_FIRST_S", 0.5)
    monkeypatch.setattr(gm, "REFUSE_S", 1.0)
    assert [gm.tier_of(s) for s in (0.4, 0.6, 2.0)] == ["auto", "confirm", "refused"]
