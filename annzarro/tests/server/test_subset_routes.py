"""
A cell subset is the same cells in every response.

The core invariant of subsetting (issues #7, #14): if the embedding shows a
subset of cells, the obs column colouring it, the expression vector, the
kNN row and the name list are for exactly those cells, in the same order.
The rich store makes this checkable value by value: its layer ``counts``
holds ``row * N_VAR + col``, so every number names the dataset row it came
from.
"""
import json

import numpy as np
import pytest

from annzarro.core import subset as cell_subset
from annzarro.core import zarr_reader
from annzarro.server.core import create_app
from annzarro.tests.server.rich_store import N_OBS, N_VAR, make_rich_store

SPEC = {"n": 37, "seed": 5}


@pytest.fixture
def get(tmp_path):
    path = make_rich_store(tmp_path / "rich.zarr")
    zarr_reader.clear_cache()
    cell_subset.clear()
    client = create_app({"TESTING": True, "data_dir": str(tmp_path),
                         "log_file": str(tmp_path / "l.log")}).test_client()

    def _get(url, subset=None, **query):
        query.setdefault("dataset_path", path)
        if subset is not None:
            query["subset"] = subset if isinstance(subset, str) else json.dumps(subset)
        resp = client.get(url, query_string=query)
        return resp
    yield _get
    zarr_reader.clear_cache()
    cell_subset.clear()


def _ok(resp):
    assert resp.status_code == 200, resp.get_data(as_text=True)
    return resp.get_json()


def _rows(get, spec=SPEC):
    """Dataset rows of the subset, from its cell names."""
    all_names = _ok(get("/api/v1/data/cells"))["cells"]
    names = _ok(get("/api/v1/data/cells", subset=spec))["cells"]
    position = {name: i for i, name in enumerate(all_names)}
    return np.array([position[n] for n in names])


def test_subset_names_are_the_selected_rows_in_dataset_order(get):
    rows = _rows(get)
    expected, _ = cell_subset.select_indices(N_OBS, cell_subset.parse_spec(SPEC), None)
    assert rows.tolist() == expected.tolist()


def test_every_modality_describes_the_same_cells(get):
    rows = _rows(get)
    n = len(rows)
    assert n == SPEC["n"]

    full_obs = _ok(get("/api/v1/data/obs", columns="leiden,total_counts"))["data"]
    sub_obs = _ok(get("/api/v1/data/obs", subset=SPEC, columns="leiden,total_counts"))["data"]
    for col in ("leiden", "total_counts"):
        assert sub_obs[col] == [full_obs[col][r] for r in rows], col

    full_umap = np.array(_ok(get("/api/v1/data/obsm/X_umap"))["data"])
    sub_umap = np.array(_ok(get("/api/v1/data/obsm/X_umap", subset=SPEC))["data"])
    assert np.array_equal(sub_umap, full_umap[rows])

    one_axis = _ok(get("/api/v1/data/obsm/X_umap", subset=SPEC, column_name="1"))["data"]
    assert np.allclose(one_axis, full_umap[rows, 1])

    # gene column: one value per subset cell, and each value names its row
    gene = 3
    layer = np.array(_ok(get("/api/v1/data/layer/counts", subset=SPEC, cols=str(gene)))["data"]).ravel()
    assert layer.tolist() == [r * N_VAR + gene for r in rows]

    full_x = np.array(_ok(get("/api/v1/data/X", cols=str(gene)))["data"]).ravel()
    sub_x = np.array(_ok(get("/api/v1/data/X", subset=SPEC, cols=str(gene)))["data"]).ravel()
    assert np.array_equal(sub_x, full_x[rows])


def test_cell_positions_in_a_request_are_subset_positions(get):
    rows = _rows(get)
    for pos in (0, 7, len(rows) - 1):
        cell_row = _ok(get("/api/v1/data/layer/counts", subset=SPEC, rows=str(pos)))["data"]
        assert np.array(cell_row).ravel().tolist() == [rows[pos] * N_VAR + j for j in range(N_VAR)]
        obs = _ok(get("/api/v1/data/obs", subset=SPEC, rows=str(pos), columns="total_counts"))["data"]
        full = _ok(get("/api/v1/data/obs", rows=str(rows[pos]), columns="total_counts"))["data"]
        assert obs == full


def test_pairwise_row_is_cut_to_the_subset_columns(get):
    rows = _rows(get)
    pos = 4
    row = np.array(_ok(get("/api/v1/data/obsp/conn", subset=SPEC, rows=str(pos)))["data"]).ravel()
    # conn is the identity: the focused cell's own column is the only 1
    assert len(row) == len(rows)
    assert np.flatnonzero(row).tolist() == [pos]


def test_positions_past_the_subset_are_refused(get):
    n = SPEC["n"]
    for url, query in (("/api/v1/data/layer/counts", {"rows": str(n)}),
                       ("/api/v1/data/obs", {"rows": str(n), "columns": "leiden"}),
                       ("/api/v1/data/obsm/X_umap", {"rows": str(n)}),
                       ("/api/v1/data/obsp/conn", {"rows": "0", "cols": str(n)})):
        resp = get(url, subset=SPEC, **query)
        assert resp.status_code == 400, (url, resp.get_data(as_text=True))
        assert resp.get_json()["reason"] == "index_out_of_range"


def test_structure_and_info_report_the_subset(get):
    structure = _ok(get("/api/v1/data/dataset_structure", subset=SPEC))
    assert structure["n_obs"] == SPEC["n"] and structure["n_vars"] == N_VAR
    assert _ok(get("/api/v1/data/dataset_structure"))["n_obs"] == N_OBS

    info = _ok(get("/api/v1/data/subset", subset=SPEC))
    assert info["n"] == SPEC["n"] and info["n_total"] == N_OBS and info["n_eligible"] == N_OBS
    assert json.loads(info["key"]) == {"n": 37, "seed": 5}
    assert set(info["defaults"]) == {"threshold", "size", "seed"}


def test_auto_and_all_keep_a_small_dataset_whole(get):
    for raw in ("auto", "all"):
        info = _ok(get("/api/v1/data/subset", subset=raw))
        assert info["subset"] is None and info["key"] is None and info["n"] == N_OBS
        assert len(_ok(get("/api/v1/data/cells", subset=raw))["cells"]) == N_OBS


def test_auto_subsets_above_the_configured_threshold(tmp_path):
    path = make_rich_store(tmp_path / "rich.zarr")
    zarr_reader.clear_cache()
    cell_subset.clear()
    client = create_app({"TESTING": True, "data_dir": str(tmp_path), "log_file": str(tmp_path / "l.log"),
                         "ui_subset_threshold": 100, "ui_subset_size": 50, "ui_subset_seed": 2}).test_client()
    info = client.get("/api/v1/data/subset", query_string={"dataset_path": path, "subset": "auto"}).get_json()
    assert info["subset"] == {"n": 50, "seed": 2} and info["n"] == 50
    assert info["defaults"] == {"threshold": 100, "size": 50, "seed": 2}


def test_filtered_subset(get):
    spec = {"n": None, "seed": 0, "where": [{"col": "cell_type", "op": "in", "values": ["Kupffer"]}]}
    cell_types = _ok(get("/api/v1/data/obs", columns="cell_type"))["data"]["cell_type"]
    info = _ok(get("/api/v1/data/subset", subset=spec))
    expected = [i for i, t in enumerate(cell_types) if t == "Kupffer"]
    assert info["n"] == info["n_eligible"] == len(expected) > 0
    assert _rows(get, spec).tolist() == expected
    sub = _ok(get("/api/v1/data/obs", subset=spec, columns="cell_type"))["data"]["cell_type"]
    assert set(sub) == {"Kupffer"}


def test_balanced_subset_reports_groups(get):
    spec = {"n": 40, "seed": 1, "balance": "cell_type"}
    info = _ok(get("/api/v1/data/subset", subset=spec))
    assert info["n"] == 40
    shown = [g["shown"] for g in info["groups"].values()]
    assert max(shown) - min(shown) <= 1 or min(g["total"] for g in info["groups"].values()) < 40 // len(shown)


def test_name_search_is_within_the_subset(get):
    rows = _rows(get)
    all_names = _ok(get("/api/v1/data/cells"))["cells"]
    inside, outside = all_names[rows[3]], all_names[next(r for r in range(N_OBS) if r not in set(rows))]
    hit = _ok(get("/api/v1/data/names", subset=SPEC, entity="cells", q=inside, mode="exact"))
    assert hit["matches"] == [{"name": inside, "index": 3, "row": int(rows[3])}] and hit["total"] == SPEC["n"]
    miss = _ok(get("/api/v1/data/names", subset=SPEC, entity="cells", q=outside, mode="exact"))
    assert miss["matches"] == []
    # genes are not subset
    genes = _ok(get("/api/v1/data/names", subset=SPEC, entity="genes", q=""))
    assert genes["total"] == N_VAR


def test_gene_axis_routes_ignore_the_subset(get):
    for url in ("/api/v1/data/var", "/api/v1/data/genes", "/api/v1/data/varp/corr"):
        assert _ok(get(url, subset=SPEC)) == _ok(get(url)), url


@pytest.mark.parametrize("url", ["/api/v1/data/paginated", "/api/v1/data/statistics",
                                 "/api/v1/data/by_path"])
def test_routes_that_cannot_apply_a_subset_refuse_it(get, url):
    resp = get(url, subset=SPEC, rows="0", path="X", matrix_type="X")
    assert resp.status_code == 400
    assert resp.get_json()["reason"] == "subset_unsupported"


@pytest.mark.parametrize("raw,status,reason", [
    ("{not json", 400, "bad_subset"),
    ('{"n": 0}', 400, "bad_subset"),
    ('{"n": 5, "where": [{"col": "nope", "op": "in", "values": ["a"]}]}', 404, "key_not_found"),
    ('{"n": 5, "balance": "nope"}', 404, "key_not_found"),
])
def test_bad_subset_is_an_error_not_all_cells(get, raw, status, reason):
    for url in ("/api/v1/data/cells", "/api/v1/data/obsm/X_umap", "/api/v1/data/subset"):
        resp = get(url, subset=raw)
        assert resp.status_code == status, (url, resp.get_data(as_text=True))
        assert resp.get_json()["reason"] == reason
