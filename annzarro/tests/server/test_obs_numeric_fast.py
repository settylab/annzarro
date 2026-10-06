"""A numeric obs/var column in the binary format is sent as read, not via a list.

Reading one whole numeric obs column took 16.6 s cold at 95.6M cells
(v0.4.0, laptop). get_obs_var turned the array into a Python list for the
JSON path (95.6M float objects), the result cache costed that list item by
item (most of the time), and the binary path turned it back into an array.
A binary request for one numeric column now reads the array and sends it
(ZarrReader / h5adReader.get_obs_var_numeric).

What must hold: the bytes and headers a client receives are the same as
through the list path, for every dtype and encoding (f4, f8, NaN, ints that
fit float32 and ints that do not, uint, a nullable column with and without a
missing entry, booleans and strings, which stay JSON), for obs and var, with
and without a subset, from zarr and h5ad; and the read no longer allocates
the list (a peak-memory bound that fails on 49e2a19).
"""
import json
import tracemalloc

import h5py
import numpy as np
import pytest

from annzarro.core import subset as cell_subset
from annzarro.core import zarr_reader, h5ad_reader_obj
from annzarro.core.zarr_reader import ZarrReader
from annzarro.core.h5ad_reader import h5adReader
from annzarro.core.caching import DatasetCache
from annzarro.server.core import create_app
from annzarro.tests.zarr_compat import open_group, write_array, write_strings

N = 3000


def _columns(rng):
    f4 = rng.random(N).astype(np.float32)
    f4[::7] = np.nan
    f8 = rng.random(N) * 1e-9 + 1.0              # not exact in float32
    return {
        "f4": f4,
        "f8": f8,
        "i4": rng.integers(-1000, 1000, N).astype(np.int32),
        "i8big": rng.integers(2 ** 30, 2 ** 40, N).astype(np.int64),   # beyond float32's exact ints
        "u1": rng.integers(0, 255, N).astype(np.uint8),
        "b": rng.random(N) > 0.5,
    }


def _nullable(group, name, values, mask):
    g = group.create_group(name)
    g.attrs.update({"encoding-type": "nullable-integer", "encoding-version": "0.1.0"})
    write_array(g, "values", values)
    write_array(g, "mask", mask)


def _zarr_store(path, cols):
    root = open_group(path)
    root.attrs.update({"encoding-type": "anndata", "encoding-version": "0.1.0"})
    x = write_array(root, "X", np.zeros((N, 4), dtype=np.float32))
    x.attrs.update({"encoding-type": "array", "encoding-version": "0.2.0"})
    for name, n, extra in (("obs", N, True), ("var", 4, False)):
        g = root.create_group(name)
        g.attrs.update({"encoding-type": "dataframe", "encoding-version": "0.2.0", "_index": "_index",
                        "column-order": []})
        write_strings(g, "_index", [f"{name}{i}" for i in range(n)])
        if extra:
            for k, v in cols.items():
                a = write_array(g, k, v)
                a.attrs.update({"encoding-type": "array", "encoding-version": "0.2.0"})
            write_strings(g, "label", [f"l{i}" for i in range(n)])
            _nullable(g, "nint_full", np.arange(n, dtype=np.int32), np.zeros(n, dtype=bool))
            mask = np.zeros(n, dtype=bool)
            mask[5] = True
            _nullable(g, "nint_missing", np.arange(n, dtype=np.int32), mask)
        else:
            a = write_array(g, "mean", np.array([0.5, 1.5, np.nan, 3.0], dtype=np.float32))
            a.attrs.update({"encoding-type": "array", "encoding-version": "0.2.0"})


def _h5ad_store(path, cols):
    with h5py.File(path, "w") as f:
        f.attrs.update({"encoding-type": "anndata", "encoding-version": "0.1.0"})
        f.create_dataset("X", data=np.zeros((N, 4), dtype=np.float32))
        for name, n, extra in (("obs", N, True), ("var", 4, False)):
            g = f.create_group(name)
            g.attrs.update({"encoding-type": "dataframe", "encoding-version": "0.2.0", "_index": "_index",
                            "column-order": []})
            g.create_dataset("_index", data=np.array([f"{name}{i}" for i in range(n)], dtype=object),
                             dtype=h5py.string_dtype())
            if extra:
                for k, v in cols.items():
                    g.create_dataset(k, data=v)
                ng = g.create_group("nint_missing")
                ng.attrs.update({"encoding-type": "nullable-integer", "encoding-version": "0.1.0"})
                ng.create_dataset("values", data=np.arange(n, dtype=np.int32))
                mask = np.zeros(n, dtype=bool)
                mask[5] = True
                ng.create_dataset("mask", data=mask)
            else:
                g.create_dataset("mean", data=np.array([0.5, 1.5, np.nan, 3.0], dtype=np.float32))


@pytest.fixture
def stores(tmp_path):
    zarr_reader.clear_cache()
    h5ad_reader_obj.clear_cache()
    cell_subset.clear()
    data = tmp_path / "data"
    data.mkdir()
    cols = _columns(np.random.default_rng(0))
    z, h = str(data / "a.zarr"), str(data / "a.h5ad")
    _zarr_store(z, cols)
    _h5ad_store(h, cols)
    client = create_app({"TESTING": True, "data_dir": str(data), "log_file": str(tmp_path / "t.log"),
                         "auth_enabled": False}).test_client()
    yield client, z, h
    zarr_reader.clear_cache()
    h5ad_reader_obj.clear_cache()
    cell_subset.clear()


def _reply(client, path, endpoint, column, subset=None):
    q = {"dataset_path": path, "columns": column, "format": "f32"}
    if subset:
        q["subset"] = json.dumps(subset)
    r = client.get(f"/api/v1/data/{endpoint}", query_string=q)
    headers = {k: v for k, v in r.headers.items() if k.lower().startswith("x-") or k.lower() == "content-type"}
    return r.status_code, headers, r.get_data()


COLUMNS = ["f4", "f8", "i4", "i8big", "u1", "b", "label", "nint_full", "nint_missing"]


@pytest.mark.parametrize("subset", [None, {"n": 500, "seed": 3}], ids=["all", "subset"])
def test_the_client_gets_the_same_bytes_as_through_the_list(stores, monkeypatch, subset):
    client, z, h = stores
    cases = [(z, "obs", c) for c in COLUMNS] + [(z, "var", "mean")]
    cases += [(h, "obs", c) for c in COLUMNS if c not in ("label", "nint_full")] + [(h, "var", "mean")]
    fast = {}
    for path, endpoint, col in cases:
        fast[(path, endpoint, col)] = _reply(client, path, endpoint, col, subset if endpoint == "obs" else None)
    # the list path, as before: no fast reader method
    for cls in (ZarrReader, h5adReader):
        monkeypatch.setattr(cls, "get_obs_var_numeric", lambda self, **kw: None)
    zarr_reader.clear_cache()
    h5ad_reader_obj.clear_cache()
    for key, (status, headers, body) in fast.items():
        path, endpoint, col = key
        old = _reply(client, path, endpoint, col, subset if endpoint == "obs" else None)
        assert status == 200, (key, body[:200])
        assert (status, headers, body) == old, f"{key}: {headers} vs {old[1]}"
    # booleans, strings and a missing entry stayed JSON; the numeric ones went binary
    kinds = {k[2]: v[1].get("Content-Type") for k, v in fast.items() if k[0] == z and k[1] == "obs"}
    assert kinds["b"].startswith("application/json") and kinds["label"].startswith("application/json")
    if subset is None:      # (the subset may leave the missing entry out)
        assert kinds["nint_missing"].startswith("application/json")
    for c in ("f4", "f8", "i4", "i8big", "u1", "nint_full"):
        assert kinds[c] == "application/octet-stream", (c, kinds[c])


def test_an_absent_or_categorical_column_answers_as_before(stores):
    client, z, _ = stores
    status, _, body = _reply(client, z, "obs", "not_a_column")
    assert status == 404, body[:200]


def test_a_whole_column_read_does_not_build_a_python_list(tmp_path):
    """2,000,000 float32 values (8 MB). The list path allocated ~64 MB of
    Python floats and a float64 copy; the array as read stays within a few
    times its own size."""
    zarr_reader.clear_cache()
    data = tmp_path / "data"
    data.mkdir()
    n = 2_000_000
    root = open_group(str(data / "big.zarr"))
    root.attrs.update({"encoding-type": "anndata", "encoding-version": "0.1.0"})
    x = write_array(root, "X", np.zeros((n, 1), dtype=np.float32), chunks=(1 << 20, 1))
    x.attrs.update({"encoding-type": "array", "encoding-version": "0.2.0"})
    g = root.create_group("obs")
    g.attrs.update({"encoding-type": "dataframe", "encoding-version": "0.2.0", "_index": "_index", "column-order": []})
    write_strings(g, "_index", [f"c{i}" for i in range(n)], chunks=(1 << 20,))
    a = write_array(g, "total_counts", np.random.default_rng(1).random(n).astype(np.float32), chunks=(1 << 20,))
    a.attrs.update({"encoding-type": "array", "encoding-version": "0.2.0"})
    client = create_app({"TESTING": True, "data_dir": str(data), "log_file": str(tmp_path / "t.log"),
                         "auth_enabled": False}).test_client()
    q = {"dataset_path": str(data / "big.zarr"), "columns": "total_counts", "format": "f32"}
    client.get("/api/v1/data/info", query_string={"dataset_path": q["dataset_path"]})
    tracemalloc.start()
    r = client.get("/api/v1/data/obs", query_string=q)
    body = r.get_data()
    peak = tracemalloc.get_traced_memory()[1]
    tracemalloc.stop()
    zarr_reader.clear_cache()
    assert r.status_code == 200 and len(body) == 4 * n
    assert peak < 6 * 4 * n, f"peak {peak / 1e6:.0f} MB for an {4 * n / 1e6:.0f} MB column"


def test_a_long_list_is_costed_from_a_sample():
    """The cache costed a 95.6M-item list item by item (10 s); a sample of
    it gives the same estimate within a few percent."""
    cache = DatasetCache()
    floats = [0.5] * 200_000
    strings = [f"cell_{i:07d}" for i in range(200_000)]
    assert cache._estimate_memory_usage(floats) == pytest.approx(200_000 * 32 / 2 ** 20, rel=0.01)
    exact = sum(57 + len(s) for s in strings) / 2 ** 20
    assert cache._estimate_memory_usage(strings) == pytest.approx(exact, rel=0.05)
