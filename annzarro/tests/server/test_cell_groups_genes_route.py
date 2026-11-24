"""POST /api/v1/data/cell_groups, ``shape: "genes"`` (SO-8a): the moments of every gene over one group of cells.

The arithmetic is the engine's (tests/core/test_gene_moments.py); these tests cover what the route adds: the reply
against NumPy for each layout and for zarr and h5ad, a table's bitset against the equivalent group, the estimate with
its chunk coverage (a scattered group is the whole layer, a contiguous one its chunks), the cost tiers (413, 409,
and the in-stream refusal of a grouping that was not resolved yet), the code cache, entries done within the estimate,
a subset, and the refusals of a malformed body.
"""
import functools
import json

import numpy as np
import pytest

from annzarro.core import cell_groups as cg
from annzarro.core import gene_moments as gm
from annzarro.core import zarr_reader
from annzarro.core import subset as cell_subset
from annzarro.server.core import create_app
from annzarro.server.routes import cell_groups as route
from annzarro.tests.core import grouping_store as gstore
from annzarro.tests.core.test_gene_moments import reference
from annzarro.tests.server.test_cell_groups_route import bitset, parse
from annzarro.tests.server.test_cell_groups_route import post as _post

N = gstore.N_OBS
CELL_TYPE = {"type": "obs", "key": "cell_type"}
SMALL_CHUNK = 4096                    # entries: the 1,200 x 40 matrices hold about 31,000, so about 8 chunks


@pytest.fixture(scope="module")
def data():
    return gstore.make_data()


@pytest.fixture(scope="module")
def layout(tmp_path_factory):
    base = tmp_path_factory.mktemp("cggenes")
    (base / "data").mkdir()
    for name, lay, backend in (("csc.zarr", "csc", "zarr"), ("csr.zarr", "csr", "zarr"),
                               ("dense.zarr", "dense", "zarr"), ("csc.h5ad", "csc", "h5ad"),
                               ("csr.h5ad", "csr", "h5ad"), ("dense.h5ad", "dense", "h5ad")):
        gstore.make_store(base / "data" / name, lay, backend)
    original = gstore._write_matrix
    gstore._write_matrix = functools.partial(original, chunks=SMALL_CHUNK)       # chunks of a few thousand entries
    try:
        gstore.make_store(base / "data" / "chunked_csr.zarr", "csr", "zarr")
        gstore.make_store(base / "data" / "chunked_csc.zarr", "csc", "zarr")
    finally:
        gstore._write_matrix = original
    gstore._write_matrix = functools.partial(original, chunks=400)               # dense: rows to a chunk
    try:
        gstore.make_store(base / "data" / "chunked_dense.zarr", "dense", "zarr")
    finally:
        gstore._write_matrix = original
    return base


@pytest.fixture(autouse=True)
def fresh():
    zarr_reader.clear_cache()
    cell_subset.clear()
    route.CODES.clear()
    yield
    zarr_reader.clear_cache()
    cell_subset.clear()
    route.CODES.clear()


@pytest.fixture
def client(layout, tmp_path):
    return create_app({"TESTING": True, "data_dir": str(layout / "data"),
                       "log_file": str(tmp_path / "t.log")}).test_client()


def post(client, layout, body, name="csc.zarr", **kw):
    return _post(client, layout, body, name=name, **kw)


def genes(**kw):
    return {"shape": "genes", "partitionings": [{"source": CELL_TYPE}], "group": ["c:B cell"], **kw}


def table(mask, **kw):
    return {"shape": "genes", "sets": {"t": bitset(mask)}, "member": "t", **kw}


def run(client, layout, body, name="csc.zarr"):
    resp = post(client, layout, body, name=name)
    assert resp.status_code == 200, resp.get_data(as_text=True)
    return parse(resp.get_data())


def estimate(client, layout, body, name="csc.zarr"):
    resp = post(client, layout, {**body, "estimate_only": True}, name=name)
    assert resp.status_code == 200, resp.get_data(as_text=True)
    return resp.get_json()["estimate"]


def cells(data, which="B cell"):
    return (data.obs["cell_type"] == which).to_numpy()


NAMES = ["csc.zarr", "csr.zarr", "dense.zarr", "csc.h5ad", "csr.h5ad", "dense.h5ad"]


# --- the reply -------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("name", NAMES)
@pytest.mark.parametrize("layer", ["X", "logged"])
def test_the_moments_of_a_group_equal_numpy_over_its_rows(client, layout, data, name, layer):
    frames, blocks = run(client, layout, genes(layer=layer, thresholds=[0, 0.3]), name=name)
    result = frames[-1]
    kinds = [f["type"] for f in frames]
    assert kinds[0] == "start" and kinds[-1] == "result" and set(kinds[1:-1]) == {"progress"}
    assert (result["shape"], result["n_shown"], result["n_group"], result["n_var"]) == ("genes", N, 500, gstore.N_VAR)
    assert result["moments"] == ["n", "sum", "sumsq", "n_above", "sum_above"]
    assert result["thresholds"] == [0, 0.3] and result["group"] == ["c:B cell"]
    assert result["blocks"] == [{"name": "moments", "dtype": "float64", "shape": [gstore.N_VAR, 10]}]
    got = blocks["moments"].reshape(gstore.N_VAR, 2, 5)
    np.testing.assert_allclose(got, reference(data.layer(layer), cells(data), [0, 0.3]), rtol=1e-9, atol=1e-9)
    assert frames[0]["codes"] == "miss" and frames[0]["lane"] in ("light", "heavy")


def test_a_second_request_finds_its_grouping_in_the_code_cache(client, layout):
    assert run(client, layout, genes())[0][0]["codes"] == "miss"
    frames, _ = run(client, layout, genes(group=["c:T cell"]))             # another group of the same grouping
    assert frames[0]["codes"] == "hit"


@pytest.mark.parametrize("name", ["csc.zarr", "csr.zarr", "dense.h5ad", "csr.h5ad"])
def test_a_tables_bitset_gives_the_moments_of_the_equivalent_group(client, layout, data, name):
    by_group = run(client, layout, genes(layer="logged", thresholds=[0, 1.0]), name=name)
    by_table = run(client, layout, table(cells(data), layer="logged", thresholds=[0, 1.0]), name=name)
    assert np.array_equal(by_group[1]["moments"], by_table[1]["moments"])
    start = by_table[0][0]
    assert start["type"] == "start" and "codes" not in start          # a table's cells resolve nothing
    assert by_table[0][-1]["group"] is None and by_table[0][-1]["n_group"] == 500



# --- the estimate ----------------------------------------------------------------------------------------------

def test_the_estimate_of_a_group_not_yet_resolved_is_the_whole_layer(client, layout):
    est = estimate(client, layout, genes(), name="chunked_csr.zarr")
    cover = est["coverage"]
    assert cover["known"] is False and cover["entries"] == cover["layer_entries"] and cover["fraction"] == 1.0
    assert est["entries"] == cover["entries"] and est["layout"] == "csr" and est["n_var"] == gstore.N_VAR
    assert {"seconds", "tier", "live_max_s", "auto_max_s", "max_s", "lane", "n_cells"} <= set(est)


def test_the_estimate_of_a_cached_grouping_is_exact(client, layout, data):
    run(client, layout, genes(), name="chunked_csr.zarr")                   # resolves and keeps the grouping
    est = estimate(client, layout, genes(), name="chunked_csr.zarr")
    cover = est["coverage"]
    assert cover["known"] is True and cover["n_group"] == 500
    assert estimate(client, layout, genes(group=["c:Platelet"]), name="chunked_csr.zarr")["coverage"]["n_group"] == 5


@pytest.mark.parametrize("name,total", [("chunked_csr.zarr", None), ("chunked_csc.zarr", None),
                                         ("chunked_dense.zarr", N * gstore.N_VAR)])
def test_a_scattered_group_covers_the_whole_layer_and_a_contiguous_one_its_chunks(client, layout, name, total):
    every_hundredth = np.zeros(N, dtype=bool)
    every_hundredth[::100] = True                                         # 1 % of the cells, in every chunk
    every_hundredth[-1] = True                                            # the last chunk too
    head = np.zeros(N, dtype=bool)
    head[:100] = True
    scattered = estimate(client, layout, table(every_hundredth), name=name)["coverage"]
    contiguous = estimate(client, layout, table(head), name=name)["coverage"]
    assert scattered["known"] and scattered["entries"] == scattered["layer_entries"] and scattered["fraction"] == 1.0
    if total is not None:
        assert scattered["layer_entries"] == total
    assert scattered["n_group"] == 13 and contiguous["n_group"] == 100
    if name == "chunked_csc.zarr":                                        # a CSC matrix is read whole
        assert contiguous["entries"] == contiguous["layer_entries"]
    else:
        assert 0 < contiguous["entries"] < contiguous["layer_entries"] / 2
    if name == "chunked_csr.zarr":
        assert contiguous["entries"] == SMALL_CHUNK                      # 100 cells hold about 2,600 entries: one chunk
    if name == "chunked_dense.zarr":
        assert contiguous["entries"] == 400 * gstore.N_VAR                # one chunk of 400 rows


def test_the_lane_is_light_inside_the_live_tier_without_a_whole_matrix_read(client, layout):
    head = np.zeros(N, dtype=bool)
    head[:100] = True
    assert estimate(client, layout, table(head), name="chunked_csr.zarr")["lane"] == "light"
    scattered = np.zeros(N, dtype=bool)
    scattered[::100] = True
    scattered[-1] = True
    assert estimate(client, layout, table(scattered), name="chunked_csr.zarr")["lane"] == "heavy"
    assert estimate(client, layout, table(head), name="chunked_csc.zarr")["lane"] == "heavy"


def test_estimate_only_reads_no_gene(client, layout, data, monkeypatch):
    monkeypatch.setattr(gm, "compute", lambda *a, **k: pytest.fail("estimate_only computed"))
    est = estimate(client, layout, table(cells(data)), name="chunked_csr.zarr")
    assert est["coverage"]["known"] is True


# --- progress and entries ----------------------------------------------------------------------------------------

@pytest.mark.parametrize("name", ["chunked_csr.zarr", "chunked_csc.zarr", "chunked_dense.zarr", "csr.h5ad"])
def test_entries_done_stay_within_the_estimate_and_end_at_it(client, layout, data, name):
    body = table(cells(data, "T cell"))
    est = estimate(client, layout, body, name=name)
    frames, _ = run(client, layout, body, name=name)
    progress = [f for f in frames if f["type"] == "progress"]
    assert progress and all(f["stage"] == "genes" for f in progress)
    done = [f["entries_done"] for f in progress]
    assert done == sorted(done) and done[0] == 0 and done[-1] <= est["entries"]
    assert all(f["entries_total"] == est["entries"] for f in progress) and frames[0]["entries_total"] == est["entries"]
    assert frames[-1]["estimate"]["entries"] == est["entries"]


def test_a_grouping_that_misses_reports_its_resolve_and_then_the_genes(client, layout):
    frames, _ = run(client, layout, genes(), name="chunked_csr.zarr")
    stages = [f["stage"] for f in frames if f["type"] == "progress"]
    assert stages[0] == "groups" and stages[-1] == "genes" and stages.index("genes") > stages.index("groups")
    done = [f["entries_done"] for f in frames if f["type"] == "progress"]
    assert done == sorted(done) and done[-1] <= frames[0]["entries_total"]


# --- the cost tiers ---------------------------------------------------------------------------------------------

def test_a_known_estimate_above_refuse_s_is_refused_before_the_stream(client, layout, data, monkeypatch):
    monkeypatch.setattr(gm, "ASK_FIRST_S", 0.01)
    monkeypatch.setattr(gm, "REFUSE_S", 0.1)                              # the fixed cost alone is 0.2 s
    resp = post(client, layout, table(cells(data)), name="csr.zarr")
    body = resp.get_json()
    assert resp.status_code == 413 and body["reason"] == "groups_too_expensive"
    assert body["estimate"]["tier"] == "refused" and "subset" in body["error"]
    assert estimate(client, layout, table(cells(data)), name="csr.zarr")["tier"] == "refused"
    assert estimate(client, layout, table(cells(data)), name="csr.zarr")["max_s"] == 0.1


def test_confirm_is_asked_for_and_then_computes(client, layout, data, monkeypatch):
    monkeypatch.setattr(gm, "ASK_FIRST_S", 0.01)
    monkeypatch.setattr(gm, "REFUSE_S", 600.0)
    resp = post(client, layout, table(cells(data)), name="csr.zarr")
    assert resp.status_code == 409 and resp.get_json()["reason"] == "confirmation_required"
    assert resp.get_json()["estimate"]["tier"] == "confirm"
    frames, blocks = run(client, layout, table(cells(data), confirm=True), name="csr.zarr")
    assert frames[-1]["type"] == "result" and blocks["moments"].shape == (gstore.N_VAR, 5)


def test_a_grouping_not_yet_resolved_is_judged_when_its_group_is_known(client, layout, monkeypatch):
    """The first request cannot know its cells: it resolves the grouping, then refuses in the stream; the grouping is
    kept, so the same request now answers before the stream."""
    monkeypatch.setattr(gm, "ASK_FIRST_S", 0.01)
    monkeypatch.setattr(gm, "REFUSE_S", 0.1)
    frames, blocks = run(client, layout, genes(), name="csr.zarr")
    refused = frames[-1]["refused"]
    assert frames[-1]["type"] == "result" and blocks == {} and refused["reason"] == "groups_too_expensive"
    assert refused["tier"] == "refused" and refused["limit"] == 0.1 and refused["estimate"]["coverage"]["known"]
    assert frames[0]["codes"] == "miss"
    resp = post(client, layout, genes(), name="csr.zarr")
    assert resp.status_code == 413 and resp.get_json()["reason"] == "groups_too_expensive"


def test_confirmation_for_a_grouping_not_yet_resolved_is_a_frame_then_computes(client, layout, monkeypatch):
    monkeypatch.setattr(gm, "ASK_FIRST_S", 0.01)
    monkeypatch.setattr(gm, "REFUSE_S", 600.0)
    frames, _ = run(client, layout, genes(), name="csr.zarr")
    assert frames[-1]["refused"]["reason"] == "confirmation_required"
    assert post(client, layout, genes(), name="csr.zarr").status_code == 409
    frames, blocks = run(client, layout, genes(confirm=True), name="csr.zarr")
    assert frames[-1]["type"] == "result" and frames[0]["codes"] == "hit" and "moments" in blocks


# --- subset and refusals -------------------------------------------------------------------------------------------

SUBSET = {"n": 600, "seed": 5}


@pytest.mark.parametrize("subset", [SUBSET, json.dumps(SUBSET)])
def test_a_group_shown_through_a_subset_counts_only_the_cells_shown(client, layout, data, subset):
    """``subset`` is the grouping's: the group is of the cells shown, and the moments are over those cells."""
    rows, _ = cell_subset.select_indices(N, cell_subset.parse_spec(SUBSET), None)
    mask = cells(data).copy()
    mask[np.setdiff1d(np.arange(N), rows)] = False
    frames, blocks = run(client, layout, genes(layer="logged", subset=subset))
    assert frames[-1]["n_shown"] == 600 and frames[-1]["n_group"] == mask.sum() > 0
    np.testing.assert_allclose(blocks["moments"].reshape(gstore.N_VAR, 1, 5), reference(data.logged, mask, [0]),
                               rtol=1e-9, atol=1e-9)
    # a table over the cells shown is of their length, and gives the same moments
    on_shown = np.isin(np.arange(N), rows)[rows] & cells(data)[rows]
    by_table = run(client, layout, table(on_shown, layer="logged", subset=subset))[1]["moments"]
    assert np.array_equal(by_table, blocks["moments"])


@pytest.mark.parametrize("body,status,reason", [
    (genes(layer="nope"), 404, "key_not_found"),
    ({"shape": "genes"}, 400, "bad_request"),
    (genes(member="t", sets={"t": {"encoding": "bitset-base64", "length": 8, "data": "AQ=="}}), 400, "bad_request"),
    (genes(features=[]), 400, "unknown_field"),
    (genes(want={"codes": True}), 400, "unknown_field"),
    (genes(thresholds=[0, 0]), 400, "bad_threshold"),
    (genes(thresholds=list(range(gm.MAX_THRESHOLDS + 1))), 422, "too_many_thresholds"),
    (genes(unknown=1), 400, "bad_request"),
])
def test_a_malformed_request_is_refused_before_the_stream(client, layout, body, status, reason):
    resp = post(client, layout, body)
    assert resp.status_code == status and resp.get_json()["reason"] == reason


def test_a_set_of_the_wrong_length_is_refused(client, layout):
    resp = post(client, layout, table(np.ones(N - 1, dtype=bool)))
    assert resp.status_code == 400 and resp.get_json()["reason"] == "set_length_mismatch"


def test_the_genes_shape_is_behind_the_dataset_gate(client, layout):
    resp = client.post("/api/v1/data/cell_groups", data="{}", content_type="application/json")
    assert resp.status_code in (400, 401, 403)


def test_a_cached_grouping_is_unpinned_after_every_way_a_request_ends(client, layout, monkeypatch):
    run(client, layout, genes(), name="csr.zarr")                         # cached
    unpinned = []
    real = route.CODES.unpin
    monkeypatch.setattr(route.CODES, "unpin", lambda key: (unpinned.append(key), real(key))[1])
    estimate(client, layout, genes(), name="csr.zarr")                    # estimate_only
    post(client, layout, genes(group=["c:Nobody"]), name="csr.zarr")      # a refusal
    run(client, layout, genes(), name="csr.zarr")                         # a run
    assert len(unpinned) == 3
    assert not route.CODES._pins if hasattr(route.CODES, "_pins") else True


def test_the_reservation_counts_the_mask_the_accumulators_and_the_read_ahead(layout):
    from annzarro.core import get_reader
    path = str(layout / "data" / "csr.zarr")
    plan = gm.plan(get_reader(path), path, gm.parse_request(genes(thresholds=[0, 1])))
    full, keep = route.genes_reservation(plan, N, cover_entries=10 ** 9, codes_held=True)
    held = N + 8 * gstore.N_VAR * (4 + 2 * 2 + 5 * 2)
    assert keep == held
    assert full == held + 12 * gm.READ_AHEAD_ENTRIES + route._SEGMENT_TEMPORARIES + route.HIT_MARGIN_BYTES
    small_full, _ = route.genes_reservation(plan, N, cover_entries=1000, codes_held=True)
    assert small_full == held + 12 * 1000 + route._SEGMENT_TEMPORARIES + route.HIT_MARGIN_BYTES
    miss_full, miss_keep = route.genes_reservation(plan, N, cover_entries=1000, codes_held=False)
    assert miss_full > small_full and miss_keep > keep                    # a resolve's own bytes come on top


def test_a_group_the_grouping_does_not_have_is_a_422_when_known_and_an_error_frame_when_it_is_resolved_here(
        client, layout):
    frames, blocks = run(client, layout, genes(group=["c:Nobody"]))        # a miss: the grouping is resolved in the stream
    assert frames[-1]["type"] == "error" and frames[-1]["reason"] == "group_missing" and blocks == {}
    resp = post(client, layout, genes(group=["c:Nobody"]))                 # now a hit: refused before the stream
    assert resp.status_code == 422 and resp.get_json()["reason"] == "group_missing"
