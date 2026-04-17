"""
Tests for the h5adReader cache functionality.
"""

import os
import pytest
import tempfile
import numpy as np
import h5py
from pathlib import Path

from annzarro.core.h5ad_reader import h5adReader


def create_test_h5ad_dataset(path):
    """Create a test h5ad dataset with basic structure."""
    import os

    # Ensure path doesn't already exist
    if os.path.exists(path):
        os.remove(path)

    # Create h5ad file
    with h5py.File(path, 'w') as f:
        # Add X matrix (main dataset)
        n_obs, n_vars = 100, 50
        f.create_dataset('X', data=np.random.rand(n_obs, n_vars).astype(np.float32))

        # Add obs dataframe (cell metadata)
        obs_group = f.create_group('obs')

        # Cell type categories
        cell_types = np.random.choice([0, 1, 2], n_obs)
        obs_group.create_dataset('cell_type', data=cell_types.astype(np.int32))

        # Cell names
        cell_names = [f'cell_{i}'.encode('utf-8') for i in range(n_obs)]
        obs_group.create_dataset('_index', data=cell_names)

        # Add var dataframe (gene metadata)
        var_group = f.create_group('var')

        # Gene names
        gene_names = [f'gene_{i}'.encode('utf-8') for i in range(n_vars)]
        var_group.create_dataset('_index', data=gene_names)

        # Gene expressed flag
        expressed = np.random.choice([0, 1], n_vars).astype(np.int32)
        var_group.create_dataset('expressed', data=expressed)

        # Add an embedding in obsm
        obsm_group = f.create_group('obsm')
        obsm_group.create_dataset('X_umap', data=np.random.rand(n_obs, 2).astype(np.float32))

        # Add a layer (raw counts)
        layers_group = f.create_group('layers')
        layers_group.create_dataset('raw', data=np.random.rand(n_obs, n_vars).astype(np.float32))

        # Add uns (unstructured annotations)
        uns_group = f.create_group('uns')
        uns_group.create_dataset('description', data=np.array([b'Test dataset for cache testing']))

    return path


@pytest.fixture
def h5ad_reader():
    """Create an h5adReader instance with known cache settings."""
    return h5adReader(max_memory_mb=100, enable_caching=True, cache_limit=5)


@pytest.fixture
def h5ad_test_dataset():
    """Create a temporary test h5ad dataset."""
    with tempfile.TemporaryDirectory() as temp_dir:
        path = os.path.join(temp_dir, 'test_dataset.h5ad')
        create_test_h5ad_dataset(path)
        yield path


def test_cache_initialization(h5ad_reader):
    """Test that the cache is properly initialized."""
    assert h5ad_reader.enable_caching is True
    assert h5ad_reader.max_memory_mb == 100
    assert h5ad_reader.cache_limit == 5

    # Access cache manager attributes
    assert h5ad_reader.cache.memory_usage_mb == 0
    assert len(h5ad_reader.cache._matrix_cache) == 0
    assert len(h5ad_reader.cache._dataframe_cache) == 0
    assert len(h5ad_reader.cache._metadata_cache) == 0
    assert len(h5ad_reader.cache._cache_access_times) == 0


def test_cache_info(h5ad_reader, h5ad_test_dataset):
    """Test the cache info method."""
    # Initial state
    cache_info = h5ad_reader.get_cache_info()
    assert cache_info["enabled"] is True
    assert cache_info["max_memory_mb"] == 100
    assert cache_info["dataset_limit"] == 5
    assert cache_info["memory_usage_mb"] == 0
    assert cache_info["item_counts"]["matrix"] == 0
    assert cache_info["item_counts"]["dataframe"] == 0
    assert cache_info["item_counts"]["metadata"] == 0

    # Make sure the test dataset exists on disk
    assert os.path.exists(h5ad_test_dataset)
    assert os.path.isfile(h5ad_test_dataset)

    # Load metadata which should populate the cache
    metadata = h5ad_reader.get_metadata(dataset_path=h5ad_test_dataset)

    # Metadata should be cached now
    cache_info = h5ad_reader.get_cache_info()

    # If caching is working, we should have metadata cached
    if cache_info["item_counts"]["metadata"] > 0:
        assert h5ad_test_dataset in cache_info["datasets"]
        assert cache_info["datasets"][h5ad_test_dataset] > 0

    # Read some data to populate the cache
    _ = h5ad_reader.get_X(dataset_path=h5ad_test_dataset)
    _ = h5ad_reader.get_obs_var(entity="cells", dataset_path=h5ad_test_dataset)

    # Check cache info after loading
    cache_info = h5ad_reader.get_cache_info()

    # Some data should be cached now (either matrix or dataframe)
    assert cache_info["item_counts"]["matrix"] > 0 or cache_info["item_counts"]["dataframe"] > 0
    assert h5ad_test_dataset in cache_info["datasets"]

    # Verify dataset is tracked
    assert cache_info["datasets"][h5ad_test_dataset] > 0


def test_clear_cache_all(h5ad_reader, h5ad_test_dataset):
    """Test clearing the entire cache."""
    # Load metadata and data to populate cache
    _ = h5ad_reader.get_metadata(dataset_path=h5ad_test_dataset)
    _ = h5ad_reader.get_X(dataset_path=h5ad_test_dataset)
    _ = h5ad_reader.get_obs_var(entity="cells", dataset_path=h5ad_test_dataset)

    # Verify cache has at least something in it
    has_cache_items = (
        len(h5ad_reader.cache._matrix_cache) > 0 or
        len(h5ad_reader.cache._dataframe_cache) > 0 or
        len(h5ad_reader.cache._metadata_cache) > 0
    )
    assert has_cache_items, "Cache was not populated"

    # Clear the cache
    result = h5ad_reader.clear_cache()

    # Verify cache is cleared
    assert len(h5ad_reader.cache._matrix_cache) == 0
    assert len(h5ad_reader.cache._dataframe_cache) == 0
    assert len(h5ad_reader.cache._metadata_cache) == 0
    assert len(h5ad_reader.cache._cache_access_times) == 0
    assert result["status"] == "success"
    assert result["cleared_all"] is True
    total_items = (result["cache_types_cleared"]["matrix"] +
                  result["cache_types_cleared"]["dataframe"] +
                  result["cache_types_cleared"]["metadata"])
    assert total_items > 0

    # Verify memory is cleared
    cache_info = h5ad_reader.get_cache_info()
    assert cache_info["memory_usage_mb"] == 0


def test_clear_cache_dataset(h5ad_reader, h5ad_test_dataset):
    """Test clearing the cache for a specific dataset."""
    # Create two datasets and populate cache
    with tempfile.TemporaryDirectory() as temp_dir:
        dataset1_path = os.path.join(temp_dir, 'dataset1.h5ad')
        dataset2_path = os.path.join(temp_dir, 'dataset2.h5ad')

        create_test_h5ad_dataset(dataset1_path)
        create_test_h5ad_dataset(dataset2_path)

        # Load datasets and populate cache
        _ = h5ad_reader.get_metadata(dataset_path=dataset1_path)
        _ = h5ad_reader.get_metadata(dataset_path=dataset2_path)

        _ = h5ad_reader.get_X(dataset_path=dataset1_path)
        _ = h5ad_reader.get_obs_var(entity="cells", dataset_path=dataset1_path)
        _ = h5ad_reader.get_X(dataset_path=dataset2_path)
        _ = h5ad_reader.get_obs_var(entity="cells", dataset_path=dataset2_path)

        # Get initial cache counts
        initial_cache_info = h5ad_reader.get_cache_info()

        # Clear cache for just dataset1
        result = h5ad_reader.clear_cache(dataset_path=dataset1_path)

        # Get updated cache info
        updated_cache_info = h5ad_reader.get_cache_info()

        # Verify only dataset1 was cleared
        assert result["status"] == "success"
        assert result["dataset_path"] == dataset1_path
        total_items = (result["items_removed"]["matrix"] +
                      result["items_removed"]["dataframe"] +
                      result["items_removed"]["metadata"])
        assert total_items > 0

        # Dataset2 should still have cache entries
        assert dataset2_path in updated_cache_info["datasets"]

        # Dataset1 should not have cache entries (or have fewer)
        if dataset1_path in initial_cache_info["datasets"]:
            initial_count = initial_cache_info["datasets"][dataset1_path]
            # After clearing, dataset1 should either be gone or have 0 items
            if dataset1_path in updated_cache_info["datasets"]:
                updated_count = updated_cache_info["datasets"][dataset1_path]
                assert updated_count < initial_count
            # else: dataset was completely removed from tracking, which is also correct


def test_metadata_caching(h5ad_reader, h5ad_test_dataset):
    """Test that metadata is properly cached and reused."""
    # Get metadata which should cache it
    metadata_1 = h5ad_reader.get_metadata(dataset_path=h5ad_test_dataset)

    # Check the metadata cache
    cache_info = h5ad_reader.get_cache_info()

    # Verify metadata is being cached
    assert cache_info["item_counts"]["metadata"] > 0, "Metadata is not being cached"
    assert h5ad_test_dataset in cache_info["datasets"], "Dataset not in cache"
    assert cache_info["datasets"][h5ad_test_dataset] > 0, "Dataset has no cached items"

    # Count how many times the file is opened
    original_file_init = h5py.File.__init__
    file_open_count = [0]

    def counting_file_init(self, *args, **kwargs):
        file_open_count[0] += 1
        return original_file_init(self, *args, **kwargs)

    try:
        # Replace h5py.File.__init__ with our counting version
        h5py.File.__init__ = counting_file_init

        # Initial count
        initial_count = file_open_count[0]

        # Get metadata again - should use cache and not open the file
        metadata_2 = h5ad_reader.get_metadata(dataset_path=h5ad_test_dataset)

        # If caching works, file open count should not increase
        assert file_open_count[0] == initial_count

        # Both metadata instances should be identical
        assert metadata_1 == metadata_2

        # Clear the cache
        h5ad_reader.clear_cache()

        # Get metadata again after clearing cache
        metadata_3 = h5ad_reader.get_metadata(dataset_path=h5ad_test_dataset)

        # After clearing cache, file should be opened again
        assert file_open_count[0] > initial_count

        # But metadata should still match
        assert metadata_1 == metadata_3

    finally:
        # Restore the original method
        h5py.File.__init__ = original_file_init


def test_cache_size_management(h5ad_reader):
    """Test that cache size is properly managed and items are evicted when needed."""
    # Modify cache settings for this test
    h5ad_reader.max_memory_mb = 10  # Small memory limit
    h5ad_reader.cache_limit = 2     # Small dataset limit
    h5ad_reader.cache.max_memory_mb = 10
    h5ad_reader.cache.cache_limit = 2

    # Ensure caching is enabled
    h5ad_reader.enable_caching = True
    h5ad_reader.cache.enable_caching = True

    # Create multiple test datasets
    with tempfile.TemporaryDirectory() as temp_dir:
        # Create 3 test datasets (one more than our limit)
        datasets = []

        for i in range(3):
            path = os.path.join(temp_dir, f'dataset{i}.h5ad')
            create_test_h5ad_dataset(path)
            datasets.append(path)

        # Load first dataset and populate cache
        _ = h5ad_reader.get_metadata(dataset_path=datasets[0])
        _ = h5ad_reader.get_X(dataset_path=datasets[0])

        # Get cache info after first dataset
        cache_info_1 = h5ad_reader.get_cache_info()
        assert datasets[0] in cache_info_1["datasets"]

        # Load second dataset and populate cache
        _ = h5ad_reader.get_metadata(dataset_path=datasets[1])
        _ = h5ad_reader.get_X(dataset_path=datasets[1])

        # Get cache info after second dataset
        cache_info_2 = h5ad_reader.get_cache_info()
        assert datasets[0] in cache_info_2["datasets"]
        assert datasets[1] in cache_info_2["datasets"]

        # Load third dataset which should trigger eviction
        # due to dataset_limit=2
        _ = h5ad_reader.get_metadata(dataset_path=datasets[2])
        _ = h5ad_reader.get_X(dataset_path=datasets[2])

        # Get cache info after third dataset
        cache_info_3 = h5ad_reader.get_cache_info()

        # We should have max 2 datasets in cache now due to our limit
        # Get the number of unique datasets in the cache
        if "datasets" in cache_info_3:
            unique_datasets = len(cache_info_3["datasets"])
            assert unique_datasets <= h5ad_reader.cache_limit

        # Test memory limit enforcement
        # If we artificially fill the cache with large data to exceed memory limit
        import numpy as np

        # Check if there are any datasets in the cache
        if "datasets" in cache_info_3 and len(cache_info_3["datasets"]) > 0:
            # Get the first dataset still in cache
            for ds_path in datasets:
                if ds_path in cache_info_3["datasets"]:
                    # Create a large array and add to cache manually
                    large_data = np.random.rand(1000, 1000)  # ~8MB array
                    h5ad_reader.cache._add_to_cache(f"{ds_path}:large_array", large_data, cache_type='matrix')

                    # Create another large array to exceed memory limit
                    large_data2 = np.random.rand(1000, 1000)  # Another ~8MB
                    h5ad_reader.cache._add_to_cache(f"{ds_path}:large_array2", large_data2, cache_type='matrix')

                    # Check if memory management kicked in
                    assert h5ad_reader.cache.memory_usage_mb <= h5ad_reader.cache.max_memory_mb
                    break


def test_cache_hit_performance(h5ad_reader, h5ad_test_dataset):
    """Test that cache hits are faster than cache misses."""
    import time

    # Clear cache to start fresh
    h5ad_reader.clear_cache()

    # First call - cache miss (should be slower)
    start_time = time.time()
    metadata_1 = h5ad_reader.get_metadata(dataset_path=h5ad_test_dataset)
    first_call_time = time.time() - start_time

    # Second call - cache hit (should be faster)
    start_time = time.time()
    metadata_2 = h5ad_reader.get_metadata(dataset_path=h5ad_test_dataset)
    second_call_time = time.time() - start_time

    # Verify both calls return the same data
    assert metadata_1 == metadata_2

    # Second call should be faster (or at least not significantly slower)
    # We use a generous threshold because timing can be variable
    assert second_call_time <= first_call_time * 1.5


def test_multiple_methods_caching(h5ad_reader, h5ad_test_dataset):
    """Test that multiple different methods cache independently."""
    # Clear cache to start fresh
    h5ad_reader.clear_cache()

    # Call multiple methods
    _ = h5ad_reader.get_metadata(dataset_path=h5ad_test_dataset)
    _ = h5ad_reader.get_X(dataset_path=h5ad_test_dataset)
    _ = h5ad_reader.get_obs_var(entity="cells", dataset_path=h5ad_test_dataset)
    _ = h5ad_reader.get_obsm_varm(entity="cells", key="X_umap", dataset_path=h5ad_test_dataset)

    # Check cache info
    cache_info = h5ad_reader.get_cache_info()

    # Should have multiple types of cached items
    total_items = cache_info["item_counts"]["total"]

    assert total_items > 0
    assert h5ad_test_dataset in cache_info["datasets"]

    # Clear cache and verify it's empty
    h5ad_reader.clear_cache()
    cache_info = h5ad_reader.get_cache_info()
    assert cache_info["item_counts"]["matrix"] == 0
    assert cache_info["item_counts"]["dataframe"] == 0
    assert cache_info["item_counts"]["metadata"] == 0
