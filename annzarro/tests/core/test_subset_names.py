"""A cell subset's names are read by index, not by reading every name.

Opening a 10-million-cell Tahoe store on the default 100,000-cell subset spent
2.9 s in ``/data/cells``: the subset view read all 10 million names and kept
100,000 (about 30 s extrapolated to Tahoe-100M, and every name in memory at
once). ``string_chunks.take`` reads the index one chunk at a time and, for a
local ``vlen-utf8`` chunk, finds the wanted names in the encoded bytes.

The decoder is checked against numcodecs on adversarial inputs: it must give
the exact names or decline (None), never a wrong name.
"""
import json

import numcodecs
import numpy as np
import pytest

from annzarro.core import string_chunks
from annzarro.core import subset as cell_subset
from annzarro.core import zarr_reader
from annzarro.core.zarr_reader import ZarrReader
from annzarro.server.core import create_app
from annzarro.tests.zarr_compat import open_group, write_array, write_strings

CASES = {
    "fixed width": [f"AAAC{i:06d}-1" for i in range(50)],
    "variable": ["a", "bb", "", "cccc", "ddddddddd", "e"],
    "all empty": ["", "", ""],
    "empty run": ["x", "", "", "y"],
    "multibyte": ["é", "漢字", "naïve", "😀x"],
    "length 256": ["z" * 256, "y", "x" * 512],
    "long": ["q" * 70000, "r"],
    "nul inside": ["a\x00b", "c", "\x00"],
    "single": ["only"],
    "none": [],
}


@pytest.mark.parametrize("name", sorted(CASES))
def test_decoder_is_exact_or_declines(name):
    items = CASES[name]
    encoded = numcodecs.VLenUTF8().encode(np.array(items, dtype=object))
    positions = np.arange(len(items))
    got = string_chunks.decode_vlen_items(encoded, positions)
    assert got is None or got == items
    if name in ("fixed width", "variable", "multibyte", "single", "all empty", "none"):
        assert got == items, "this layout must take the fast path"


def test_decoder_random_layouts():
    rng = np.random.default_rng(7)
    alphabet = list("abcxyz-_0123456789é漢")
    for _ in range(300):
        n = int(rng.integers(0, 40))
        lengths = rng.choice([0, 1, 3, 255, 256, 257], size=n, p=[.1, .3, .3, .1, .1, .1])
        items = ["".join(rng.choice(alphabet, size=int(k))) for k in lengths]
        encoded = numcodecs.VLenUTF8().encode(np.array(items, dtype=object))
        pick = np.sort(rng.choice(n, size=min(n, 5), replace=False)) if n else np.array([], int)
        got = string_chunks.decode_vlen_items(encoded, pick)
        assert got is None or got == [items[i] for i in pick]


def _names(n):
    # variable length, so chunks exercise the zero-run parse as well
    return [f"cell_{i}" + ("x" * (i % 3)) for i in range(n)]


@pytest.fixture
def index_array(tmp_path):
    path = tmp_path / "s.zarr"
    root = open_group(path)
    names = _names(1000)
    names[500:600] = [""] * 100           # an all-empty chunk zarr may not write
    arr = write_strings(root, "idx", names, chunks=(100,))
    return arr, str(path / "idx"), names


@pytest.mark.parametrize("raw", [True, False])
def test_take_equals_slicing(index_array, raw):
    arr, directory, names = index_array
    rng = np.random.default_rng(1)
    for k in (1, 7, 250, 1000):
        rows = np.sort(rng.choice(len(names), size=k, replace=False))
        assert string_chunks.take(arr, rows, directory if raw else None) == [names[i] for i in rows]


def test_take_uses_the_raw_path_for_local_vlen_chunks(index_array, monkeypatch):
    arr, directory, names = index_array
    used = []
    real = string_chunks._LocalVlenArray.items

    def spy(self, *args):
        out = real(self, *args)
        used.append(out is not None)
        return out
    monkeypatch.setattr(string_chunks._LocalVlenArray, "items", spy)
    rows = np.arange(0, 1000, 9)
    assert string_chunks.take(arr, rows, directory) == [names[i] for i in rows]
    assert sum(used) >= 9, used   # every chunk with names, except the empty one zarr may skip


N_OBS = 3000


@pytest.fixture
def client(tmp_path):
    path = str(tmp_path / "data" / "big.zarr")
    root = open_group(path)
    root.attrs.update({"encoding-type": "anndata", "encoding-version": "0.1.0"})
    for name, names in (("obs", _names(N_OBS)), ("var", [f"g{i}" for i in range(4)])):
        g = root.create_group(name)
        g.attrs.update({"encoding-type": "dataframe", "encoding-version": "0.2.0",
                        "_index": "_index", "column-order": []})
        write_strings(g, "_index", names, chunks=(256,))
    x = write_array(root, "X", np.zeros((N_OBS, 4), dtype=np.float32))
    x.attrs.update({"encoding-type": "array", "encoding-version": "0.2.0"})
    zarr_reader.clear_cache()
    cell_subset.clear()
    app = create_app({"TESTING": True, "data_dir": str(tmp_path / "data"),
                      "log_file": str(tmp_path / "t.log"), "auth_enabled": False})
    yield app.test_client(), path
    zarr_reader.clear_cache()
    cell_subset.clear()


def test_subset_cells_does_not_read_every_name(client, monkeypatch):
    test_client, path = client
    spec = {"n": 100, "seed": 3}
    real = ZarrReader.get_cell_gene_names

    def whole_axis(self, dataset_path, entity, use_cache=False):
        if entity == "cells":
            raise AssertionError("read every cell name for a subset")
        return real(self, dataset_path, entity, use_cache)
    monkeypatch.setattr(ZarrReader, "get_cell_gene_names", whole_axis)

    resp = test_client.get("/api/v1/data/cells",
                           query_string={"dataset_path": path, "subset": json.dumps(spec)})
    assert resp.status_code == 200, resp.get_data(as_text=True)
    rows, _ = cell_subset.select_indices(N_OBS, cell_subset.parse_spec(json.dumps(spec)), None)
    assert resp.get_json()["cells"] == [_names(N_OBS)[i] for i in rows]

    # the typeahead over the subset's names is built from the same list
    found = test_client.get("/api/v1/data/names", query_string={
        "dataset_path": path, "entity": "cells", "q": _names(N_OBS)[rows[5]], "mode": "exact",
        "subset": json.dumps(spec)}).get_json()
    assert found["matches"] == [{"name": _names(N_OBS)[rows[5]], "index": 5, "row": int(rows[5])}]


def test_h5ad_names_by_index(tmp_path):
    import h5py
    from annzarro.core.h5ad_reader import h5adReader
    path = str(tmp_path / "n.h5ad")
    names = _names(500)
    with h5py.File(path, "w") as f:
        g = f.create_group("obs")
        g.attrs.update({"encoding-type": "dataframe", "encoding-version": "0.2.0",
                        "_index": "_index", "column-order": []})
        g.create_dataset("_index", data=np.array(names, dtype=object), dtype=h5py.string_dtype())
    rows = np.array([0, 3, 4, 250, 499])
    assert h5adReader().get_cell_gene_names_at(path, "cells", rows) == [names[i] for i in rows]


def test_rank_keys_block_by_block_pick_the_same_cells():
    """The subset without the n-long key array (3 GB at 95.6M cells): same rows."""
    rng = np.random.default_rng(4)
    for n_obs, k, seed in ((10_000, 37, 0), (10_000, 9_999, 3), (50_001, 1_000, 11)):
        expected = np.sort(cell_subset._smallest(cell_subset.rank_keys(n_obs, seed), k))
        got = np.sort(cell_subset._rows_with_smallest_keys(n_obs, None, seed, k, block=777))
        assert got.tolist() == expected.tolist()
        rows = np.sort(rng.choice(n_obs, size=n_obs // 3, replace=False))
        expected = np.sort(rows[cell_subset._smallest(cell_subset.rank_keys(n_obs, seed)[rows], k)])
        mask = np.zeros(n_obs, dtype=bool)
        mask[rows] = True
        got = np.sort(cell_subset._rows_with_smallest_keys(n_obs, mask, seed, k, block=500))
        assert got.tolist() == expected.tolist()


# --- the raw path against zarr's own decode ----------------------------------

def _tricky_names(n):
    rng = np.random.default_rng(n)
    pool = ["", "AAACCTGAGAAACCAT-1", "é漢字_ü", "😀,#;x", "a,b,c", "#hash#", "x" * 300, "y" * 256,
            "z" * 70_000, " leading", "trailing ", "tab\tin", "q\nline"]
    names = [f"cell_{i}" for i in range(n)]
    for i in rng.choice(n, size=n // 4, replace=False):
        names[i] = pool[int(rng.integers(len(pool)))] + ("" if rng.random() < 0.5 else f"_{i}")
    return names


def _fixed_names(n):
    return [f"{i:08d}-lib_1105" for i in range(n)]


def _variable_names(n):
    # non-ASCII, '#', commas, long; no empty name and no length a multiple
    # of 256, so the zero-run parse can vouch for every chunk
    pool = ["é漢字_ü", "😀,#;x", "a,b,c", "#hash#", "x" * 300, "z" * 70_001, "AAACCTGAGAAACCAT-1"]
    return [f"{pool[i % len(pool)]}{i}" for i in range(n)]


COMPRESSORS = {
    "blosc-zstd": lambda: numcodecs.Blosc(cname="zstd", clevel=3, shuffle=numcodecs.Blosc.SHUFFLE),
    "blosc-lz4": lambda: numcodecs.Blosc(cname="lz4", clevel=5, shuffle=numcodecs.Blosc.SHUFFLE),
    "zstd": lambda: numcodecs.Zstd(level=3),
    "none": lambda: None,
}


@pytest.mark.parametrize("compressor", sorted(COMPRESSORS))
@pytest.mark.parametrize("make", [_tricky_names, _variable_names, _fixed_names],
                         ids=["tricky", "variable", "fixed"])
def test_raw_path_equals_zarr_decode(tmp_path, compressor, make, monkeypatch):
    n, chunk = 2_050, 256                      # the last chunk is partial (2 of 256)
    names = make(n)
    root = open_group(tmp_path / "s.zarr")
    arr = write_strings(root, "idx", names, chunks=(chunk,), compressor=COMPRESSORS[compressor]())
    directory = str(tmp_path / "s.zarr" / "idx")
    meta = json.load(open(directory + "/.zarray"))
    assert [f["id"] for f in meta["filters"]] == ["vlen-utf8"]

    used = []
    real = string_chunks._LocalVlenArray.items
    monkeypatch.setattr(string_chunks._LocalVlenArray, "items",
                        lambda self, *a: used.append(real(self, *a)) or used[-1])
    truth = np.asarray(arr[:]).tolist()          # zarr's own decode of every name
    assert truth == names
    rng = np.random.default_rng(5)
    picks = [np.array([0]), np.array([n - 1]), np.array([0, n - 1]), np.arange(n),
             np.arange(chunk * 8, n)]
    picks += [np.sort(rng.choice(n, size=k, replace=False)) for k in (1, 3, 100, 1_000)]
    for rows in picks:
        assert string_chunks.take(arr, rows, directory) == [truth[i] for i in rows]
    if make is not _tricky_names:
        # every chunk, the padded last one included, is read by the raw path
        assert used and all(u is not None for u in used), "a chunk fell back to zarr"


def test_untested_layouts_take_the_zarr_path(tmp_path):
    root = open_group(tmp_path / "s.zarr")
    write_strings(root, "a", ["x", "y"], chunks=(1,), compressor=numcodecs.GZip())
    assert string_chunks._LocalVlenArray.open(str(tmp_path / "s.zarr" / "a")) is None
    assert string_chunks._LocalVlenArray.open(str(tmp_path / "missing")) is None
    assert string_chunks._LocalVlenArray.open(None) is None


def test_subset_names_are_cached_and_counted(client, monkeypatch):
    test_client, path = client
    calls = []
    real = string_chunks.take
    monkeypatch.setattr(string_chunks, "take", lambda *a, **k: calls.append(1) or real(*a, **k))
    query = {"dataset_path": path, "subset": json.dumps({"n": 50, "seed": 1})}
    first = test_client.get("/api/v1/data/cells", query_string=query).get_json()["cells"]
    # a second panel, the typeahead, a reopen: names are not decoded again
    assert test_client.get("/api/v1/data/cells", query_string=query).get_json()["cells"] == first
    test_client.get("/api/v1/data/names", query_string={**query, "entity": "cells", "q": "cell"})
    assert len(calls) == 1
    from annzarro.core import get_reader
    cache = get_reader(path).cache
    keys = [k for k in cache._sizes_mb if ":names_at:" in k]
    assert len(keys) == 1, keys
    # charged by the names it holds (57 B + length each), inside memory_usage_mb
    assert cache._sizes_mb[keys[0]] * 2**20 >= sum(57 + len(n) for n in first)
    assert cache.memory_usage_mb >= cache._sizes_mb[keys[0]]
