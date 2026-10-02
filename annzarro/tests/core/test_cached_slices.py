"""X and layer slices are served from the result cache on a repeat request.

``cached_method`` used to read ``dataset_path`` only from kwargs while
``process_file`` passes it positionally, so every X and layer request
re-read zarr (and ``get_X`` had no cache-key branch at all). Keys are now
built from the bound signature, so the calling convention does not matter.
"""
import numpy as np
import pytest
import zarr

from annzarro.core.zarr_reader import ZarrReader


# zarr 2 (the Python 3.9 CI job) has neither zarr_format= nor create_array
_ZARR3 = int(zarr.__version__.split(".")[0]) >= 3


def _open_v2(path):
    return zarr.open_group(path, mode="w", zarr_format=2) if _ZARR3 else zarr.open_group(path, mode="w")


def _array(group, name, a, chunks=None):
    make = group.create_array if _ZARR3 else group.create_dataset
    make(name, shape=a.shape, dtype=a.dtype, **({"chunks": chunks} if chunks else {}))[:] = a


@pytest.fixture
def store(tmp_path):
    path = str(tmp_path / "t.zarr")
    rng = np.random.default_rng(0)
    X = rng.random((30, 8)).astype(np.float32)
    L = rng.random((30, 8)).astype(np.float32)
    root = _open_v2(path)
    _array(root, "X", X, chunks=(10, 4))
    _array(root.create_group("layers"), "fc", L, chunks=(10, 4))
    return path, X, L


def _count_reads(reader, monkeypatch):
    calls = []
    real = ZarrReader._get_dense_array

    def counting(self, *a, **kw):
        calls.append(a[0])
        return real(self, *a, **kw)

    monkeypatch.setattr(ZarrReader, "_get_dense_array", counting)
    return calls


def test_layer_positional_call_is_a_cache_hit(store, monkeypatch):
    path, _, L = store
    reader = ZarrReader()
    calls = _count_reads(reader, monkeypatch)
    first = reader.get_layer("fc", path, None, [3])          # how process_file calls it
    second = reader.get_layer("fc", path, None, [3])
    np.testing.assert_array_equal(first[:, 0], L[:, 3])
    assert second is first
    assert calls == ["layers/fc"]


def test_layer_keyword_and_positional_share_one_entry(store, monkeypatch):
    path, _, _ = store
    reader = ZarrReader()
    calls = _count_reads(reader, monkeypatch)
    reader.get_layer("fc", path, None, [5])
    reader.get_layer(layer_name="fc", dataset_path=path, col_indices=[5])
    assert calls == ["layers/fc"]


def test_X_is_cached_and_keys_differ_by_slice(store, monkeypatch):
    path, X, _ = store
    reader = ZarrReader()
    calls = _count_reads(reader, monkeypatch)
    a = reader.get_X(path, None, [1])
    b = reader.get_X(path, None, [1])
    c = reader.get_X(path, [2], None)
    assert b is a
    np.testing.assert_array_equal(c[0], X[2])
    assert calls == ["X", "X"]


def test_disable_caching_still_bypasses(store, monkeypatch):
    path, _, _ = store
    reader = ZarrReader()
    calls = _count_reads(reader, monkeypatch)
    reader.get_X(path, None, [1], disable_caching=True)
    reader.get_X(path, None, [1], disable_caching=True)
    assert calls == ["X", "X"]


def test_obsm_key_is_the_key_not_the_entity(store, tmp_path):
    """get_obsm_varm(entity, key, ...) used to key on args[0] -- the ENTITY."""
    path = str(tmp_path / "m.zarr")
    obsm = _open_v2(path).create_group("obsm")
    a = np.arange(20, dtype=np.float32).reshape(10, 2)
    _array(obsm, "A", a)
    _array(obsm, "B", a + 100)
    reader = ZarrReader()
    ra = reader.get_obsm_varm("cells", "A", dataset_path=path)
    rb = reader.get_obsm_varm("cells", "B", dataset_path=path)
    np.testing.assert_array_equal(ra, a)
    np.testing.assert_array_equal(rb, a + 100)


def test_route_repeat_is_a_cache_hit(store, tmp_path, monkeypatch):
    from annzarro.server.core import create_app

    path, _, L = store
    app = create_app({"TESTING": True, "host": "127.0.0.1", "data_dir": str(tmp_path),
                      "log_file": str(tmp_path / "t.log"), "auth_enabled": False})
    client = app.test_client()
    calls = _count_reads(None, monkeypatch)
    q = {"dataset_path": path, "cols": "2"}
    r1 = client.get("/api/v1/data/layer/fc", query_string=q)
    r2 = client.get("/api/v1/data/layer/fc", query_string=q)
    assert r1.status_code == r2.status_code == 200
    assert r1.get_json()["data"] == r2.get_json()["data"]
    assert calls == ["layers/fc"]
