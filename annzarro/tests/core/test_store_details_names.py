"""store_details.describe_store names every kind of field (T1): obsp, varm, varp and the uns paths to depth 3."""
import os

import numpy as np
import pytest
import zarr

from annzarro.core import store_details
from annzarro.tests.core.h5ad_twin import h5ad_twin
from annzarro.tests.server.rich_store import make_rich_store

DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
FIXTURE = os.path.join(DATA, "fixture_small.zarr")


def test_every_slot_is_named(tmp_path):
    info = store_details.describe_store(make_rich_store(tmp_path / "rich.zarr"))
    assert info["obsp_keys"] == ["conn"] and info["obsp_total"] == 1
    assert info["varp_keys"] == ["corr"] and info["varp_total"] == 1
    assert info["varm_keys"] == [] and info["varm_total"] == 0
    assert info["layers_keys"] == ["counts"] and info["obsm_keys"] == ["X_umap"]


def test_uns_is_listed_as_paths_to_depth_three(tmp_path):
    info = store_details.describe_store(make_rich_store(tmp_path / "rich.zarr"))
    assert sorted(info["uns_paths"]) == ["names", "run", "run/n", "run/when", "title", "vec"]
    assert info["uns_paths_total"] == 6 and info["uns_count"] == 4


def test_uns_deeper_than_three_levels_is_not_listed(tmp_path):
    path = make_rich_store(tmp_path / "deep.zarr")
    root = zarr.open_group(path, mode="a")
    root["uns"].create_group("a").create_group("b").create_group("c").create_group("d")
    zarr.consolidate_metadata(path)
    paths = store_details.describe_store(path)["uns_paths"]
    assert "a/b/c" in paths and "a/b/c/d" not in paths


def test_the_attribution_and_readme_nodes_are_not_field_names(tmp_path):
    from annzarro.core import dataset_annotate
    path = make_rich_store(tmp_path / "annotated.zarr")
    dataset_annotate.annotate_store(path, {"title": "T"}, "readme text")
    info = store_details.describe_store(path)
    assert not {"annzarro", "README"} & set(info["uns_paths"]) and not any(p.startswith("annzarro/") for p in info["uns_paths"])


def test_uns_paths_are_capped_and_counted(tmp_path, monkeypatch):
    monkeypatch.setattr(store_details, "MAX_NAMES", 2)
    info = store_details.describe_store(make_rich_store(tmp_path / "rich.zarr"))
    assert len(info["uns_paths"]) == 2 and info["uns_paths_total"] == 6


def test_a_store_with_nothing_in_a_slot_names_nothing():
    info = store_details.describe_store(FIXTURE)
    for key in ("obsp", "varm", "varp"):
        assert info[f"{key}_keys"] == [] and info[f"{key}_total"] == 0
    assert info["uns_paths"] == [] and info["uns_paths_total"] == 0


def test_h5ad_names_the_same_slots(tmp_path):
    twin = h5ad_twin(FIXTURE, tmp_path / "t.h5ad")
    info = store_details.describe_store(twin)
    assert info["obsp_keys"] == [] and info["uns_paths"] == [] and info["obsm_keys"] == ["X_umap"]


def test_the_walk_of_a_wide_uns_stops(tmp_path, monkeypatch):
    path = make_rich_store(tmp_path / "wide.zarr")
    root = zarr.open_group(path, mode="a")
    for i in range(30):
        root["uns"].create_array(f"k{i:02d}", data=np.zeros(1))
    zarr.consolidate_metadata(path)
    monkeypatch.setattr(store_details, "MAX_NAMES", 3)
    monkeypatch.setattr(store_details, "MAX_UNS_VISITED", 10)
    info = store_details.describe_store(path)
    assert len(info["uns_paths"]) == 3 and info["uns_paths_total"] == 10
