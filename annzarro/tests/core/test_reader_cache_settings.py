"""
Reader cache settings are the cache's settings.

ZarrReader/h5adReader copied max_memory_mb, enable_caching and cache_limit
at construction, so setting them on the reader changed nothing the cache
used, and /cache/reset reported the copies. configure_*_reader also built a
NEW reader, which modules that had already imported the old one (the
routes, process_file) never saw.
"""
import pytest

from annzarro import core
from annzarro.core.h5ad_reader import h5adReader
from annzarro.core.zarr_reader import ZarrReader


@pytest.mark.parametrize("cls", [ZarrReader, h5adReader])
def test_settings_forward_to_the_cache(cls):
    reader = cls(max_memory_mb=100, enable_caching=True, cache_limit=3)
    assert (reader.max_memory_mb, reader.enable_caching, reader.cache_limit) == (100, True, 3)
    reader.max_memory_mb = 7
    reader.enable_caching = False
    reader.cache_limit = 1
    assert (reader.cache.max_memory_mb, reader.cache.enable_caching, reader.cache.cache_limit) == (7, False, 1)


def test_configure_updates_the_imported_singletons():
    from annzarro.server.routes import zarr_routes
    zarr_before, h5ad_before = core.zarr_reader, core.h5ad_reader_obj
    saved = (zarr_before.max_memory_mb, zarr_before.enable_caching, zarr_before.cache_limit)
    try:
        assert core.configure_zarr_reader({"cache_memory_mb": 321, "cache_dataset_limit": 4}) is zarr_before
        assert core.configure_h5ad_reader({"cache_memory_mb": 321}) is h5ad_before
        assert zarr_routes.zarr_reader.cache.max_memory_mb == 321
        assert zarr_routes.zarr_reader.cache.cache_limit == 4
    finally:
        zarr_before.max_memory_mb, zarr_before.enable_caching, zarr_before.cache_limit = saved
        core.configure_h5ad_reader({})


def test_cache_reset_reports_the_live_settings(tmp_path):
    from annzarro.server.core import create_app
    (tmp_path / "data").mkdir()
    app = create_app({"TESTING": True, "data_dir": str(tmp_path / "data"), "log_file": str(tmp_path / "l.log"),
                      "cache_memory_mb": 222, "cache_dataset_limit": 5})
    try:
        body = app.test_client().post("/api/v1/cache/reset").get_json()
        assert body["cache_config"] == {"cache_enabled": True, "cache_memory_mb": 222, "cache_dataset_limit": 5}
    finally:
        core.configure_zarr_reader({})
        core.configure_h5ad_reader({})
