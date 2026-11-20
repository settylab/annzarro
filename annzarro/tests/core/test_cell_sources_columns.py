"""Boolean and text obs columns in slabs, no reader cache for slab reads, and the public helpers (E2c).

A bool array is read as an array; a text column is factorised slab by slab against a running dictionary, in the order
the list path sorts it; neither goes through ``get_obs_var``'s Python lists. Slab reads leave the reader's cache empty.
"""
import itertools
import tracemalloc

import numpy as np
import pytest

from annzarro.core import cell_sources as cs
from annzarro.core import get_reader
from annzarro.core.caching import cached_method
from annzarro.core.zarr_reader import ZarrReader
from annzarro.tests import zarr_compat
from annzarro.tests.core.cell_sources_store import make_cell_store
from annzarro.tests.core.gene_score_store import BACKENDS, N_OBS

ROWS = {"all": None, "run": np.arange(37, 163, dtype=np.int64), "scattered": np.arange(3, N_OBS, 4, dtype=np.int64)}


@pytest.fixture(scope="module")
def stores(tmp_path_factory):
    base = tmp_path_factory.mktemp("cols")
    return {b: make_cell_store(base / f"s.{'zarr' if b == 'zarr' else 'h5ad'}", "csc", b) for b in BACKENDS}


def read(path, source, rows):
    slabs = list(cs.column(get_reader(path), path, source, rows))
    assert slabs
    return np.concatenate([s.values for s in slabs]), slabs


@pytest.mark.parametrize("slab", [7, 64, 4096])
@pytest.mark.parametrize("rows", list(ROWS))
@pytest.mark.parametrize("backend", BACKENDS)
def test_bool_is_an_array_and_matches_the_stored_values(stores, monkeypatch, backend, rows, slab):
    monkeypatch.setattr(cs, "SLAB_ROWS", slab)
    path, e = stores[backend]
    reader = get_reader(path)
    monkeypatch.setattr(reader, "get_obs_var", lambda *a, **k: pytest.fail("bool went through the list reader"))
    want = e["flag"] if ROWS[rows] is None else e["flag"][ROWS[rows]]
    values, slabs = read(path, {"type": "obs", "key": "flag"}, ROWS[rows])
    assert {s.kind for s in slabs} == {"bool"} and values.dtype == bool
    np.testing.assert_array_equal(values, want)


@pytest.mark.parametrize("slab", [7, 64, 4096])
@pytest.mark.parametrize("rows", list(ROWS))
@pytest.mark.parametrize("backend", BACKENDS)
def test_text_is_categories_sorted_as_the_list_path_sorts_them(stores, monkeypatch, backend, rows, slab):
    monkeypatch.setattr(cs, "SLAB_ROWS", slab)
    path, e = stores[backend]
    reader = get_reader(path)
    monkeypatch.setattr(reader, "get_obs_var", lambda *a, **k: pytest.fail("text went through the list reader"))
    want = e["note"] if ROWS[rows] is None else e["note"][ROWS[rows]]
    values, slabs = read(path, {"type": "obs", "key": "note"}, ROWS[rows])
    assert {s.kind for s in slabs} == {"category"}
    categories = slabs[0].categories
    assert all(s.categories == categories for s in slabs)
    assert categories == sorted(set(want.tolist()), key=str)
    assert values.dtype.kind == "i" and values.min() >= 0
    assert list(np.asarray(categories, dtype=object)[values]) == want.tolist()


def test_cost_marks_text_heavy_and_nothing_else(stores):
    path, _ = stores["zarr"]
    reader = get_reader(path)
    heavy = {k: cs.cost(reader, path, {"type": "obs", "key": k}).heavy
             for k in ("note", "flag", "depth", "ctype", "total_counts", "nullable")}
    assert heavy == {"note": True, "flag": False, "depth": False, "ctype": False, "total_counts": False,
                     "nullable": False}
    assert not cs.cost(reader, path, {"type": "obsm", "key": "wide", "column": "1"}).heavy
    h5 = stores["h5ad"][0]
    assert cs.cost(get_reader(h5), h5, {"type": "obs", "key": "note"}).heavy


def big_store(path, n, distinct):
    """A bare store of ``n`` cells with a text column ``t`` of ``distinct`` values and a boolean column ``b``."""
    root = zarr_compat.open_group(str(path), mode="w")
    root.attrs["encoding-type"] = "anndata"
    obs = root.create_group("obs")
    obs.attrs.update({"encoding-type": "dataframe", "encoding-version": "0.2.0", "_index": "_index",
                      "column-order": ["t", "b"]})
    zarr_compat.write_array(obs, "_index", np.arange(n, dtype=np.int64), chunks=(1 << 14,))
    names = np.array([f"value-{i:06d}" for i in range(distinct)], dtype=object)
    zarr_compat.write_strings(obs, "t", list(names[(np.arange(n) * 7919) % distinct]), chunks=(1 << 14,))
    zarr_compat.write_array(obs, "b", np.arange(n) % 3 == 0, chunks=(1 << 14,))
    var = root.create_group("var")
    var.attrs.update({"encoding-type": "dataframe", "encoding-version": "0.2.0", "_index": "_index", "column-order": []})
    zarr_compat.write_strings(var, "_index", ["g"])
    zarr_compat.consolidate(str(path))
    return str(path), names


def test_text_memory_is_the_codes_and_the_distinct_values(tmp_path, monkeypatch):
    n = 1_000_000
    path, names = big_store(tmp_path / "big.zarr", n, 50)
    monkeypatch.setattr(cs, "SLAB_ROWS", 50_000)
    reader = get_reader(path)
    tracemalloc.start()
    try:
        total, first = 0, None
        for slab in cs.column(reader, path, {"type": "obs", "key": "t"}, None):
            total += len(slab.values)
            first = first or slab.categories
        peak = tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()
    assert total == n and first == sorted(names[(np.arange(n) * 7919) % 50].tolist() and set(names[:50].tolist()))
    # codes of every cell (2 B) + one slab of strings and its codes; a list of the 1M strings alone is over 60 MB
    assert peak < 30_000_000, peak


def test_a_text_column_with_too_many_distinct_values_is_refused(tmp_path, monkeypatch):
    n = 70_000
    path, _ = big_store(tmp_path / "many.zarr", n, n)
    monkeypatch.setattr(cs, "SLAB_ROWS", 20_000)
    with pytest.raises(cs.CellSourceError) as err:
        list(cs.column(get_reader(path), path, {"type": "obs", "key": "t"}, None))
    assert (err.value.reason, err.value.extra["limit"]) == ("too_many_categories", 65_536)
    assert err.value.extra["count"] > 65_536


def test_text_with_more_than_65534_values_still_codes_correctly(tmp_path, monkeypatch):
    n = 66_000
    path, names = big_store(tmp_path / "wide.zarr", n, 65_536)
    monkeypatch.setattr(cs, "SLAB_ROWS", 10_000)
    slabs = list(cs.column(get_reader(path), path, {"type": "obs", "key": "t"}, None))
    values = np.concatenate([s.values for s in slabs])
    assert slabs[0].categories == sorted(set(names[(np.arange(n) * 7919) % 65_536].tolist()))
    assert list(np.asarray(slabs[0].categories, dtype=object)[values]) == names[(np.arange(n) * 7919) % 65_536].tolist()


# ---------------------------------------------------------------------------- no reader cache

def test_slab_reads_leave_the_readers_cache_empty(stores):
    path, _ = stores["zarr"]
    reader = ZarrReader(enable_caching=True)
    before = reader.get_cache_info()
    for source in ({"type": "obs", "key": "ctype"}, {"type": "obs", "key": "depth"}, {"type": "obs", "key": "nullable"},
                   {"type": "obs", "key": "flag"}, {"type": "obsm", "key": "wide", "column": "3"},
                   {"type": "obsm", "key": "sparse_m", "column": "3"}):
        for rows in (None, ROWS["scattered"]):
            list(cs.column(reader, path, source, rows))
    assert reader.get_cache_info() == before
    # a layer or obsp source looks up a gene or cell name, and the reader keeps the names for that: its own cache
    # a layer or obsp source looks up a gene or cell name, and the reader keeps the names for that: its own cache


def test_disable_caching_is_not_passed_on_when_the_cache_is_off(stores):
    path, _ = stores["zarr"]
    reader = ZarrReader(enable_caching=False)
    got = reader.get_obs_var_codes("cells", path, "ctype", [0, 1, 2], disable_caching=True)
    assert len(got[0]) == 3
    assert reader.get_obs_var_numeric("cells", path, "depth", [0, 1], disable_caching=True).shape == (2,)


def test_cached_method_strips_disable_caching_unless_the_method_takes_it():
    class Cache:
        enable_caching = False

    class Holder:
        cache = Cache()

        @cached_method
        def plain(self, x, dataset_path=None):
            return x

        @cached_method
        def takes(self, x, dataset_path=None, disable_caching=False):
            return (x, disable_caching)
    h = Holder()
    assert h.plain(1, dataset_path="p", disable_caching=True) == 1
    assert h.takes(1, dataset_path="p", disable_caching=True) == (1, True)


def test_a_reader_without_a_cache_is_called_as_it_is():
    class Subset:
        def get_obs_var_numeric(self, entity, dataset_path, column_name, indices):
            return ("ok", entity)
    assert cs._uncached(Subset(), "get_obs_var_numeric", "cells", "p", "c", [0]) == ("ok", "cells")


def test_the_store_helpers_are_public(stores):
    path, _ = stores["zarr"]
    with cs.root(get_reader(path), path) as store:
        assert cs.n_cells(store) == N_OBS
        assert cs.is_group(store["obs"]) and not cs.is_group(store["obs"]["depth"])
    assert not any(hasattr(cs, n) for n in ("_root", "_n_cells", "_is_group"))


@pytest.mark.parametrize("backend", BACKENDS)
@pytest.mark.parametrize("key,lane", [("note", "heavy"), ("flag", "light"), ("depth", "light"), ("ctype", "light")])
def test_a_plain_text_obs_partitioning_is_planned_on_the_heavy_lane(stores, backend, key, lane):
    from annzarro.core import cell_groups as cg
    path, _ = stores[backend]
    req = cg.parse_request({"shape": "grouping", "partitionings": [{"source": {"type": "obs", "key": key}}] if
                            key != "depth" else [{"source": {"type": "obs", "key": key},
                                                  "binning": {"method": "equal_width", "bins": 4}}]})
    assert cg.plan(get_reader(path), path, req).lane == lane
