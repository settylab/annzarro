"""A cell outside the subset, read by dataset row (``dataset_rows``).

A focused or locked cell from another part, or one a filter leaves out, is
still a cell of the dataset: its kNN row coloured over the cells shown and
its own expression row are meaningful. ``rows`` cannot name it (they are
positions among the cells shown), so the cell-axis routes take
``dataset_rows``, and /data/subset/locate and /data/names translate.

Every value of the store names the cell it belongs to, so each check is
exact: X[r, c] = r * N_VAR + c, the dense obsp ``dist`` holds
r * N_OBS + c, and the sparse ``knn`` (stored as CSR and as CSC) holds
r * N_OBS + c + 1 wherever (r + c) % 5 == 0.
"""
import json

import numpy as np
import pytest
import scipy.sparse as sp

from annzarro.core import subset as cell_subset
from annzarro.core import zarr_reader
from annzarro.server.core import create_app
from annzarro.tests.core.h5ad_twin import h5ad_twin
from annzarro.tests.server.test_fast_transfer import decode
from annzarro.tests.zarr_compat import open_group, write_array, write_strings

N_OBS, N_VAR = 50, 7
SPEC = {"n": 12, "seed": 4}

ROW_ID = np.arange(N_OBS)[:, None]
COL_ID = np.arange(N_OBS)[None, :]
DIST = (ROW_ID * N_OBS + COL_ID).astype(np.float32)
KNN = np.where((ROW_ID + COL_ID) % 5 == 0, DIST + 1, 0).astype(np.float32)
X = (ROW_ID * N_VAR + np.arange(N_VAR)[None, :]).astype(np.float32)


def _array(group, name, values):
    z = write_array(group, name, values)
    z.attrs.update({"encoding-type": "array", "encoding-version": "0.2.0"})
    return z


def _sparse(group, name, mat, encoding):
    g = group.create_group(name)
    g.attrs.update({"encoding-type": encoding, "encoding-version": "0.1.0", "shape": list(mat.shape)})
    for comp in ("data", "indices", "indptr"):
        write_array(g, comp, getattr(mat, comp))


def _dataframe(group, name, index, columns):
    g = group.create_group(name)
    g.attrs.update({"encoding-type": "dataframe", "encoding-version": "0.2.0",
                    "_index": "_index", "column-order": list(columns)})
    write_strings(g, "_index", index)
    for col, values in columns.items():
        _array(g, col, values)


def _make_store(path):
    root = open_group(path)
    root.attrs.update({"encoding-type": "anndata", "encoding-version": "0.1.0"})
    _array(root, "X", X)
    _array(root.create_group("layers"), "counts", X + 0.5)
    obsp = root.create_group("obsp")
    _array(obsp, "dist", DIST)
    _sparse(obsp, "knn_csr", sp.csr_matrix(KNN), "csr_matrix")
    _sparse(obsp, "knn_csc", sp.csc_matrix(KNN), "csc_matrix")
    _array(root.create_group("varp"), "corr", np.eye(N_VAR, dtype=np.float32))
    obsm = root.create_group("obsm")
    _array(obsm, "X_umap", np.stack([np.arange(N_OBS), -np.arange(N_OBS)], 1).astype(np.float32))
    _dataframe(root, "obs", [f"c{i}" for i in range(N_OBS)],
               {"score": np.arange(N_OBS, dtype=np.float64)})
    _dataframe(root, "var", [f"g{i}" for i in range(N_VAR)], {"mean": np.zeros(N_VAR)})
    return str(path)


@pytest.fixture(params=["zarr", "h5ad"])
def get(request, tmp_path):
    data = tmp_path / "data"
    path = _make_store(data / "focus.zarr")
    if request.param == "h5ad":
        path = h5ad_twin(path, data / "focus.h5ad")
    zarr_reader.clear_cache()
    cell_subset.clear()
    client = create_app({"TESTING": True, "host": "127.0.0.1", "data_dir": str(data),
                         "log_file": str(tmp_path / "t.log"), "auth_enabled": False}).test_client()

    def _get(url, subset=None, **query):
        query.setdefault("dataset_path", path)
        if subset is not None:
            query["subset"] = subset if isinstance(subset, str) else json.dumps(subset)
        return client.get(f"/api/v1/data/{url}", query_string=query)
    yield _get
    zarr_reader.clear_cache()
    cell_subset.clear()


def _ok(resp):
    assert resp.status_code == 200, resp.get_data(as_text=True)
    return resp


def _vector(resp):
    resp = _ok(resp)
    if resp.mimetype == "application/octet-stream":
        return decode(resp).ravel()
    return np.array(resp.get_json()["data"], dtype=float).ravel()


def _shown(get, spec=SPEC):
    """Dataset rows of the cells a subset shows, in order."""
    names = _ok(get("cells", subset=spec)).get_json()["cells"]
    return np.array([int(n[1:]) for n in names])


def _outside(rows):
    return [r for r in range(N_OBS) if r not in set(rows.tolist())]


@pytest.mark.parametrize("key", ["dist", "knn_csr", "knn_csc"])
@pytest.mark.parametrize("fmt", [None, "f32"])
def test_outside_cells_pairwise_row_is_cut_to_the_cells_shown(get, key, fmt):
    shown = _shown(get)
    extra = {"format": fmt} if fmt else {}
    full = DIST if key == "dist" else KNN
    for r in _outside(shown)[:4]:
        row = _vector(get(f"obsp/{key}", subset=SPEC, dataset_rows=str(r), **extra))
        assert row.tolist() == full[r, shown].tolist()


@pytest.mark.parametrize("fmt", [None, "f32"])
def test_outside_cells_expression_row_is_its_own(get, fmt):
    shown = _shown(get)
    extra = {"format": fmt} if fmt else {}
    r = _outside(shown)[0]
    assert _vector(get("layer/counts", subset=SPEC, dataset_rows=str(r), **extra)).tolist() == (X[r] + 0.5).tolist()
    assert _vector(get("X", subset=SPEC, dataset_rows=str(r), **extra)).tolist() == X[r].tolist()
    assert _vector(get("X", subset=SPEC, dataset_rows=str(r), cols="2,5", **extra)).tolist() == X[r, [2, 5]].tolist()
    umap = _vector(get("obsm/X_umap", subset=SPEC, dataset_rows=str(r), **extra))
    assert umap.tolist() == [r, -r]
    obs = _ok(get("obs", subset=SPEC, dataset_rows=str(r), columns="_index,score")).get_json()["data"]
    assert obs["_index"] == [f"c{r}"] and obs["score"] == [r]


@pytest.mark.parametrize("url,query", [
    ("obsp/knn_csr", {}), ("obsp/dist", {"format": "f32"}),
    ("layer/counts", {}), ("X", {"format": "f32"}), ("obsm/X_umap", {}),
])
def test_a_shown_cell_reads_the_same_by_position_and_by_dataset_row(get, url, query):
    shown = _shown(get)
    for pos in (0, 5, len(shown) - 1):
        by_pos = _ok(get(url, subset=SPEC, rows=str(pos), **query)).get_data()
        by_row = _ok(get(url, subset=SPEC, dataset_rows=str(shown[pos]), **query)).get_data()
        assert by_pos == by_row


def test_the_same_dataset_row_follows_each_parts_columns(get):
    parts = [dict(SPEC, part=p) for p in (0, 1)]
    r = int(_shown(get, parts[0])[3])     # shown in part 0, outside part 1
    for spec in parts:
        shown = _shown(get, spec)
        assert _vector(get("obsp/knn_csr", subset=spec, dataset_rows=str(r))).tolist() == KNN[r, shown].tolist()
    assert r not in _shown(get, parts[1]).tolist()


def test_a_cell_the_filter_leaves_out(get):
    spec = {"n": None, "seed": 0, "where": [{"col": "score", "op": ">=", "value": 30}]}
    shown = _shown(get, spec)
    assert shown.tolist() == list(range(30, N_OBS))
    assert _vector(get("obsp/dist", subset=spec, dataset_rows="3")).tolist() == DIST[3, 30:].tolist()
    assert _vector(get("layer/counts", subset=spec, dataset_rows="3")).tolist() == (X[3] + 0.5).tolist()


def test_without_a_subset_dataset_rows_are_rows(get):
    for url in ("obsp/knn_csc", "layer/counts", "X"):
        assert _ok(get(url, dataset_rows="7")).get_data() == _ok(get(url, rows="7")).get_data()


def test_obsp_columns_stay_positions_among_the_cells_shown(get):
    shown = _shown(get)
    r = _outside(shown)[0]
    row = _vector(get("obsp/dist", subset=SPEC, dataset_rows=str(r), cols="0,2"))
    assert row.tolist() == DIST[r, shown[[0, 2]]].tolist()
    resp = get("obsp/dist", subset=SPEC, dataset_rows=str(r), cols=str(len(shown)))
    assert resp.status_code == 400 and resp.get_json()["reason"] == "index_out_of_range"


def test_bad_dataset_rows_are_refused(get):
    def reason(resp, status=400):
        assert resp.status_code == status, resp.get_data(as_text=True)
        return resp.get_json()["reason"]
    assert reason(get("obsp/dist", subset=SPEC, dataset_rows=str(N_OBS))) == "index_out_of_range"
    assert reason(get("layer/counts", dataset_rows=str(N_OBS))) == "index_out_of_range"
    assert reason(get("obsp/dist", subset=SPEC, dataset_rows="-1")) == "bad_indices"
    assert reason(get("obsp/dist", subset=SPEC, dataset_rows="")) == "bad_indices"
    assert reason(get("X", subset=SPEC, rows="0", dataset_rows="1")) == "rows_conflict"
    for url in ("varp/corr", "var", "genes", "varm/x", "statistics", "paginated", "by_path"):
        assert reason(get(url, dataset_rows="1")) == "dataset_rows_unsupported", url
    # a dataset row past the SUBSET's length is fine: it is a row of the dataset
    assert len(_vector(get("X", subset=SPEC, dataset_rows=str(N_OBS - 1)))) == N_VAR


def test_dataset_rows_have_their_own_etag(get):
    shown = _shown(get)
    a = _ok(get("obsp/dist", subset=SPEC, rows="0"))
    b = _ok(get("obsp/dist", subset=SPEC, dataset_rows=str(shown[0])))
    assert a.get_data() == b.get_data()
    assert a.headers.get("ETag") and a.headers["ETag"] != b.headers["ETag"]


def test_locate_translates_both_ways(get):
    shown = _shown(get)
    out = _outside(shown)[:3]
    rows = _ok(get("subset/locate", subset=SPEC, rows="0,3,11")).get_json()
    assert rows == {"dataset_rows": shown[[0, 3, 11]].tolist()}
    query = [int(shown[3]), *out, int(shown[0])]
    back = _ok(get("subset/locate", subset=SPEC, dataset_rows=",".join(map(str, query)))).get_json()
    assert back == {"rows": [3, -1, -1, -1, 0]}
    # without a subset both directions are the identity
    assert _ok(get("subset/locate", dataset_rows="4,9")).get_json() == {"rows": [4, 9]}
    assert _ok(get("subset/locate", rows="4,9")).get_json() == {"dataset_rows": [4, 9]}


def test_locate_refuses_what_it_cannot_translate(get):
    def reason(resp):
        assert resp.status_code == 400, resp.get_data(as_text=True)
        return resp.get_json()["reason"]
    assert reason(get("subset/locate", subset=SPEC)) == "bad_indices"
    assert reason(get("subset/locate", subset=SPEC, rows=str(SPEC["n"]))) == "index_out_of_range"
    assert reason(get("subset/locate", subset=SPEC, dataset_rows=str(N_OBS))) == "index_out_of_range"
    assert reason(get("subset/locate", subset=SPEC, rows="0", dataset_rows="0")) == "rows_conflict"
    many = ",".join(["0"] * 1001)
    assert reason(get("subset/locate", subset=SPEC, dataset_rows=many)) == "cap_exceeded"


def test_subset_reply_lists_the_features(get):
    for subset in (SPEC, "all"):
        features = _ok(get("subset", subset=subset)).get_json()["features"]
        assert {"dataset_rows", "locate", "names_scope"} <= set(features)


def test_names_carry_the_dataset_row(get):
    shown = _shown(get)
    inside = f"c{shown[4]}"
    hit = _ok(get("names", subset=SPEC, entity="cells", q=inside, mode="exact")).get_json()
    assert hit["matches"] == [{"name": inside, "index": 4, "row": int(shown[4])}]
    whole = _ok(get("names", entity="cells", q="c7", mode="exact")).get_json()
    assert whole["matches"] == [{"name": "c7", "index": 7, "row": 7}]
    genes = _ok(get("names", subset=SPEC, entity="genes", q="g3", mode="exact")).get_json()
    assert genes["matches"] == [{"name": "g3", "index": 3, "row": 3}]


def test_dataset_scope_finds_cells_the_subset_does_not_show(get):
    shown = _shown(get)
    outside = _outside(shown)[0]
    q = f"c{outside}"
    assert _ok(get("names", subset=SPEC, entity="cells", q=q, mode="exact")).get_json()["matches"] == []
    found = _ok(get("names", subset=SPEC, entity="cells", q=q, mode="exact", scope="dataset")).get_json()
    assert found["matches"] == [{"name": q, "index": None, "row": outside}]
    assert found["total"] == N_OBS
    # a shown cell found dataset-wide keeps its position
    q = f"c{shown[2]}"
    found = _ok(get("names", subset=SPEC, entity="cells", q=q, mode="exact", scope="dataset")).get_json()
    assert found["matches"] == [{"name": q, "index": 2, "row": int(shown[2])}]
    # substring search: every match has its row, and a position exactly when shown
    some = _ok(get("names", subset=SPEC, entity="cells", q="c1", scope="dataset", limit=100)).get_json()
    assert some["matches"]
    for m in some["matches"]:
        assert m["name"] == f"c{m['row']}"
        assert m["index"] == (shown.tolist().index(m["row"]) if m["row"] in shown else None)
    resp = get("names", subset=SPEC, entity="cells", q="c1", scope="everywhere")
    assert resp.status_code == 400
