"""
Scalar values in uns come back as values, not null.

GET /api/v1/data/uns/README on bm_aging.zarr answered {"data": null}: the
reader read every uns array with [:], which a 0-d array (AnnData writes a
str or number scalar that way) refuses, and the error turned the whole key
into None. Nested scalars inside a uns dict came back as the array's repr
string ("<zarr.Array ...>") the same way. Reading with [()] covers every
shape.
"""
import numpy as np
import pytest
import zarr

from annzarro.server.core import create_app

_ZARR_V3 = int(zarr.__version__.split(".")[0]) >= 3


def _arr(group, name, value, dtype=None):
    value = np.asarray(value, dtype=dtype)
    if _ZARR_V3:
        a = group.create_array(name, shape=value.shape, dtype=str if value.dtype.kind in "UO" else value.dtype)
    else:
        numcodecs = pytest.importorskip("numcodecs")
        kw = {"object_codec": numcodecs.VLenUTF8(), "dtype": object} if value.dtype.kind in "UO" else {"dtype": value.dtype}
        a = group.create_dataset(name, shape=value.shape, **kw)
    a[()] = value if value.ndim else value[()]  # zarr 2 VLenUTF8 takes a str, not a 0-d array
    return a


@pytest.fixture
def client_and_store(tmp_path):
    path = tmp_path / "s.zarr"
    root = zarr.open_group(str(path), mode="w", zarr_format=2) if _ZARR_V3 else zarr.open_group(str(path), mode="w")
    root.attrs.update({"encoding-type": "anndata", "encoding-version": "0.1.0"})
    uns = root.create_group("uns")
    _arr(uns, "README", "# Processed AnnData\nline two", dtype=object)
    _arr(uns, "n_pcs", 50)
    _arr(uns, "colors", ["#ff0000", "#00ff00"], dtype=object)
    params = uns.create_group("params")
    _arr(params, "method", "umap", dtype=object)
    _arr(params, "k", 15)
    app = create_app({"TESTING": True, "DEBUG": False, "auth_enabled": False, "data_dir": str(tmp_path)})
    return app.test_client(), str(path)


def _uns(client, store, key):
    resp = client.get(f"/api/v1/data/uns/{key}", query_string={"dataset_path": store})
    assert resp.status_code == 200, resp.get_json()
    return resp.get_json()["data"]


def test_scalar_string(client_and_store):
    client, store = client_and_store
    assert _uns(client, store, "README") == "# Processed AnnData\nline two"


def test_scalar_number_and_array(client_and_store):
    client, store = client_and_store
    assert _uns(client, store, "n_pcs") == 50
    assert _uns(client, store, "colors") == ["#ff0000", "#00ff00"]


def test_scalars_inside_a_dict(client_and_store):
    client, store = client_and_store
    assert _uns(client, store, "params") == {"method": "umap", "k": 15}
