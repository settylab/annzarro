"""Remote zarr stores, end to end: a real HTTP server, the real Flask routes.

A small AnnData-shaped zarr v2 store is served by ``http.server`` on a loopback
port, and the data routes are asked for it by URL through the Flask test
client. This is the path that used to answer 404 for every remote store,
because ``get_reader`` checked ``Path(url).exists()`` on the local disk.

Two opt-in tests (``ANNZARRO_TEST_NETWORK=1``) read real public stores and
print latency; they skip when the network is unavailable.
"""

import functools
import http.server
import os
import re
import threading
import time

import numpy as np
import pytest
import scipy.sparse as sp
import zarr

from annzarro.core import remote
from annzarro.core.zarr_reader import ZarrReader
from annzarro.server.core import create_app

pytest.importorskip("fsspec")
pytest.importorskip("aiohttp")

_ZARR_V3 = int(zarr.__version__.split(".")[0]) >= 3

N_OBS, N_VAR = 12, 5
CELLS = [f"cell_{i}" for i in range(N_OBS)]
GENES = [f"gene_{j}" for j in range(N_VAR)]
CATEGORIES = ["B", "NK", "T"]
CODES = (np.arange(N_OBS) % 3).astype(np.int8)
X_DENSE = np.arange(N_OBS * N_VAR, dtype=np.float32).reshape(N_OBS, N_VAR) % 7
X_DENSE[X_DENSE < 3] = 0  # make it genuinely sparse
UMAP = np.stack([np.arange(N_OBS), -np.arange(N_OBS)], axis=1).astype(np.float32)
CONN = sp.random(N_OBS, N_OBS, density=0.3, format="csr", random_state=0, dtype=np.float32)


# --------------------------------------------------------------------------
# fixture store (written with whichever zarr major is installed, format 2)
# --------------------------------------------------------------------------

def _array(group, name, values):
    values = np.asarray(values)
    if values.dtype.kind == "U":
        if _ZARR_V3:
            arr = group.create_array(name, shape=values.shape, dtype=str)
            arr[:] = list(values)
            return arr
        import numcodecs
        return group.create_dataset(name, data=values.astype(object), dtype=object,
                                    object_codec=numcodecs.VLenUTF8())
    if _ZARR_V3:
        arr = group.create_array(name, shape=values.shape, dtype=values.dtype)
        arr[...] = values
        return arr
    return group.create_dataset(name, data=values)


def _encode(node, encoding):
    node.attrs["encoding-type"] = encoding
    node.attrs["encoding-version"] = "0.1.0" if encoding != "dataframe" else "0.2.0"


def _csr(parent, name, matrix):
    grp = parent.create_group(name)
    _encode(grp, "csr_matrix")
    grp.attrs["shape"] = list(matrix.shape)
    _array(grp, "data", matrix.data)
    _array(grp, "indices", matrix.indices)
    _array(grp, "indptr", matrix.indptr)


def _dataframe(parent, name, index, columns):
    grp = parent.create_group(name)
    _encode(grp, "dataframe")
    grp.attrs["_index"] = "_index"
    grp.attrs["column-order"] = list(columns)
    _array(grp, "_index", index)
    return grp


def _write_store(path):
    if _ZARR_V3:
        root = zarr.open_group(str(path), mode="w", zarr_format=2)
    else:
        root = zarr.open_group(str(path), mode="w")
    _encode(root, "anndata")
    _csr(root, "X", sp.csr_matrix(X_DENSE))

    obs = _dataframe(root, "obs", CELLS, ["cell_type", "total_counts"])
    cat = obs.create_group("cell_type")
    _encode(cat, "categorical")
    cat.attrs["ordered"] = False
    _array(cat, "codes", CODES)
    _array(cat, "categories", CATEGORIES)
    _array(obs, "total_counts", X_DENSE.sum(axis=1).astype(np.float64))
    _dataframe(root, "var", GENES, [])

    for group in ("obsm", "varm", "obsp", "varp", "layers", "uns"):
        _encode(root.create_group(group), "dict")
    _array(root["obsm"], "X_umap", UMAP)
    _csr(root["obsp"], "connectivities", CONN)
    # AnnData consolidates by default; remote reads depend on it for speed.
    zarr.consolidate_metadata(str(path))


STALL_S = 3.0
_CHUNK_KEY = re.compile(r"^\d+(\.\d+)*$")


class _Handler(http.server.SimpleHTTPRequestHandler):
    """Static files plus misbehaving endpoints; records every request path.

    /redirect/<p>      302 to /<p>
    /stall-all/<p>     accept the connection, then say nothing for STALL_S
    /stall-chunks/<p>  serve /<p>, but stall on chunk keys only: metadata
                       opens fine and the stall hits mid-read
    """

    requests = []

    def do_GET(self):
        type(self).requests.append(self.path)
        if self.path.startswith("/redirect/"):
            self.send_response(302)
            self.send_header("Location", self.path[len("/redirect"):])
            self.end_headers()
            return
        if self.path.startswith("/stall-all/"):
            time.sleep(STALL_S)
            return
        if self.path.startswith("/stall-chunks/"):
            self.path = self.path[len("/stall-chunks"):]
            if _CHUNK_KEY.match(self.path.rsplit("/", 1)[-1]):
                time.sleep(STALL_S)
                return
        super().do_GET()

    def log_message(self, *args):
        pass


@pytest.fixture(scope="module")
def http_store(tmp_path_factory):
    root = tmp_path_factory.mktemp("served")
    _write_store(root / "toy.zarr")
    handler = type("Handler", (_Handler,), {"requests": []})
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), functools.partial(handler, directory=str(root)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    yield base, handler
    server.shutdown()
    server.server_close()


@pytest.fixture
def make_client(tmp_path, monkeypatch):
    for var in (remote.ENV_MODE, remote.ENV_ALLOWLIST, remote.ENV_CREDENTIALS):
        monkeypatch.delenv(var, raising=False)
    saved = remote.get_remote_policy()

    def _make(**config):
        app = create_app({"TESTING": True, "host": "127.0.0.1",
                          "log_file": str(tmp_path / "server.log"), **config})
        return app.test_client()

    yield _make
    remote._policy = saved


def _get(client, route, url, **params):
    query = {"dataset_path": url, **params}
    return client.get(f"/api/v1/data/{route}", query_string=query)


# --------------------------------------------------------------------------
# the data routes, over HTTP
# --------------------------------------------------------------------------

def test_data_routes_read_a_zarr_store_over_http(http_store, make_client):
    base, handler = http_store
    url = f"{base}/toy.zarr"
    client = make_client()

    # X column: one gene, every cell
    resp = _get(client, "X", url, cols="2")
    assert resp.status_code == 200, resp.get_json()
    got = np.asarray(resp.get_json()["data"], dtype=np.float32).reshape(N_OBS, -1)
    np.testing.assert_array_equal(got[:, 0], X_DENSE[:, 2])

    # obs column: categorical, decoded to labels
    resp = _get(client, "obs", url, columns="cell_type")
    assert resp.status_code == 200, resp.get_json()
    body = resp.get_json()
    values = body["data"]["cell_type"] if isinstance(body["data"], dict) else body["data"]
    assert list(values) == [CATEGORIES[c] for c in CODES]

    # obsm column: second UMAP dimension
    resp = client.get("/api/v1/data/obsm/X_umap",
                      query_string={"dataset_path": url, "cols": "1"})
    assert resp.status_code == 200, resp.get_json()
    got = np.asarray(resp.get_json()["data"], dtype=np.float32).reshape(N_OBS, -1)
    np.testing.assert_array_equal(got[:, 0], UMAP[:, 1])

    # obsp row: one cell's neighbours, from a CSR graph
    resp = client.get("/api/v1/data/obsp/connectivities",
                      query_string={"dataset_path": url, "rows": "4"})
    assert resp.status_code == 200, resp.get_json()
    got = np.asarray(resp.get_json()["data"], dtype=np.float32).reshape(-1)
    np.testing.assert_allclose(got, CONN[4].toarray().ravel())

    # Structure (what the UI asks for first) works too.
    resp = _get(client, "dataset_structure", url)
    assert resp.status_code == 200, resp.get_json()
    assert resp.get_json()["shape"] == [N_OBS, N_VAR]

    # The root was opened once and reused: one consolidated-metadata fetch
    # for the five requests above, not one per request.
    assert handler.requests.count("/toy.zarr/.zmetadata") == 1


def test_missing_remote_store_is_404(http_store, make_client):
    base, _ = http_store
    resp = _get(make_client(), "X", f"{base}/nope.zarr", cols="0")
    assert resp.status_code == 404
    assert resp.get_json()["reason"] == "not_found"


def test_remote_h5ad_is_a_clear_400(http_store, make_client):
    base, _ = http_store
    resp = _get(make_client(), "obs", f"{base}/data.h5ad")
    assert resp.status_code == 400
    assert "Remote .h5ad files are not supported" in resp.get_json()["error"]


def test_hosted_server_refuses_remote_stores_by_default(http_store, make_client):
    base, handler = http_store
    before = len(handler.requests)
    client = make_client(host="0.0.0.0")
    resp = _get(client, "X", f"{base}/toy.zarr", cols="0")
    assert resp.status_code == 403
    assert resp.get_json()["reason"] == "access_denied"
    assert "remote_allowlist" in resp.get_json()["error"]
    assert len(handler.requests) == before, "a refused URL must not be fetched"

    # the URL probe endpoint obeys the same policy
    resp = client.get("/api/v1/zarr/url", query_string={"url": f"{base}/toy.zarr"})
    assert resp.get_json()["valid"] is False
    assert len(handler.requests) == before


def test_hosted_server_with_allowlist(http_store, make_client):
    base, _ = http_store
    client = make_client(auth_enabled=False, host="0.0.0.0",
                         remote_allowlist=[f"{base}/"])
    resp = _get(client, "X", f"{base}/toy.zarr", cols="1")
    assert resp.status_code == 200, resp.get_json()

    other = base.replace("127.0.0.1", "localhost")
    resp = _get(client, "X", f"{other}/toy.zarr", cols="1")
    assert resp.status_code == 403


def test_allowlisted_host_cannot_redirect_the_server(http_store, make_client):
    base, handler = http_store
    client = make_client(host="0.0.0.0", remote_allowlist=[f"{base}/redirect/"])
    before = len(handler.requests)
    resp = _get(client, "X", f"{base}/redirect/toy.zarr", cols="1")
    assert resp.status_code == 403, resp.get_json()
    assert "redirect" in resp.get_json()["error"]
    made = handler.requests[before:]
    assert made, "the allow-listed URL itself should have been requested"
    # ...but never the target it redirected to, which is outside the allowlist
    assert all(p.startswith("/redirect/") for p in made), made


# --------------------------------------------------------------------------
# timeouts: a store that goes quiet is a 504, never a hang or a zero-fill
# --------------------------------------------------------------------------

FAST_TIMEOUTS = {"remote_connect_timeout_s": 0.5, "remote_read_timeout_s": 0.3}


def test_store_that_stalls_on_open_is_a_504(http_store, make_client):
    base, _ = http_store
    client = make_client(**FAST_TIMEOUTS)
    start = time.perf_counter()
    resp = _get(client, "X", f"{base}/stall-all/toy.zarr", cols="0")
    elapsed = time.perf_counter() - start
    assert resp.status_code == 504, resp.get_json()
    body = resp.get_json()
    assert body["reason"] == "remote_timeout"
    assert "remote_read_timeout_s" in body["error"]
    assert elapsed < STALL_S, f"waited {elapsed:.1f}s; the timeout did not apply"


@pytest.mark.parametrize("route,params", [
    ("X", {"cols": "2"}),
    ("obs", {"columns": "total_counts"}),
    ("obsm/X_umap", {"cols": "1"}),
    ("obsp/connectivities", {"rows": "4"}),
])
def test_store_that_stalls_mid_read_is_a_504(http_store, make_client, route, params):
    base, _ = http_store
    url = f"{base}/stall-chunks/toy.zarr"
    client = make_client(**FAST_TIMEOUTS)
    # metadata is served normally, so the store opens...
    assert _get(client, "dataset_structure", url).status_code == 200
    # ...and the stall hits the chunk read. It must surface, not be read as an
    # absent chunk (which zarr would fill with zeros and answer 200).
    resp = _get(client, route, url, **params)
    assert resp.status_code == 504, resp.get_json()
    assert resp.get_json()["reason"] == "remote_timeout"


# --------------------------------------------------------------------------
# real public stores (opt-in: ANNZARRO_TEST_NETWORK=1)
# --------------------------------------------------------------------------

# An AnnData zarr (v2, CSR X, NOT consolidated) published by Vitessce. It is an
# S3 bucket behind CloudFront, so missing keys answer 403 rather than 404 --
# the case _http_status in core/remote.py exists for.
PUBLIC_HTTPS_ANNDATA = ("https://data-1.vitessce.io/0.0.33/main/human-lymph-node-10x-visium/"
                        "human_lymph_node_10x_visium.h5ad.zarr")
# A public, anonymous, consolidated zarr on AWS S3 (not AnnData: no public
# anonymous AnnData zarr on S3 proper was found). Exercises the s3:// opener.
PUBLIC_S3_ZARR = "s3://mur-sst/zarr-v1"
# The same kind of Vitessce AnnData store on a public GCS bucket, read via gs://.
PUBLIC_GCS_ANNDATA = "gs://vitessce-demo-data/habib-2017/habib17.processed.h5ad.zarr"

network = pytest.mark.skipif(
    os.environ.get("ANNZARRO_TEST_NETWORK") != "1",
    reason="network test; set ANNZARRO_TEST_NETWORK=1 to run")


def _timed(client, route, url, **params):
    start = time.perf_counter()
    resp = _get(client, route, url, **params)
    return resp, (time.perf_counter() - start) * 1000


@network
@pytest.mark.slow
def test_public_https_anndata_store(make_client, capsys):
    client = make_client()
    try:
        resp, ms = _timed(client, "dataset_structure", PUBLIC_HTTPS_ANNDATA)
    except Exception as exc:  # pragma: no cover - offline
        pytest.skip(f"unreachable: {exc}")
    if resp.status_code >= 500 and "Could not open" in str(resp.get_json()):
        pytest.skip(f"unreachable: {resp.get_json()}")
    assert resp.status_code == 200, resp.get_json()
    assert resp.get_json()["n_obs"] == 3861
    timings = {"structure (cold open)": ms}
    for label, route, params in [
        ("obs column", "obs", {"columns": "total_counts"}),
        ("obsm column", "obsm/X_umap", {"cols": "0"}),
    ]:
        resp, timings[label] = _timed(client, route, PUBLIC_HTTPS_ANNDATA, **params)
        assert resp.status_code == 200, (label, resp.get_json())
    with capsys.disabled():
        print("\n" + "\n".join(f"  HTTPS {k}: {v:.0f} ms" for k, v in timings.items()))


@network
def test_public_s3_store_opens_anonymously(capsys):
    pytest.importorskip("s3fs")
    reader = ZarrReader()
    start = time.perf_counter()
    try:
        valid, message = reader.validate_zarr_url(PUBLIC_S3_ZARR)
    except Exception as exc:  # pragma: no cover - offline
        pytest.skip(f"unreachable: {exc}")
    ms = (time.perf_counter() - start) * 1000
    if "Could not open" in message:
        pytest.skip(message)
    # found and opened anonymously; it is just not AnnData
    assert message == "Zarr archive found but missing AnnData structure"
    with capsys.disabled():
        print(f"\n  S3 anonymous open: {ms:.0f} ms")


@network
@pytest.mark.slow
def test_public_gcs_anndata_store(make_client, capsys):
    pytest.importorskip("gcsfs")
    client = make_client()
    resp, ms = _timed(client, "dataset_structure", PUBLIC_GCS_ANNDATA)
    if resp.status_code >= 500:
        pytest.skip(f"unreachable: {resp.get_json()}")
    assert resp.status_code == 200, resp.get_json()
    body = resp.get_json()
    assert body["n_obs"] == 13067
    # a bucket lists natively, so keys are discoverable without .zmetadata
    assert "X_umap" in body["obsm"]["keys"]
    timings = {"structure (cold open)": ms}
    for label, route, params in [
        ("X column", "X", {"cols": "0"}),
        ("obs column", "obs", {"columns": "CellType"}),
        ("obsm column", "obsm/X_umap", {"cols": "0"}),
    ]:
        resp, timings[label] = _timed(client, route, PUBLIC_GCS_ANNDATA, **params)
        assert resp.status_code == 200, (label, resp.get_json())
    with capsys.disabled():
        print("\n" + "\n".join(f"  GCS {k}: {v:.0f} ms" for k, v in timings.items()))
