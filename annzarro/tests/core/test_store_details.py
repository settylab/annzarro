"""store_details.describe_store: columns, obsm keys, layers and uns from metadata alone, for every store format."""
import os

import h5py
import pytest
import zarr

from annzarro.core import store_details
from annzarro.tests.core.h5ad_twin import h5ad_twin
from annzarro.tests.core.test_store_check import new_store

DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
FIXTURE = os.path.join(DATA, "fixture_small.zarr")
FIXTURE_V3 = os.path.join(DATA, "fixture_small_v3.zarr")
ZARR3 = int(zarr.__version__.split(".")[0]) >= 3

EXPECTED_OBS = {"cell_type": "categorical", "leiden": "categorical", "total_counts": "float"}


def kinds(columns):
    return {c["name"]: c["kind"] for c in columns}


@pytest.mark.parametrize("path, fmt", [
    (FIXTURE, 2),
    pytest.param(FIXTURE_V3, 3, marks=pytest.mark.skipif(not ZARR3, reason="format 3 needs zarr >= 3")),
])
def test_zarr_stores(path, fmt):
    info = store_details.describe_store(path)
    assert info["zarr_format"] == fmt
    assert kinds(info["obs_columns"]) == EXPECTED_OBS and info["obs_columns_total"] == 3
    assert kinds(info["var_columns"]) == {"gene_name": "string"}
    assert info["obsm_keys"] == ["X_umap"] and info["layers_keys"] == [] and info["uns_count"] == 0


def test_the_index_is_not_a_column_and_column_order_is_anndatas():
    info = store_details.describe_store(FIXTURE)
    assert "_index" not in kinds(info["obs_columns"])
    order = list(zarr.open_group(FIXTURE, mode="r")["obs"].attrs["column-order"])
    assert [c["name"] for c in info["obs_columns"]] == order


def test_h5ad_matches_its_zarr_twin(tmp_path):
    twin = h5ad_twin(FIXTURE, tmp_path / "t.h5ad")
    assert store_details.describe_store(twin) == {k: v for k, v in store_details.describe_store(FIXTURE).items()
                                                   if k != "zarr_format"}


@pytest.mark.skipif(not ZARR3, reason="sharding needs zarr >= 3")
def test_sharded_store(tmp_path):
    root = new_store(tmp_path / "s.zarr", 3, n_obs=2000, n_vars=50, x="dense")
    root.create_array("layers/counts", shape=(2000, 50), dtype="float32", chunks=(100, 50), shards=(1000, 50))
    info = store_details.describe_store(str(tmp_path / "s.zarr"))
    assert info["zarr_format"] == 3 and info["layers_keys"] == ["counts"] and info["obsm_keys"] == ["X_umap"]


def test_names_are_capped_and_counted(monkeypatch):
    monkeypatch.setattr(store_details, "MAX_NAMES", 1)
    info = store_details.describe_store(FIXTURE)
    assert len(info["obs_columns"]) == 1 and info["obs_columns_total"] == 3


def test_no_array_is_read(monkeypatch):
    def refuse(*a, **k):
        raise AssertionError("an array was read")
    monkeypatch.setattr(zarr.Array, "__getitem__", refuse)
    monkeypatch.setattr(zarr.Array, "get_basic_selection", refuse, raising=False)
    assert store_details.describe_store(FIXTURE)["obs_columns"]


def test_counts_from_root_use_the_index_lengths_without_reading_x():
    assert store_details.counts_from_root(zarr.open_group(FIXTURE, mode="r")) == {"cells": 200, "genes": 20}


def test_what_is_not_anndata_is_refused_with_a_reason(tmp_path):
    (tmp_path / "empty.zarr").mkdir()
    with pytest.raises(store_details.StoreDetailsError):
        store_details.describe_store(str(tmp_path / "empty.zarr"))
    (tmp_path / "x.txt").write_text("x")
    with pytest.raises(store_details.StoreDetailsError, match="not an .h5ad"):
        store_details.describe_store(str(tmp_path / "x.txt"))


def test_an_h5ad_with_compound_obs_says_to_resave(tmp_path):
    import numpy as np
    path = tmp_path / "old.h5ad"
    with h5py.File(path, "w") as f:
        f.create_dataset("obs", data=np.zeros(3, dtype=[("a", "i4")]))
        f.create_group("var")
    with pytest.raises(store_details.StoreDetailsError, match="re-save"):
        store_details.describe_store(str(path))
