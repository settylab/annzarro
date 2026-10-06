"""
Tests for the ZarrReader cache functionality.
"""

import os
import pytest
import tempfile
import numpy as np
import pandas as pd
import zarr

from annzarro.tests import zarr_compat
from pathlib import Path

from annzarro.core.zarr_reader import ZarrReader


def create_test_zarr_dataset(path):
    """Create a test zarr dataset with basic structure."""
    import os
    import shutil
    
    # Ensure path doesn't already exist
    if os.path.exists(path):
        shutil.rmtree(path)
    
    # Create root group
    root = zarr_compat.open_group(path)
    
    # Add X matrix (main dataset)
    n_obs, n_vars = 100, 50
    zarr_compat.write_array(root, 'X', data=np.random.rand(n_obs, n_vars).astype(np.float32))
    
    # Add obs dataframe (cell metadata)
    obs_group = root.create_group('obs')
    
    # Use integers instead of strings for categories to avoid zarr object encoding issues
    cell_types = np.random.choice([1, 2, 3], n_obs)
    batches = np.random.choice([1, 2, 3], n_obs)
    
    zarr_compat.write_array(obs_group, 'cell_type', data=cell_types, dtype=np.int32)
    zarr_compat.write_array(obs_group, 'batch', data=batches, dtype=np.int32)
    
    # Add var dataframe (gene metadata)
    var_group = root.create_group('var')
    
    # Use numeric values instead of strings for gene names
    gene_ids = np.arange(n_vars, dtype=np.int32)
    expressed = np.random.choice([0, 1], n_vars).astype(np.int32)
    
    zarr_compat.write_array(var_group, 'gene_id', data=gene_ids, dtype=np.int32)
    zarr_compat.write_array(var_group, 'expressed', data=expressed, dtype=np.int32)
    
    # Add an embedding in obsm
    obsm_group = root.create_group('obsm')
    zarr_compat.write_array(obsm_group, 'X_umap', data=np.random.rand(n_obs, 2))
    
    # Add a layer
    layers_group = root.create_group('layers')
    zarr_compat.write_array(layers_group, 'counts', data=np.random.rand(n_obs, n_vars))
    
    # Create shape attribute (required for AnnData-like structure)
    # Use tuple instead of numpy array for JSON compatibility
    root.attrs['shape'] = [int(n_obs), int(n_vars)]
    
    # For zarr DirectoryStore, there's no flush method, but 
    # the operations are automatically written to disk
    
    return path


@pytest.fixture
def zarr_reader():
    """Create a ZarrReader instance with known cache settings."""
    return ZarrReader(max_memory_mb=100, enable_caching=True, cache_limit=5)


@pytest.fixture
def zarr_test_dataset(tmp_path):
    """Create a temporary test zarr dataset."""
    return create_test_zarr_dataset(str(tmp_path / 'test_dataset.zarr'))


# The reader is stateless and addressed by path; its cache is the DatasetCache
# at ``reader.cache``. These tests previously targeted the removed load_zarr()/
# dataset-id API and caught every exception as a skip, so they could not fail.
# cached_method keys on ``dataset_path=`` passed as a keyword.

def _populate(reader, path):
    reader.open_dataset_by_path(dataset_path=path)
    reader.get_layer('counts', dataset_path=path)


def test_cache_initialization(zarr_reader):
    cache = zarr_reader.cache
    assert cache.enable_caching is True
    assert cache.max_memory_mb == 100
    assert cache.cache_limit == 5
    assert cache.memory_usage_mb == 0
    info = zarr_reader.get_cache_info()
    assert info["item_counts"]["total"] == 0
    assert info["datasets"] == {}


def test_cache_info(zarr_reader, zarr_test_dataset):
    _populate(zarr_reader, zarr_test_dataset)
    info = zarr_reader.get_cache_info()
    assert info["enabled"] is True
    assert info["max_memory_mb"] == 100
    assert info["dataset_limit"] == 5
    assert info["item_counts"]["metadata"] > 0
    assert info["item_counts"]["matrix"] > 0
    assert info["datasets"] == {zarr_test_dataset: info["item_counts"]["total"]}
    assert info["memory_usage_mb"] > 0


def test_clear_cache_all(zarr_reader, zarr_test_dataset):
    _populate(zarr_reader, zarr_test_dataset)
    result = zarr_reader.clear_cache()
    assert result["status"] == "success"
    assert result["cleared_all"] is True
    assert result["cache_types_cleared"]["matrix"] > 0
    info = zarr_reader.get_cache_info()
    assert info["item_counts"]["total"] == 0
    assert info["memory_usage_mb"] == 0


def test_clear_cache_dataset(zarr_reader, tmp_path):
    path1 = create_test_zarr_dataset(str(tmp_path / 'dataset1.zarr'))
    path2 = create_test_zarr_dataset(str(tmp_path / 'dataset2.zarr'))
    _populate(zarr_reader, path1)
    _populate(zarr_reader, path2)

    result = zarr_reader.clear_cache(dataset_path=path1)

    assert result["status"] == "success"
    assert result["cleared"] is True
    assert result["items_removed"]["matrix"] > 0
    datasets = zarr_reader.get_cache_info()["datasets"]
    assert path1 not in datasets
    assert path2 in datasets


def test_metadata_caching(zarr_reader, zarr_test_dataset):
    first = zarr_reader.get_metadata(dataset_path=zarr_test_dataset)
    assert zarr_reader.get_cache_info()["item_counts"]["metadata"] > 0
    assert zarr_reader.get_metadata(dataset_path=zarr_test_dataset) is first

    zarr_reader.clear_cache()
    again = zarr_reader.get_metadata(dataset_path=zarr_test_dataset)
    assert again is not first
    assert again == first


def test_cache_size_management(zarr_reader, tmp_path):
    zarr_reader.cache.cache_limit = 2
    paths = [create_test_zarr_dataset(str(tmp_path / f'dataset{i}.zarr')) for i in range(3)]
    for path in paths:
        _populate(zarr_reader, path)
    datasets = zarr_reader.get_cache_info()["datasets"]
    assert len(datasets) == 2
    assert paths[0] not in datasets  # least recently used goes first

    zarr_reader.cache.max_memory_mb = 10
    zarr_reader._add_to_cache("path:big1:x", np.zeros((1000, 1000)), cache_type='matrix')  # ~8 MB
    zarr_reader._add_to_cache("path:big2:x", np.zeros((1000, 1000)), cache_type='matrix')
    assert zarr_reader.cache.memory_usage_mb <= 10


def test_clearing_a_dataset_clears_every_entry_of_it(zarr_reader, zarr_test_dataset):
    """Metadata extracted from a root (no dataset_path) was kept under no
    dataset under zarr 2: clearing the dataset left it, and it was served
    again after the store changed."""
    _populate(zarr_reader, zarr_test_dataset)
    zarr_reader.clear_cache(dataset_path=zarr_test_dataset)
    assert zarr_reader.get_cache_info()["item_counts"]["total"] == 0
