"""#57's cell subsets through #44's wire format: binary replies, the 413
size guard and ETags answer for the subset's cells, not the dataset's."""
import json

import numpy as np

from annzarro.tests.server.test_fast_transfer import N_OBS, N_VAR, _client, decode, ds, get  # noqa: F401

SUBSET = json.dumps({"n": 10, "seed": 1})


def _subset_rows(client, ds):
    """Dataset row of each subset cell, in subset order."""
    names = client.get("/api/v1/data/cells", query_string={"dataset_path": ds["path"], "subset": SUBSET}).get_json()["cells"]
    return [int(n[1:]) for n in names]  # cells are c0..c{N_OBS-1}


def test_binary_vectors_describe_the_subset(ds):
    client = _client(ds["tmp"])
    rows = _subset_rows(client, ds)
    assert len(rows) == 10
    col = get(client, "X", ds, cols="2", format="f32", subset=SUBSET)
    assert col.headers["X-Annzarro-Shape"] == "10,1"
    np.testing.assert_array_equal(decode(col)[:, 0], ds["X"][rows, 2])
    knn = get(client, "obsp/connectivities", ds, rows="3", format="f32", subset=SUBSET)
    assert knn.headers["X-Annzarro-Shape"] == "1,10"
    np.testing.assert_array_equal(decode(knn)[0], ds["knn"][rows[3], rows])
    score = get(client, "obs", ds, columns="pval", format="f32", subset=SUBSET)
    np.testing.assert_array_equal(decode(score), ds["pvals"][rows])


def test_size_guard_counts_subset_cells(ds):
    # 10 subset cells x 6 genes = 60 elements: over a limit of 50, though
    # the request names no rows; the dataset's 40 x 6 = 240 is not what is sent
    client = _client(ds["tmp"], max_response_elements=50)
    r = get(client, "layer/counts", ds, subset=SUBSET)
    assert r.status_code == 413
    assert r.get_json()["requested"] == 10 * N_VAR
    ok = _client(ds["tmp"], max_response_elements=60)
    assert get(ok, "layer/counts", ds, subset=SUBSET, format="f32").headers["X-Annzarro-Shape"] == f"10,{N_VAR}"


def test_etag_differs_by_subset(ds):
    client = _client(ds["tmp"])
    whole = get(client, "X", ds, cols="2", format="f32")
    part = get(client, "X", ds, cols="2", format="f32", subset=SUBSET)
    assert whole.headers["ETag"] and part.headers["ETag"] and whole.headers["ETag"] != part.headers["ETag"]
    again = client.get("/api/v1/data/X", headers={"If-None-Match": part.headers["ETag"]},
                       query_string={"dataset_path": ds["path"], "cols": "2", "format": "f32", "subset": SUBSET})
    assert again.status_code == 304
