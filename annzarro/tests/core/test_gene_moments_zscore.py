"""Z-score mean of a group in the genes shape (package G1a): ``{"shape": "genes", "transform": "zscore"}``.

Each gene's mean and SD are taken over ALL cells of the matrix, in the same pass that reads the group's entries (a
compressed-sparse-column matrix reads every stored entry for any group); a gene whose z-scores reach the clip has its
range read again and is summed directly, every other gene is ``n (mean_G - mu) / sd``. The moments returned are those
of the clipped z-score over the group (``n``, ``sum``, ``sumsq``; the two threshold moments are 0), so the browser's
statistic is ``sum / n``, the number of S1's z-scored gene feature and of a one-gene signature's z-score mean.

CSR and dense matrices refuse with ``zscore_needs_csc``: their group read is cheaper than the layer, so the reference
would be a second whole-layer read (the moments cache, 0.8.1).
"""
import numpy as np
import pytest

from annzarro.core import gene_moments as gm
from annzarro.core import gene_score as gsc
from annzarro.core import get_reader
from annzarro.tests.core import gene_score_store as store
from annzarro.tests.core.test_gene_moments import drain, masks


@pytest.fixture(scope="module")
def x():
    return store.make_matrix()


@pytest.fixture(scope="module")
def stores(tmp_path_factory, x):
    base = tmp_path_factory.mktemp("gmz")
    out = {}
    for lay in store.LAYOUTS:
        for be in store.BACKENDS:
            out[lay, be] = store.make_store(base / f"{lay}_{be}.{'zarr' if be == 'zarr' else 'h5ad'}", x, lay, be)
    return out


def reference(x, mask, clip):
    """The definition, with NumPy: z over every finite cell, clipped; the moments over the group's finite cells."""
    v = x.astype(np.float64)
    out = np.zeros((x.shape[1], 5))
    for g in range(x.shape[1]):
        col = v[:, g]
        finite = np.isfinite(col)
        if not finite.any() or col[finite].min() == col[finite].max():
            continue
        mu = col[finite].mean()
        sd = np.sqrt(((col[finite] - mu) ** 2).mean())
        if not sd > 0:
            continue
        z = (col - mu) / sd
        if clip is not None:
            z = np.clip(z, -clip, clip)
        zg = z[mask & finite]
        out[g, :3] = [zg.size, zg.sum(), (zg * zg).sum()]
    return out


def zmoments(path, mask, clip=10.0, tasks=None):
    with gsc.open_source(get_reader(path), path, "X") as source:
        if tasks is not None:
            original = source.tasks
            source.tasks = lambda cols: (tasks.append(sorted(int(c) for c in cols)), original(cols))[1]
        reads, out = drain(source.row_zscore_moments(mask, clip))
        return reads, out


@pytest.mark.parametrize("backend", store.BACKENDS)
@pytest.mark.parametrize("clip", [10.0, 3.0, None])
@pytest.mark.parametrize("which", ["contiguous", "scattered", "odd", "all", "none"])
def test_group_moments_of_the_z_score_equal_the_definition(stores, x, backend, which, clip):
    mask = masks(x.shape[0])[which]
    _, got = zmoments(stores["csc", backend], mask, clip)
    assert got.shape == (x.shape[1], 5)
    np.testing.assert_allclose(got, reference(x, mask, clip), rtol=1e-9, atol=1e-10)
    assert (got[:, 3:] == 0).all()


def test_constant_and_empty_genes_have_n_zero(stores, x):
    _, got = zmoments(stores["csc", "zarr"], masks(x.shape[0])["all"])
    for gene in (2, 3, 5):                       # constant 3.0, all zero, all NaN
        assert (got[gene] == 0).all(), gene
    assert got[0, 0] > 0


def test_only_the_genes_that_clip_are_read_again_and_the_layer_once(stores, x):
    asked = []
    reads, got = zmoments(stores["csc", "zarr"], masks(x.shape[0])["scattered"], 10.0, tasks=asked)
    with gsc.open_source(get_reader(stores["csc", "zarr"]), stores["csc", "zarr"], "X") as source:
        layer = int(source.indptr[-1])
    assert sum(reads) == layer, "the layer is read once"
    assert asked == [[1, 6]], asked              # the rare genes: z of one huge value, and of two values in 200 cells
    asked.clear()
    zmoments(stores["csc", "zarr"], masks(x.shape[0])["scattered"], None, tasks=asked)
    assert asked == [], "no clip, no second read"


def test_the_group_mean_is_the_one_gene_signatures_score(stores, x):
    path, mask = stores["csc", "zarr"], masks(x.shape[0])["contiguous"]
    _, got = zmoments(path, mask)
    for gene in (0, 1, 4, 6):
        name = store.gene(gene) if hasattr(store, "gene") else f"GENE{gene:03d}"
        p = gsc.plan(get_reader(path), path, gsc.parse_recipe({"genes": [name], "method": "zscore_mean", "input": "X"}))
        scores = [r for e, r in gsc.compute(p, None) if e == "result"][0].values.astype(np.float64)
        sel = scores[mask & np.isfinite(scores)]
        assert got[gene, 1] / got[gene, 0] == pytest.approx(sel.mean(), rel=1e-5, abs=1e-6), gene


@pytest.mark.parametrize("layout", ["csr", "dense"])
def test_other_layouts_refuse_with_the_reason(stores, x, layout):
    path = stores[layout, "zarr"]
    with pytest.raises(gsc.ScoreError) as e:
        zmoments(path, masks(x.shape[0])["all"])
    assert e.value.reason == "zscore_needs_csc" and e.value.status == 422
    request = gm.parse_request({"shape": "genes", "member": "t", "sets": {"t": _set(x.shape[0])}, "layer": "X",
                                "transform": "zscore"})
    with pytest.raises(gsc.ScoreError) as e:
        gm.plan(get_reader(path), path, request)
    assert e.value.reason == "zscore_needs_csc"


def _set(n):
    import base64
    bits = np.zeros(n, dtype=bool)
    bits[:30] = True
    return {"encoding": "bitset-base64", "length": n, "data": base64.b64encode(np.packbits(bits, bitorder="little").tobytes()).decode()}


def test_the_request_takes_transform_and_clip(x):
    base = {"shape": "genes", "member": "t", "sets": {"t": _set(x.shape[0])}, "layer": "X"}
    assert gm.parse_request({**base, "transform": "zscore"}).clip == 10.0
    assert gm.parse_request({**base, "transform": "zscore", "clip": None}).clip is None
    assert gm.parse_request(base).transform is None
    for bad, reason in (({"clip": 10}, "bad_feature"), ({"transform": "rank"}, "bad_feature"),
                        ({"transform": "zscore", "clip": 0}, "bad_clip")):
        with pytest.raises(gsc.ScoreError) as e:
            gm.parse_request({**base, **bad})
        assert e.value.reason == reason


def test_the_computed_reply_carries_the_moments_per_threshold(stores, x):
    path = stores["csc", "zarr"]
    request = gm.parse_request({"shape": "genes", "member": "t", "sets": {"t": _set(x.shape[0])}, "layer": "X",
                                "transform": "zscore", "thresholds": [0, 1]})
    plan = gm.plan(get_reader(path), path, request)
    mask = gm.mask_of(plan, None, None)
    result = [r for e, r in gm.compute(plan, mask) if e == "result"][0]
    assert result.moments.shape == (x.shape[1], 2, 5)
    np.testing.assert_allclose(result.moments[:, 0, :3], reference(x, mask, 10.0)[:, :3], rtol=1e-9, atol=1e-10)
