"""
Tests for DataManager: dataset discovery, the part the server uses.

The stateful half (load_dataset, get_X/obs/var/obsm, selections, focus,
downsample_cells) called a ZarrReader API removed in a5c1aed, so every call
raised AttributeError; nothing in the server or frontend used it, and it was
removed. Its tests went with it (on dominik/issues-ci, PR #50, two of them
are strict xfails documenting the breakage; drop those when merging).
"""
import os
import shutil
from pathlib import Path

import pytest

from annzarro.core import zarr_reader
from annzarro.data.manager import DataManager

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixture_small.zarr")


@pytest.fixture
def data_dir(tmp_path):
    root = tmp_path / "data"
    root.mkdir()
    shutil.copytree(FIXTURE, root / "test_dataset1.zarr")
    shutil.copytree(FIXTURE, root / "nested" / "test_dataset2.zarr")
    zarr_reader.clear_cache()
    yield root
    zarr_reader.clear_cache()


def test_discover_datasets(data_dir, tmp_path):
    datasets = DataManager().discover_datasets(data_dir)
    assert sorted(ds["name"] for ds in datasets) == ["Test Dataset1", "Test Dataset2"]
    assert DataManager().discover_datasets(tmp_path / "nonexistent") == []


def test_discover_without_recursion(data_dir):
    names = [ds["name"] for ds in DataManager().discover_datasets(data_dir, recursive=False)]
    assert sorted(names) == ["Test Dataset1", "Test Dataset2"], "one level of subdirectories"


def test_list_datasets_from_cache_and_directory(data_dir):
    manager = DataManager()
    manager.discover_datasets(data_dir)
    assert len(manager.list_datasets()) == 2
    assert len(manager.list_datasets(str(data_dir))) == 2


def test_default_directory_is_the_default_data_dir(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    (tmp_path / "annzarro-data").mkdir()
    shutil.copytree(FIXTURE, tmp_path / "annzarro-data" / "a.zarr")
    assert [ds["id"] for ds in DataManager().discover_datasets()] == ["a"]


def test_get_dataset_info_reads_the_store(data_dir):
    info = DataManager().get_dataset_info(str(data_dir / "test_dataset1.zarr"))
    assert info["n_obs"] == 200 and info["n_vars"] == 20
    assert "X_umap" in info["embeddings"]
    assert len(info["obs_names_sample"]) == 10


def test_get_dataset_info_reports_an_unopenable_store(tmp_path):
    info = DataManager().get_dataset_info(str(tmp_path / "missing.zarr"))
    assert info["error"] == "Failed to open dataset"


@pytest.mark.parametrize("name", [
    "load_dataset", "get_X", "get_obs", "get_obsm", "downsample_cells",
    "set_selected_cells", "analyze_expression_data",
])
def test_the_broken_stateful_api_is_gone(name):
    assert not hasattr(DataManager, name)
