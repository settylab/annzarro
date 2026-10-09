"""A boolean obs column is served with categories [false, true] (nexus #407).

A boolean column is stored as plain values, so it came without categories and
the client ordered them by first appearance; the ``uns/<col>_colors`` pair
scanpy/pandas write is aligned to pandas' Categorical order, [False, True]
(scanpy's own plots fix ("False", "True") too, scanpy/plotting/_tools/
scatterplots.py ``_get_palette``). In a dataset whose first cell is True the
True cells got the False colour.

What must hold, from zarr and h5ad, with and without a subset: both
categories are served in that order whatever the first value is, also for a
column of only True; a nullable boolean column is the same; other columns
(float, string, categorical) are served as before.
"""
import numpy as np
import pytest

from annzarro.core import subset as cell_subset
from annzarro.core import zarr_reader, h5ad_reader_obj
from annzarro.server.core import create_app
from annzarro.tests.server.test_obs_numeric_fast import _nullable
from annzarro.tests.zarr_compat import open_group, write_array, write_strings

N = 40
COLUMNS = {
    "first_true": np.arange(N) % 3 != 1,          # starts True
    "first_false": np.arange(N) % 3 == 1,
    "all_true": np.ones(N, dtype=bool),
    "all_false": np.zeros(N, dtype=bool),
}
BOOL_COLUMNS = [*COLUMNS, "nullable"]
assert COLUMNS["first_true"][0] and not COLUMNS["first_false"][0]


def _zarr(path):
    root = open_group(path)
    root.attrs.update({"encoding-type": "anndata", "encoding-version": "0.1.0"})
    x = write_array(root, "X", np.zeros((N, 2), dtype=np.float32))
    x.attrs.update({"encoding-type": "array", "encoding-version": "0.2.0"})
    g = root.create_group("obs")
    g.attrs.update({"encoding-type": "dataframe", "encoding-version": "0.2.0", "_index": "_index",
                    "column-order": []})
    write_strings(g, "_index", [f"c{i}" for i in range(N)])
    for k, v in COLUMNS.items():
        write_array(g, k, v).attrs.update({"encoding-type": "array", "encoding-version": "0.2.0"})
    mask = np.zeros(N, dtype=bool)
    mask[1] = True
    ng = g.create_group("nullable")
    ng.attrs.update({"encoding-type": "nullable-boolean", "encoding-version": "0.1.0"})
    write_array(ng, "values", COLUMNS["first_true"])
    write_array(ng, "mask", mask)
    write_array(g, "score", np.linspace(0, 1, N).astype(np.float32)).attrs.update(
        {"encoding-type": "array", "encoding-version": "0.2.0"})
    write_strings(g, "label", [f"l{i % 2}" for i in range(N)])


def _h5ad(path):
    import h5py
    with h5py.File(path, "w") as f:
        f.attrs.update({"encoding-type": "anndata", "encoding-version": "0.1.0"})
        f.create_dataset("X", data=np.zeros((N, 2), dtype=np.float32))
        g = f.create_group("obs")
        g.attrs.update({"encoding-type": "dataframe", "encoding-version": "0.2.0", "_index": "_index",
                        "column-order": []})
        g.create_dataset("_index", data=np.array([f"c{i}" for i in range(N)], dtype=object),
                         dtype=h5py.string_dtype())
        for k, v in COLUMNS.items():
            g.create_dataset(k, data=v)
        ng = g.create_group("nullable")
        ng.attrs.update({"encoding-type": "nullable-boolean", "encoding-version": "0.1.0"})
        ng.create_dataset("values", data=COLUMNS["first_true"])
        mask = np.zeros(N, dtype=bool)
        mask[1] = True
        ng.create_dataset("mask", data=mask)
        g.create_dataset("score", data=np.linspace(0, 1, N).astype(np.float32))
        g.create_dataset("label", data=np.array([f"l{i % 2}" for i in range(N)], dtype=object),
                         dtype=h5py.string_dtype())


@pytest.fixture
def stores(tmp_path):
    zarr_reader.clear_cache()
    h5ad_reader_obj.clear_cache()
    cell_subset.clear()
    data = tmp_path / "data"
    data.mkdir()
    z, h = str(data / "a.zarr"), str(data / "a.h5ad")
    _zarr(z)
    _h5ad(h)
    client = create_app({"TESTING": True, "data_dir": str(data), "log_file": str(tmp_path / "t.log"),
                         "auth_enabled": False}).test_client()
    yield client, z, h
    zarr_reader.clear_cache()
    h5ad_reader_obj.clear_cache()
    cell_subset.clear()


def _obs(client, path, columns, **extra):
    r = client.get("/api/v1/data/obs", query_string={"dataset_path": path, "columns": columns, **extra})
    assert r.status_code == 200, r.get_data()[:300]
    return r.get_json()


@pytest.mark.parametrize("store", [1, 2], ids=["zarr", "h5ad"])
@pytest.mark.parametrize("column", BOOL_COLUMNS)
def test_a_boolean_column_is_served_with_false_then_true(stores, store, column):
    client = stores[0]
    body = _obs(client, stores[store], column)
    assert body["categories"][column] == [False, True]
    assert all(v is None or isinstance(v, bool) for v in body["data"][column])


@pytest.mark.parametrize("store", [1, 2], ids=["zarr", "h5ad"])
def test_both_categories_are_served_for_a_subset_of_one_value(stores, store):
    """Rows 0 and 3 of first_true are both True: True must still be the second."""
    client = stores[0]
    body = _obs(client, stores[store], "first_true", rows="0,3")
    assert body["data"]["first_true"] == [True, True]
    assert body["categories"]["first_true"] == [False, True]


@pytest.mark.parametrize("store", [1, 2], ids=["zarr", "h5ad"])
def test_other_columns_are_served_as_before(stores, store):
    client = stores[0]
    body = _obs(client, stores[store], "score,label")
    assert "score" not in body.get("categories", {})
    assert "label" not in body.get("categories", {})


@pytest.mark.parametrize("store", [1, 2], ids=["zarr", "h5ad"])
def test_no_categories_are_added_when_the_client_declined_them(stores, store):
    client = stores[0]
    body = _obs(client, stores[store], "first_true", include_categories="false")
    assert "first_true" not in body.get("categories", {})
