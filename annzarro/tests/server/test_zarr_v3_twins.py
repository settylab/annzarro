"""A zarr format 3 store, plain or sharded, answers every read route like its format 2 twin.

The twin is built once with zarr alone: ``fixture_small.zarr`` plus a dense layer, a CSR layer
whose arrays span several chunks, dense and sparse obsp, a dense varp and category colors in
``uns``. ``make_fixture_zarr_v3.convert`` rewrites it as format 3, plain (same chunks) and
sharded (inner chunks from the docs' rule, shards of several inner chunks, the 1-D sparse
arrays sharded too), and each route below is asked of all three. Needs zarr 3 to write and
read format 3.
"""
import json
import os
import shutil

import pytest
import zarr

from annzarro.core import fingerprint, zarr_reader
from annzarro.server.core import create_app
from annzarro.tests.utils.twin_store import build_v2_twin, convert_twins

pytestmark = pytest.mark.skipif(int(zarr.__version__.split(".")[0]) < 3, reason="needs zarr 3")

N_OBS, N_VAR = 200, 20


@pytest.fixture(scope="module")
def stores(tmp_path_factory):
    base = tmp_path_factory.mktemp("twins")
    v2 = str(base / "twin_v2.zarr")
    build_v2_twin(v2)
    return {"v2": v2, **convert_twins(v2, str(base)), "base": str(base)}


@pytest.fixture(scope="module")
def client(stores):
    zarr_reader.clear_cache()
    app = create_app({"TESTING": True, "DEBUG": False, "auth_enabled": False, "data_dir": stores["base"]})
    yield app.test_client()
    zarr_reader.clear_cache()


def test_the_sharded_twin_is_really_sharded(stores):
    root = zarr.open_group(stores["sharded"], mode="r")
    assert root.metadata.zarr_format == 3
    conn, layer, corr = root["obsp"]["conn"], root["layers"]["dense"], root["varp"]["corr"]
    assert conn.shards is not None and conn.shards[0] > conn.chunks[0] and conn.chunks[1] == N_OBS
    assert corr.shards is not None and corr.chunks[1] == N_VAR
    assert layer.shards is not None and layer.shards != layer.chunks
    assert root["obsp"]["knn"]["data"].shards[0] > root["obsp"]["knn"]["data"].chunks[0]
    assert root["layers"]["csr"]["data"].shards is not None
    plain = zarr.open_group(stores["plain"], mode="r")
    assert plain["obsp"]["conn"].shards is None
    assert zarr.open_group(stores["v2"], mode="r").metadata.zarr_format == 2


ROUTES = {
    "obs": "/api/v1/data/obs?columns=cell_type,total_counts,leiden&rows=0,5,199",
    "obs_all": "/api/v1/data/obs?columns=cell_type",
    "var": "/api/v1/data/var?columns=gene_name",
    "obsm": "/api/v1/data/obsm/X_umap?rows=3,4,150",
    "X_col": "/api/v1/data/X?cols=3",
    "X_cols_rows": "/api/v1/data/X?cols=3,7,19&rows=1,100,150",
    "X_col_bin": "/api/v1/data/X?cols=3&format=f32",
    "layer_dense_col": "/api/v1/data/layer/dense?cols=4",
    "layer_dense_col_bin": "/api/v1/data/layer/dense?cols=4,11&format=f32",
    "layer_dense_rows": "/api/v1/data/layer/dense?rows=0,99,100,199",
    "layer_csr_col": "/api/v1/data/layer/csr?cols=2",
    "layer_csr_rows": "/api/v1/data/layer/csr?rows=10,11,150&format=f32",
    "obsp_dense_row": "/api/v1/data/obsp/conn?rows=0",
    "obsp_dense_rows_bin": "/api/v1/data/obsp/conn?rows=3,77,199&format=f32",
    "obsp_dense_row_cols": "/api/v1/data/obsp/conn?rows=21&cols=0,5,150",
    "obsp_csr_row": "/api/v1/data/obsp/knn?rows=0,100,199",
    "obsp_csr_rows_bin": "/api/v1/data/obsp/knn?rows=0,100,199&format=f32",
    "varp_row": "/api/v1/data/varp/corr?rows=7",
    "varp_rows_bin": "/api/v1/data/varp/corr?rows=0,19&format=f32",
    "uns_colors": "/api/v1/data/uns/cell_type_colors",
    "paginated_obsp": "/api/v1/data/paginated?matrix_type=obsp&key=conn&rows=0,1&page=0&page_size=5",
    "genes": "/api/v1/data/genes",
}


def _ask(client, stores, variant, route):
    path = stores[variant]
    sep = "&" if "?" in route else "?"
    reply = client.get(f"{route}{sep}dataset_path={path}")
    assert reply.status_code == 200, (variant, route, reply.get_data(as_text=True)[:300])
    headers = {k: v for k, v in reply.headers if k.lower().startswith("x-annzarro")}
    if reply.mimetype == "application/json":
        body = reply.get_json()
        body.pop("dataset_path", None)
        return body, headers
    return reply.get_data(), headers


@pytest.mark.parametrize("variant", ["plain", "sharded"])
@pytest.mark.parametrize("name", sorted(ROUTES))
def test_route_answers_like_the_format_2_twin(client, stores, variant, name):
    want, want_headers = _ask(client, stores, "v2", ROUTES[name])
    got, got_headers = _ask(client, stores, variant, ROUTES[name])
    assert got == want
    assert got_headers == want_headers
    assert got, "an empty body would pass the comparison for the wrong reason"


@pytest.mark.parametrize("variant", ["plain", "sharded"])
def test_a_categorical_obs_column_has_its_colors(client, stores, variant):
    body, _ = _ask(client, stores, variant, "/api/v1/data/obs?columns=cell_type")
    colors, _ = _ask(client, stores, variant, "/api/v1/data/uns/cell_type_colors")
    assert colors["data"] == ["#1f77b4", "#ff7f0e", "#2ca02c"]
    assert body["data"], body


def _order_free(value):
    """The same document with every list of plain names sorted and a string dtype named alike:
    zarr 3.0 lists the members of a format 3 group in directory order, and reads strings as
    ``object`` where later versions say ``StringDType()``."""
    if isinstance(value, dict):
        return {k: _order_free(v) for k, v in value.items()}
    if isinstance(value, list):
        items = [_order_free(v) for v in value]
        return sorted(items) if all(isinstance(v, str) for v in items) else items
    if isinstance(value, str) and value in ("StringDType()", "object"):
        return "string"
    return value


@pytest.mark.parametrize("variant", ["plain", "sharded"])
def test_structure_is_the_format_2_twins(client, stores, variant):
    want, _ = _ask(client, stores, "v2", "/api/v1/data/dataset_structure")
    got, _ = _ask(client, stores, variant, "/api/v1/data/dataset_structure")
    for body in (want, got):
        for key in ("name", "path", "consolidated_metadata"):
            body.pop(key, None)
    want, got = _order_free(want), _order_free(got)
    assert got == want
    assert set(got["layers"]["details"]["keys"]) == {"csr", "dense"}
    assert got["obsp"]["keys"] == ["conn", "knn"] and got["varp"]["keys"] == ["corr"]
    assert got["pairwise_chunking"] is None


@pytest.mark.parametrize("variant", ["plain", "sharded"])
def test_to_anndata_metadata_matches(client, stores, variant):
    want, _ = _ask(client, stores, "v2", "/api/v1/zarr/to_anndata")
    got, _ = _ask(client, stores, variant, "/api/v1/zarr/to_anndata")
    assert _order_free(got) == _order_free(want)


@pytest.mark.parametrize("variant", ["plain", "sharded"])
def test_fingerprint_is_the_same_from_consolidated_metadata_or_from_a_walk(stores, tmp_path, variant):
    """The cheap tier reads the consolidated copy in the root zarr.json when there is one,
    and walks the group tree when there is not: both must give the same document hash,
    and the field names of the format 2 twin, and a change of an attribute must change it."""
    copy = str(tmp_path / "c.zarr")
    shutil.copytree(stores[variant], copy)
    consolidated = fingerprint.metadata_part(copy)
    assert consolidated["meta"] and consolidated["fields"] == fingerprint.metadata_part(stores["v2"])["fields"]
    root_json = os.path.join(copy, "zarr.json")
    with open(root_json) as fh:
        doc = json.load(fh)
    assert doc["consolidated_metadata"]["metadata"], "the twin is consolidated"
    del doc["consolidated_metadata"]
    with open(root_json, "w") as fh:
        json.dump(doc, fh)
    walked = fingerprint.metadata_part(copy)
    assert walked["meta"] == consolidated["meta"]
    assert walked["groups"] == consolidated["groups"]
    layer_json = os.path.join(copy, "layers", "dense", "zarr.json")
    with open(layer_json) as fh:
        node = json.load(fh)
    node["attributes"]["note"] = "changed"
    with open(layer_json, "w") as fh:
        json.dump(node, fh)
    assert fingerprint.metadata_part(copy)["meta"] != walked["meta"]
