"""Every process_file entry point is answered from the cache on a repeat (#30).

``cached_method`` used to read ``dataset_path`` from kwargs only, and four of
the seven decorated h5ad call sites in process_file pass it positionally
(get_metadata, get_uns, get_X, get_layer), so they never cached; get_X had no
key branch at all, and a uns group or string was cached in a bucket the
lookup never read. h5ad shows it most plainly because its reader has no
second cache layer: every repeat re-opened the file.

Each entry point is called twice with the same arguments, for both readers.
The first call must store a result, the second must store nothing (a miss
stores) and, for h5ad, must not open the file at all.
"""
import h5py
import numpy as np
import pytest
from flask import Flask

from annzarro.core import process_file
from annzarro.core import h5ad_reader as h5ad_module
from annzarro.core.h5ad_reader import h5adReader
from annzarro.core.zarr_reader import ZarrReader
from annzarro.tests.server.rich_store import make_rich_store
from annzarro.tests.core.h5ad_twin import h5ad_twin


def _add_sparse(path):
    import zarr
    root = zarr.open_group(path, mode="a")
    knn = root["obsp"].create_group("knn")
    knn.attrs.update({"encoding-type": "csr_matrix", "encoding-version": "0.1.0", "shape": [200, 200]})
    rows = np.repeat(np.arange(200), 3)
    cols = (rows + np.tile([1, 2, 3], 200)) % 200
    knn.create_array("indptr", data=np.arange(0, 601, 3, dtype=np.int32))
    knn.create_array("indices", data=cols.astype(np.int32))
    knn.create_array("data", data=np.ones(600, dtype=np.float32))
    pcs = root["varm"].create_array("PCs", data=np.arange(40, dtype=np.float64).reshape(20, 2))
    pcs.attrs.update({"encoding-type": "array", "encoding-version": "0.2.0"})
    zarr.consolidate_metadata(path)


@pytest.fixture(scope="module")
def stores(tmp_path_factory):
    d = tmp_path_factory.mktemp("cache")
    zpath = make_rich_store(d / "rich.zarr")
    _add_sparse(zpath)
    return {"zarr": zpath, "h5ad": h5ad_twin(zpath, d / "rich.h5ad")}


#: (label, call) for every function process_file exposes to the routes
ENTRY_POINTS = [
    ("extract_metadata", lambda p, r: process_file.extract_metadata(p, r)),
    ("extract_cells_genes cells", lambda p, r: process_file.extract_cells_genes(p, "cells", r)),
    ("extract_cells_genes genes", lambda p, r: process_file.extract_cells_genes(p, "genes", r)),
    ("extract_obs_var obs", lambda p, r: process_file.extract_obs_var(p, r, None, ["leiden"], True, "cells")),
    ("extract_obs_var var", lambda p, r: process_file.extract_obs_var(p, r, [1, 2], ["gene_name"], True, "genes")),
    ("extract_obsm_varm obsm", lambda p, r: process_file.extract_obsm_varm(p, r, "X_umap", None, None, "1", "cells")),
    ("extract_obsm_varm varm", lambda p, r: process_file.extract_obsm_varm(p, r, "PCs", [3], None, None, "genes")),
    ("extract_uns group", lambda p, r: process_file.extract_uns("run", p, r)),
    ("extract_uns string", lambda p, r: process_file.extract_uns("title", p, r)),
    ("extract_uns array", lambda p, r: process_file.extract_uns("vec", p, r)),
    ("extract_X column", lambda p, r: process_file.extract_X(p, None, [4], r)),
    ("extract_X row", lambda p, r: process_file.extract_X(p, [7], None, r)),
    ("extract_layer", lambda p, r: process_file.extract_layer(p, "counts", None, [2], r)),
    ("extract_layer X", lambda p, r: process_file.extract_layer(p, "X", [5], None, r)),
    ("extract_obsp_varp sparse obsp", lambda p, r: process_file.extract_obsp_varp(p, "knn", [9], None, "cells", r)),
    ("extract_obsp_varp dense obsp", lambda p, r: process_file.extract_obsp_varp(p, "conn", [9], None, "cells", r)),
    ("extract_obsp_varp varp", lambda p, r: process_file.extract_obsp_varp(p, "corr", [3], None, "genes", r)),
]


@pytest.fixture
def opens(monkeypatch):
    count = [0]
    real = h5py.File

    def counting(*a, **k):
        count[0] += 1
        return real(*a, **k)

    monkeypatch.setattr(h5ad_module.h5py, "File", counting)
    return count


@pytest.mark.parametrize("fmt,make", [("zarr", ZarrReader), ("h5ad", h5adReader)])
@pytest.mark.parametrize("label,call", ENTRY_POINTS, ids=[e[0] for e in ENTRY_POINTS])
def test_entry_point_repeat_is_a_cache_hit(stores, fmt, make, label, call, opens, monkeypatch):
    path, reader = stores[fmt], make()
    added = []
    real_add = reader.cache._add_to_cache
    monkeypatch.setattr(reader.cache, "_add_to_cache",
                        lambda key, *a, **k: (added.append(key), real_add(key, *a, **k))[1])
    app = Flask(__name__)
    with app.app_context():
        first = call(path, reader)
        stored_first = list(added)
        opens_before = opens[0]
        second = call(path, reader)
    status = first[1] if isinstance(first, tuple) else first.status_code
    assert status == 200, first[0].get_json() if isinstance(first, tuple) else first.get_json()
    assert stored_first, f"{label}: the first call cached nothing"
    assert added == stored_first, f"{label}: the repeat missed and cached {added[len(stored_first):]}"
    assert first.get_data() == second.get_data()
    if fmt == "h5ad":
        assert opens[0] == opens_before, f"{label}: the repeat opened the file again"


def test_positional_and_keyword_calls_share_one_entry(stores, opens):
    reader = h5adReader()
    path = stores["h5ad"]
    a = reader.get_X(path, None, [3])
    n = opens[0]
    b = reader.get_X(dataset_path=path, col_indices=[3])
    assert b is a and opens[0] == n


def test_uns_group_and_string_are_read_from_the_bucket_they_were_written_to(stores):
    """get_uns used to store a dict as 'dataframe' and a str as 'metadata'
    but always look in 'matrix', so neither was ever a hit."""
    reader = h5adReader()
    for key in ("run", "title", "vec"):
        reader.get_uns(key, stores["h5ad"])
    assert reader.get_cache_info()["item_counts"]["matrix"] == 3


def test_listing_warms_the_configured_reader(stores, tmp_path):
    """The /datasets listing's shape probe fills the metadata cache the
    routes read, also for a second app in the process (positional
    get_metadata used to bypass the cache entirely)."""
    import shutil
    from annzarro.server.core import create_app
    import annzarro.core as core

    data = tmp_path / "data"
    data.mkdir()
    shutil.copy(stores["h5ad"], data / "rich.h5ad")
    config = {"TESTING": True, "host": "127.0.0.1", "data_dir": str(data),
              "log_file": str(tmp_path / "t.log"), "auth_enabled": False}
    create_app(dict(config))
    app = create_app(dict(config))
    client = app.test_client()
    listing = client.get("/api/v1/datasets").get_json()
    assert [(d["name"], d["cells"], d["genes"]) for d in listing] == [("rich.h5ad", 200, 20)]
    keys = core.h5ad_reader_obj.get_cache_info()["datasets"]
    assert str(data / "rich.h5ad") in keys


def test_unreadable_h5ad_is_not_listed_and_not_cached_as_empty(tmp_path):
    from annzarro.server.core import create_app
    import annzarro.core as core

    data = tmp_path / "data"
    data.mkdir()
    (data / "broken.h5ad").write_bytes(b"not an hdf5 file")
    app = create_app({"TESTING": True, "host": "127.0.0.1", "data_dir": str(data),
                      "log_file": str(tmp_path / "t.log"), "auth_enabled": False})
    assert app.test_client().get("/api/v1/datasets").get_json() == []
    with pytest.raises(OSError):
        core.h5ad_reader_obj.get_metadata(str(data / "broken.h5ad"))
    assert core.h5ad_reader_obj.get_cache_info()["item_counts"]["total"] == 0
