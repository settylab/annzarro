"""
/data/info lists every obsm key as an embedding.

It listed only keys starting with ``X_``, so a store with ``spatial`` and
``spatial_upright`` (Visium, Xenium) reported no such embeddings while the
plot axis menus offered them. Both now agree: every obsm key.
"""
import os
import shutil

import numpy as np
import zarr

from annzarro.core.zarr_reader import zarr_reader
from annzarro.server.core import create_app

FIXTURE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fixture_small.zarr"
)


def test_info_lists_obsm_keys_without_x_prefix(tmp_path):
    store = tmp_path / "s.zarr"
    shutil.copytree(FIXTURE, store)
    obsm = zarr.open_group(str(store / "obsm"), mode="a")
    n = obsm["X_umap"].shape[0]
    arr = obsm.create_array("spatial", shape=(n, 2), dtype="f4") if hasattr(obsm, "create_array") \
        else obsm.create_dataset("spatial", shape=(n, 2), dtype="f4")
    arr[:] = np.zeros((n, 2), dtype="f4")
    arr.attrs.update({"encoding-type": "array", "encoding-version": "0.2.0"})
    # the fixture's consolidated metadata must learn about the new array
    v3 = int(zarr.__version__.split(".")[0]) >= 3
    zarr.consolidate_metadata(str(store), **({"zarr_format": 2} if v3 else {}))
    zarr_reader.clear_cache()

    app = create_app({"TESTING": True, "DEBUG": False, "auth_enabled": False, "data_dir": str(tmp_path)})
    client = app.test_client()
    info = client.get("/api/v1/data/info", query_string={"dataset_path": str(store)}).get_json()
    assert sorted(info["embeddings"]) == ["X_umap", "spatial"]
    structure = client.get("/api/v1/data/dataset_structure", query_string={"dataset_path": str(store)}).get_json()
    assert sorted(structure["embeddings"]) == ["X_umap", "spatial"]
