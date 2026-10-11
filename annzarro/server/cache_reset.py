"""Emptying the server's caches: the one routine behind ``POST /cache/reset`` and the admin page's "Clear cache"."""

from ..core import zarr_reader, h5ad_reader_obj
from ..core import name_index
from ..core import categories as category_rules
from ..core import freshness


def reset_all(dataset_path=None):
    """Clear the caches of ``dataset_path``, or of every dataset when it is None.

    Both readers: the h5ad reader keeps its own result cache (it opens the
    file per read and holds no handle), and resetting the zarr reader alone
    served an .h5ad's old reads until a restart. The name search index is a
    cache too, so a reset must rebuild it. Returns the zarr reader's result
    with ``cache_config`` added.
    """
    result = zarr_reader.clear_cache(dataset_path=dataset_path)
    h5ad_reader_obj.clear_cache(dataset_path=dataset_path)
    name_index.clear(dataset_path)
    category_rules.clear_rankings(dataset_path)
    # A new generation: the ETags change (an in-place chunk write kept the old
    # ones, so the browser was answered 304 with its old body), and every other
    # process, each gunicorn worker, drops its cached reads of the dataset on
    # its next request.
    freshness.bump(dataset_path, reason="cache_reset")
    result["cache_config"] = {
        "cache_enabled": zarr_reader.enable_caching,
        "cache_memory_mb": zarr_reader.max_memory_mb,
        "cache_dataset_limit": zarr_reader.cache_limit,
    }
    return result
