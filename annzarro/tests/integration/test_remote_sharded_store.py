"""A sharded zarr format 3 store over HTTP: reads come back right, and by byte range.

zarr reads a shard's index and then only the inner chunks it needs, each as an HTTP range
request, so a row of a big sharded matrix does not download its shard. ``http.server`` ignores
the ``Range`` header and would answer a range with the whole file; the handler below honours it
(as nginx, S3 and GCS do) and logs every request with the bytes it sent.
"""
import functools
import http.server
import os
import re
import threading

import numpy as np
import pytest
import zarr

from annzarro.core import remote
from annzarro.server.core import create_app
from annzarro.tests.utils.twin_store import build_v2_twin, convert_twins

pytest.importorskip("fsspec")
pytest.importorskip("aiohttp")
pytestmark = pytest.mark.skipif(int(zarr.__version__.split(".")[0]) < 3, reason="needs zarr 3")

_RANGE = re.compile(r"bytes=(\d*)-(\d*)")


class _RangeHandler(http.server.SimpleHTTPRequestHandler):
    requests = []                     # (path, Range header or None, bytes sent)

    def do_GET(self):
        path = self.translate_path(self.path)
        if not os.path.isfile(path):
            return super().do_GET()
        with open(path, "rb") as fh:
            body = fh.read()
        total = len(body)
        header = self.headers.get("Range")
        match = _RANGE.match(header) if header else None
        if match:
            first, last = match.groups()
            if first == "":                                   # suffix: the last N bytes
                start, end = max(0, total - int(last)), total - 1
            else:
                start, end = int(first), min(int(last) if last else total - 1, total - 1)
            body = body[start:end + 1]
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{total}")
        else:
            self.send_response(200)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        type(self).requests.append((self.path, header, len(body)))

    def log_message(self, *args):
        pass


@pytest.fixture(scope="module")
def served(tmp_path_factory):
    root = tmp_path_factory.mktemp("served")
    v2 = str(root / "twin_v2.zarr")
    build_v2_twin(v2)
    stores = convert_twins(v2, str(root))
    handler = type("Handler", (_RangeHandler,), {"requests": []})
    server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), functools.partial(handler, directory=str(root)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}", handler, stores
    server.shutdown()
    server.server_close()


@pytest.fixture
def client(tmp_path, monkeypatch):
    for var in (remote.ENV_MODE, remote.ENV_ALLOWLIST, remote.ENV_CREDENTIALS):
        monkeypatch.delenv(var, raising=False)
    saved = remote.get_remote_policy()
    app = create_app({"TESTING": True, "host": "127.0.0.1", "log_file": str(tmp_path / "server.log")})
    yield app.test_client()
    remote._policy = saved


ROUTES = [
    "/api/v1/data/obsp/conn?rows=3,77&format=f32",
    "/api/v1/data/obsp/knn?rows=3,77&format=f32",
    "/api/v1/data/varp/corr?rows=7&format=f32",
    "/api/v1/data/layer/dense?cols=4&format=f32",
    "/api/v1/data/layer/csr?cols=2&format=f32",
    "/api/v1/data/X?cols=3&format=f32",
    "/api/v1/data/obs?columns=cell_type",
]


@pytest.mark.parametrize("route", ROUTES)
def test_a_sharded_store_over_http_reads_like_the_same_store_on_disk(served, client, route):
    base, _, stores = served
    local = client.get(f"{route}&dataset_path={stores['sharded']}")
    remote_reply = client.get(f"{route}&dataset_path={base}/twin_sharded.zarr")
    assert local.status_code == 200, local.get_data(as_text=True)[:300]
    assert remote_reply.status_code == 200, remote_reply.get_data(as_text=True)[:300]
    if local.mimetype == "application/json":
        want, got = local.get_json(), remote_reply.get_json()
        want.pop("dataset_path"), got.pop("dataset_path")
        assert got == want
    else:
        assert remote_reply.get_data() == local.get_data()


def test_a_row_of_a_sharded_matrix_is_fetched_by_byte_range(served, client):
    """The shard of obsp/conn holds several inner chunks; one row must cost a range request
    for the shard's index and one for the inner chunk, not the shard file."""
    base, handler, stores = served
    conn = zarr.open_group(stores["sharded"], mode="r")["obsp"]["conn"]
    shard_files = {os.path.relpath(os.path.join(d, f), stores["sharded"]).replace(os.sep, "/")
                   for d, _, fs in os.walk(os.path.join(stores["sharded"], "obsp", "conn", "c")) for f in fs}
    sizes = {f: os.path.getsize(os.path.join(stores["sharded"], f)) for f in shard_files}
    assert conn.shards[0] > conn.chunks[0], "the twin must hold several inner chunks per shard"
    before = len(handler.requests)
    reply = client.get("/api/v1/data/obsp/conn", query_string={
        "dataset_path": f"{base}/twin_sharded.zarr", "rows": "6", "format": "f32"})
    assert reply.status_code == 200
    made = [r for r in handler.requests[before:] if "/obsp/conn/c/" in r[0]]
    assert made, "no shard was read"
    for path, header, sent in made:
        assert header is not None, f"{path} was fetched whole"
        assert sent < max(sizes.values()) / 2, (path, header, sent, sizes)
    np.testing.assert_array_equal(
        np.frombuffer(reply.get_data(), dtype=np.float32),
        zarr.open_group(stores["sharded"], mode="r")["obsp"]["conn"][6, :])


@pytest.mark.parametrize("cache_mb,requests_for_two_rows", [(64, 2), (0, 4)])
def test_chunk_cache_keeps_the_ranges_of_a_sharded_store(served, tmp_path, monkeypatch,
                                                         cache_mb, requests_for_two_rows):
    """Rows 6 and 7 share an inner chunk. Cached, the second row is read locally: two requests
    in all (the shard's index and the inner chunk). Uncached, each row costs both again. Before,
    the cache kept whole files only, so a sharded store never hit it."""
    for var in (remote.ENV_MODE, remote.ENV_ALLOWLIST, remote.ENV_CREDENTIALS):
        monkeypatch.delenv(var, raising=False)
    saved = remote.get_remote_policy()
    base, handler, _ = served
    try:
        client = create_app({"TESTING": True, "host": "127.0.0.1", "remote_chunk_cache_mb": cache_mb,
                             "log_file": str(tmp_path / "server.log")}).test_client()
        before = len(handler.requests)
        for row in ("6", "7"):
            reply = client.get("/api/v1/data/obsp/conn", query_string={
                "dataset_path": f"{base}/twin_sharded.zarr", "rows": row, "format": "f32"})
            assert reply.status_code == 200
        made = [r for r in handler.requests[before:] if "/obsp/conn/c/" in r[0]]
        assert len(made) == requests_for_two_rows, made
    finally:
        remote._policy = saved


def test_a_server_that_ignores_range_requests_gets_an_error_that_says_so(served, client):
    """``python -m http.server`` answers a range request with the whole file; the shard index then
    fails its checksum. The reply names the cause (it was a bare "checksum do not match")."""
    base, _, stores = served
    plain_server = http.server.ThreadingHTTPServer(
        ("127.0.0.1", 0), functools.partial(http.server.SimpleHTTPRequestHandler,
                                            directory=os.path.dirname(stores["sharded"])))
    threading.Thread(target=plain_server.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{plain_server.server_port}/twin_sharded.zarr"
        bad = client.get("/api/v1/data/obsp/conn", query_string={"dataset_path": url, "rows": "6"})
        assert bad.status_code == 500
        assert "Range" in bad.get_json()["error"] and "sharded" in bad.get_json()["error"]
        # the unsharded twin needs no ranges: the same server serves it
        ok = client.get("/api/v1/data/obsp/conn", query_string={
            "dataset_path": url.replace("twin_sharded", "twin_plain"), "rows": "6"})
        assert ok.status_code == 200
    finally:
        plain_server.shutdown()
        plain_server.server_close()
