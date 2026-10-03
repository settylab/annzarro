"""
Caching utilities for Annzarro.

This module provides caching functionality that can be used across the application,
with a focus on efficient memory management and dataset-specific caching.
"""

import functools
import inspect
import time
import logging
import threading
from typing import Dict, Any, List, Optional, Callable, Tuple, Union
import numpy as np

logger = logging.getLogger(__name__)

def _scalar_bytes(item) -> int:
    """Bytes one Python scalar in a cached list or dict costs (object + slot).

    This used to be a flat 1 KB per element, ~30x a float's real size, so one
    obs column of a million cells was costed at 977 MB of the default 1000 MB
    cache_memory_mb: caching it evicted nearly everything else, and a column
    of 1.03M cells or more was evicted the moment it was added.
    """
    if isinstance(item, str):
        return 57 + len(item)
    if isinstance(item, bytes):
        return 41 + len(item)
    return 32


class CacheSettings:
    """``max_memory_mb``, ``enable_caching`` and ``cache_limit`` on a reader,
    read from and written to its ``self.cache`` (a DatasetCache).

    The readers used to copy these at construction, so setting one on the
    reader changed nothing the cache used, and /cache/reset reported the
    stale copy.
    """

    @property
    def max_memory_mb(self):
        return self.cache.max_memory_mb

    @max_memory_mb.setter
    def max_memory_mb(self, value):
        self.cache.max_memory_mb = value

    @property
    def enable_caching(self):
        return self.cache.enable_caching

    @enable_caching.setter
    def enable_caching(self, value):
        self.cache.enable_caching = value

    @property
    def cache_limit(self):
        return self.cache.cache_limit

    @cache_limit.setter
    def cache_limit(self, value):
        self.cache.cache_limit = value


class DatasetCache:
    """
    Cache manager for dataset access operations.
    
    This class provides memory-efficient caching for different types of data
    with dataset-specific tracking, memory usage limits, and LRU eviction.
    """
    
    def __init__(self, max_memory_mb=1000, enable_caching=True, cache_limit=10):
        """
        Initialize the cache manager.
        
        Args:
            max_memory_mb: Maximum memory to use for caching in MB
            enable_caching: Whether caching is enabled
            cache_limit: Maximum number of datasets to cache
        """
        # Memory and caching settings
        self.max_memory_mb = max_memory_mb
        self.enable_caching = enable_caching
        self.cache_limit = cache_limit
        self.memory_usage_mb = 0
        
        # Caches for different data types
        self._matrix_cache = {}  # Cache for X, layers, obsm, varm matrices
        self._dataframe_cache = {}  # Cache for obs, var dataframes
        self._metadata_cache = {}  # Cache for metadata objects
        
        # Track cache by dataset ID
        self._dataset_caches = {}  # Dict of dataset_id -> list of cache_keys
        
        # Cache access timestamps for LRU eviction
        self._cache_access_times = {}  # Dict of cache_key -> last access timestamp

        # What each key was charged when added, so removing it uncharges
        # exactly that (a flat 1 MB per metadata entry used to drift).
        self._sizes_mb = {}

        # One reader, and so one cache, serves every request thread of a
        # threaded server. Every read and write of the dicts above and of
        # memory_usage_mb happens under this lock: an eviction iterating them
        # while another thread added a key raised "dictionary changed size
        # during iteration" mid-request. Re-entrant: eviction calls back into
        # the removal helpers.
        self._lock = threading.RLock()

    def _buckets(self):
        return (('matrix', self._matrix_cache), ('dataframe', self._dataframe_cache),
                ('metadata', self._metadata_cache))

    def _forget(self, key: str) -> Tuple[Optional[str], float]:
        """Remove ``key`` from its bucket and the accounting (not from the
        dataset tracking); return (bucket name or None, MB uncharged). Call
        with the lock held."""
        found = None
        for name, bucket in self._buckets():
            if key in bucket:
                del bucket[key]
                found = name
                break
        size = self._sizes_mb.pop(key, 0)
        self.memory_usage_mb = max(0, self.memory_usage_mb - size)
        self._cache_access_times.pop(key, None)
        return found, size

    def clear_cache(self, dataset_path: Optional[str] = None) -> Dict[str, Any]:
        """
        Clear the cache for a specific dataset or all datasets.
        
        Args:
            dataset_path: Optional dataset path to clear from cache.
                        If not provided, clears the entire cache.
        
        Returns:
            Dict with cache clearing results
        """
        if dataset_path is not None:
            return self._remove_dataset_from_cache(dataset_path)
        with self._lock:
            result = {
                "status": "success",
                "cleared_all": True,
                "memory_freed_mb": self.memory_usage_mb,
                "cache_types_cleared": {
                    "matrix": len(self._matrix_cache),
                    "dataframe": len(self._dataframe_cache),
                    "metadata": len(self._metadata_cache)
                }
            }
            self._matrix_cache = {}
            self._dataframe_cache = {}
            self._metadata_cache = {}
            self._dataset_caches = {}
            self._cache_access_times = {}
            self._sizes_mb = {}
            self.memory_usage_mb = 0
            return result

    def _remove_dataset_from_cache(self, dataset_path: str) -> Dict[str, Any]:
        """
        Remove all cached data for a specific dataset path.
        
        Args:
            dataset_path: Dataset path to remove from cache
            
        Returns:
            Dict with cache clearing results
        """
        result = {
            "status": "success",
            "dataset_path": dataset_path,
            "cleared": False,
            "memory_freed_mb": 0,
            "items_removed": {
                "matrix": 0,
                "dataframe": 0,
                "metadata": 0
            }
        }
        with self._lock:
            if dataset_path not in self._dataset_caches:
                result["message"] = f"Dataset {dataset_path} not found in cache"
                return result
            memory_freed = 0
            for key in self._dataset_caches.pop(dataset_path):
                bucket, size = self._forget(key)
                if bucket is not None:
                    result["items_removed"][bucket] += 1
                memory_freed += size
            result["cleared"] = True
            result["memory_freed_mb"] = memory_freed
            return result

    def _manage_cache_size(self) -> None:
        """
        Manage cache size by removing least recently used items when over limits.
        """
        with self._lock:
            # Over the dataset limit: drop the least recently used datasets
            if len(self._dataset_caches) > self.cache_limit:
                last_used = sorted(
                    (max((self._cache_access_times.get(k, 0) for k in keys), default=0), path)
                    for path, keys in self._dataset_caches.items())
                for _, path in last_used[:len(last_used) - self.cache_limit]:
                    self._remove_dataset_from_cache(path)
                    logger.debug(f"Evicted dataset {path} from cache (over dataset limit)")

            # Over the memory limit: drop the least recently used items
            if self.memory_usage_mb > self.max_memory_mb:
                for key, _ in sorted(self._cache_access_times.items(), key=lambda kv: kv[1]):
                    bucket, size = self._forget(key)
                    logger.debug(f"Evicted {bucket} {key} from cache (freed {size}MB)")
                    for path, keys in list(self._dataset_caches.items()):
                        if key in keys:
                            keys.remove(key)
                            if not keys:
                                del self._dataset_caches[path]
                            break
                    if self.memory_usage_mb <= self.max_memory_mb:
                        break

    def _add_to_cache(self, key: str, data: Any, dataset_path: Optional[str] = None, 
                     cache_type: str = 'matrix') -> None:
        """
        Add an item to the cache with memory tracking.
        
        Args:
            key: Cache key
            data: Data to cache
            dataset_path: Optional dataset path for tracking
            cache_type: Type of cache ('matrix', 'dataframe', or 'metadata')
        """
        # Skip if caching is disabled
        if not self.enable_caching:
            return
        memory_mb = self._estimate_memory_usage(data)  # outside the lock: it walks the data
        with self._lock:
            # A key added again (two threads computed it at once) replaces
            # the old entry instead of being charged twice.
            self._forget(key)
            dict(self._buckets()).get(cache_type, self._matrix_cache)[key] = data
            self._cache_access_times[key] = time.time()
            self._sizes_mb[key] = memory_mb
            self.memory_usage_mb += memory_mb
            if dataset_path is not None:
                keys = self._dataset_caches.setdefault(dataset_path, [])
                if key not in keys:
                    keys.append(key)
            self._manage_cache_size()
        logger.debug(f"Added {cache_type} to cache: {key} ({memory_mb:.2f}MB)")

    def _get_from_cache(self, key: str, cache_type: str = 'matrix') -> Optional[Any]:
        """
        Get an item from the cache and update its access time.
        
        Args:
            key: Cache key
            cache_type: Type of cache ('matrix', 'dataframe', or 'metadata')
            
        Returns:
            Cached data or None if not found
        """
        # Skip if caching is disabled
        if not self.enable_caching:
            return None
        with self._lock:
            cached_data = dict(self._buckets()).get(cache_type, self._matrix_cache).get(key)
            if cached_data is not None:
                self._cache_access_times[key] = time.time()
            return cached_data

    def _estimate_memory_usage(self, data: Any) -> float:
        """
        Estimate memory usage of data in MB.
        
        Args:
            data: Data to estimate memory usage for
            
        Returns:
            Estimated memory usage in MB
        """
        if data is None:
            return 0
        
        # NumPy arrays
        if isinstance(data, np.ndarray):
            # Calculate size in bytes and convert to MB
            return data.nbytes / (1024 * 1024)
        
        # Lists, tuples, and dicts
        if isinstance(data, (list, tuple)):
            # Approximation for nested structures
            size = 0
            for item in data:
                if isinstance(item, np.ndarray):
                    size += item.nbytes
                elif hasattr(item, 'nbytes'):
                    size += item.nbytes
                elif isinstance(item, (list, tuple, dict)):
                    size += self._estimate_memory_usage(item) * (1024 * 1024)
                else:
                    size += _scalar_bytes(item)
            return size / (1024 * 1024)
        
        # Dictionaries
        if isinstance(data, dict):
            # Approximation for nested structures
            size = 0
            for key, value in data.items():
                # Key size (rough estimate)
                if isinstance(key, str):
                    size += len(key) * 2  # 2 bytes per character
                else:
                    size += 16  # Fixed size for non-string keys
                
                # Value size
                if isinstance(value, np.ndarray):
                    size += value.nbytes
                elif hasattr(value, 'nbytes'):
                    size += value.nbytes
                elif isinstance(value, (list, tuple, dict)):
                    # Recursive approximation (simplified)
                    size += self._estimate_memory_usage(value) * (1024 * 1024)
                else:
                    size += _scalar_bytes(value)
            return size / (1024 * 1024)
        
        # For other types, use a fixed estimate
        return 1  # Assume 1MB for unknown types
    
    def get_cache_info(self) -> Dict[str, Any]:
        """
        Get information about the current cache state.
        
        Returns:
            Dict with cache information
        """
        with self._lock:
            return self._cache_info()

    def _cache_info(self) -> Dict[str, Any]:
        # Count items by type
        matrix_count = len(self._matrix_cache)
        dataframe_count = len(self._dataframe_cache)
        metadata_count = len(self._metadata_cache)
        
        # Count items by dataset
        dataset_counts = {}
        for dataset_path, keys in self._dataset_caches.items():
            dataset_counts[dataset_path] = len(keys)
        
        # Return cache info
        return {
            "enabled": self.enable_caching,
            "memory_usage_mb": self.memory_usage_mb,
            "max_memory_mb": self.max_memory_mb,
            "memory_usage_percent": (self.memory_usage_mb / self.max_memory_mb * 100) if self.max_memory_mb > 0 else 0,
            "dataset_limit": self.cache_limit,
            "dataset_count": len(self._dataset_caches),
            "datasets": dataset_counts,
            "item_counts": {
                "matrix": matrix_count,
                "dataframe": dataframe_count,
                "metadata": metadata_count,
                "total": matrix_count + dataframe_count + metadata_count
            }
        }

def cached_method(func):
    """
    Decorator for caching method results.
    
    This decorator is designed for ZarrReader methods that retrieve data
    from a zarr store. It will cache the results based on method arguments
    and dataset identification.
    
    Usage:
        @cached_method
        def get_layer(self, layer_name, dataset_path=None, ...):
            # Method implementation
    """
    signature = inspect.signature(func)

    @functools.wraps(func)
    def wrapper(self, *args, **kwargs):
        method_name = func.__name__
        
        # Skip caching if disabled
        if not hasattr(self, 'cache') or not self.cache.enable_caching:
            logger.debug(f"CACHE[{method_name}]: Skipping cache (caching disabled)")
            return func(self, *args, **kwargs)
        
        # Skip caching if explicitly disabled for this call
        if kwargs.get('disable_caching', False):
            logger.debug(f"CACHE[{method_name}]: Skipping cache (disable_caching=True)")
            # Remove disable_caching from kwargs to avoid passing it to the wrapped function
            if 'disable_caching' in kwargs:
                kwargs = {k: v for k, v in kwargs.items() if k != 'disable_caching'}
            return func(self, *args, **kwargs)
        
        # Read every argument by NAME, however the caller passed it. The
        # routes call ``get_layer(name, path, rows, cols)`` and
        # ``get_X(path, rows, cols)`` positionally; looking only in kwargs
        # found no dataset_path, so X and layer slices were never cached (and
        # get_X had no key branch at all). Binding against the signature also
        # applies the defaults, so a cache key does not depend on whether an
        # argument was spelled out.
        try:
            bound = signature.bind(self, *args, **kwargs)
        except TypeError:
            # Let the method raise its own, clearer, error.
            return func(self, *args, **kwargs)
        bound.apply_defaults()
        arg = bound.arguments

        def idx_key(name, values):
            return 'all' if values is None else f"{name}:{','.join(map(str, values))}"

        dataset_path = arg.get('dataset_path')

        # Log the dataset identification
        if dataset_path is not None:
            logger.debug(f"CACHE[{method_name}]: Using dataset_path={dataset_path}")

        root_arg = arg.get('root')
        # Skip caching if we can't identify the dataset
        if dataset_path is None and not (root_arg is not None and hasattr(root_arg, 'store')):
            logger.debug(f"CACHE[{method_name}]: Skipping cache (no dataset path)")
            return func(self, *args, **kwargs)

        # Convert path to string for cache key
        path_str = None if dataset_path is None else str(dataset_path)

        # URL encode the path to ensure special characters like ":" are handled properly in cache keys
        import urllib.parse
        encoded_path = None if path_str is None else urllib.parse.quote(path_str, safe='')

        # Create cache key
        cache_key = None

        # Different methods have different key parameters
        if method_name == 'get_X':
            cache_key = (f"path:{encoded_path}:X:"
                         f"{idx_key('rows', arg.get('row_indices'))}:"
                         f"{idx_key('cols', arg.get('col_indices'))}")

        elif method_name == 'get_layer':
            cache_key = (f"path:{encoded_path}:layer:{arg.get('layer_name')}:"
                         f"{idx_key('rows', arg.get('row_indices'))}:"
                         f"{idx_key('cols', arg.get('col_indices'))}")

        elif method_name == 'get_obs_var':
            column_names = arg.get('column_names')
            columns_key = 'all' if column_names is None else f"columns:{','.join(column_names)}"
            cat_key = 'withCat' if arg.get('include_categories', True) else 'noCat'
            cache_key = (f"path:{encoded_path}:{method_name}:{arg.get('entity')}:"
                         f"{idx_key('indices', arg.get('indices'))}:{columns_key}:{cat_key}")

        elif method_name == 'get_obsm_varm':
            column_name = arg.get('column_name')
            column_name_key = 'all' if column_name is None else column_name
            cache_key = (f"path:{encoded_path}:{method_name}:{arg.get('entity')}:{arg.get('key')}:"
                         f"{idx_key('indices', arg.get('indices'))}:"
                         f"{idx_key('cols', arg.get('col_indices'))}:{column_name_key}")

        elif method_name == 'get_obsp_varp':
            cache_key = (f"path:{encoded_path}:{method_name}:{arg.get('entity')}:{arg.get('key')}:"
                         f"{idx_key('rows', arg.get('row_indices'))}:"
                         f"{idx_key('cols', arg.get('col_indices'))}")

        elif method_name == 'get_uns':
            cache_key = f"path:{encoded_path}:uns:{arg.get('key')}"

        elif method_name == 'get_cell_gene_names':
            cache_key = f"path:{encoded_path}:names:{arg.get('entity')}"

        elif method_name == 'get_cell_gene_names_at':
            # A subset's names: keyed by a digest of its rows, which a
            # subset spec determines, instead of 100,000 numbers in the key.
            import hashlib
            rows = np.ascontiguousarray(np.asarray(arg.get('rows'), dtype=np.int64))
            digest = hashlib.sha1(rows.tobytes()).hexdigest()
            cache_key = f"path:{encoded_path}:names_at:{arg.get('entity')}:{len(rows)}:{digest}"

        elif method_name == 'get_obs_var_codes':
            cache_key = (f"path:{encoded_path}:{method_name}:{arg.get('entity')}:"
                         f"{arg.get('column_name')}:{idx_key('indices', arg.get('indices'))}")

        elif method_name == 'open_dataset_by_path':
            cache_key = (f"path:{encoded_path}:root:{arg.get('metadata', True)}:"
                         f"{arg.get('metadata_level', 'full')}")

        elif method_name in ['_extract_metadata', '_extract_metadata_legacy', 'get_metadata']:
            # Handle special case for metadata extraction and retrieval
            detail_level = arg.get('detail_level', 'full')

            if encoded_path is not None:
                cache_key = f"path:{encoded_path}:metadata:{detail_level}"
            elif root_arg is not None and hasattr(root_arg, 'store'):
                store_path = None
                if hasattr(root_arg.store, 'path'):
                    store_path = root_arg.store.path
                elif hasattr(root_arg.store, 'dir_path'):
                    store_path = root_arg.store.dir_path

                if store_path:
                    # URL encode the store path as well
                    encoded_store_path = urllib.parse.quote(str(store_path), safe='')
                    cache_key = f"path:{encoded_store_path}:metadata:{detail_level}"

        # If we couldn't create a cache key, skip caching
        if cache_key is None:
            logger.debug(f"CACHE[{method_name}]: Skipping cache (couldn't create cache key)")
            return func(self, *args, **kwargs)
        
        logger.debug(f"CACHE[{method_name}]: Using cache key '{cache_key}'")
        
        # Determine cache type
        cache_type = 'matrix'  # Default for most data types
        if method_name == 'get_obs_var':
            cache_type = 'dataframe'
        elif method_name in ['_extract_metadata', '_extract_metadata_legacy', 'get_metadata']:
            cache_type = 'metadata'
        elif method_name == 'open_dataset_by_path':
            # Store the root and metadata in the metadata cache
            cache_type = 'metadata'
        # get_uns stays in 'matrix' whatever it returns: the lookup below
        # must use the same bucket as the write, and a write chosen by the
        # result's type (dict -> dataframe, str -> metadata) was never read
        # back, so a uns group or string was re-read on every request.

        # Check if result is already cached
        cached_result = self.cache._get_from_cache(cache_key, cache_type=cache_type)
        if cached_result is not None:
            logger.debug(f"CACHE[{method_name}]: HIT - Using cached data for key '{cache_key}'")
            
            # No special case needed anymore since we use only path-based caching
            
            return cached_result
        
        logger.debug(f"CACHE[{method_name}]: MISS - Executing method for key '{cache_key}'")
        
        # Call the original method
        start_time = time.time()
        result = func(self, *args, **kwargs)
        elapsed_time = time.time() - start_time
        
        # Cache the result
        if result is not None:
            logger.debug(f"CACHE[{method_name}]: Method execution took {elapsed_time:.4f}s")

            # Cache the result with dataset_path
            logger.debug(f"CACHE[{method_name}]: Caching result with dataset_path='{dataset_path}'")
            self.cache._add_to_cache(cache_key, result, dataset_path=dataset_path, cache_type=cache_type)
        else:
            logger.debug(f"CACHE[{method_name}]: Not caching None result")
        
        return result
    
    return wrapper