"""/data/cells and /data/genes stream their names.

A request for every cell name of a 95.6M-cell store built a list of Python
strings, the JSON text of it and its gzip, ~9 GB, before the first byte went
out. A zarr store gives its names a chunk at a time, so the reply is written
the same way. These tests pin that the bytes are the ones the whole-list
reply had (the old path, kept for readers that cannot stream, is the
reference), that gzip, 304 and the error statuses are unchanged, and that a
stream holds one chunk, not the budget, and stops reading when the client
goes away.
"""
import gzip
import http.client
import json
import os
import shutil
import subprocess
import sys
import textwrap
import threading
import urllib.parse
from unittest.mock import patch

import numpy as np
import pytest
import zarr

from annzarro.core import process_file, read_guard
from annzarro.core.array_response import ABORT_MARK, name_streams, once, stream_names
from annzarro.server.core import create_app

FIXTURE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "fixture_small.zarr"
)

#: names that need escaping, and ones that look like something else
AWKWARD = ['a"b', "c\\d", "e\nf", "ünï", "tab\t", "", "123", "\x01ctl", " sep", "emoji \U0001f9ec",
           "trailing space ", "back\\\\slash", '"', "\\", "/slash"]


def make_store(path, names, chunk=30):
    """fixture_small.zarr with ``names`` as its cell index, in chunks of ``chunk``."""
    if int(zarr.__version__.split(".")[0]) < 3:
        pytest.skip("builds the store with the zarr 3 API")
    path = str(path)
    shutil.rmtree(path, ignore_errors=True)
    shutil.copytree(FIXTURE, path)
    shutil.rmtree(os.path.join(path, "obs", "_index"))
    index = zarr.open_group(path, mode="a")["obs"].create_array(
        "_index", shape=(len(names),), chunks=(chunk,), dtype=str)
    index[:] = np.array(names, dtype=object)
    zarr.consolidate_metadata(path)
    return path


def awkward_names(n=200):
    return AWKWARD + [f"cell_{i:05d}" for i in range(n - len(AWKWARD))]


def make_app(data_dir, **config):
    # slot_above 0: the 200-name fixtures take a stream slot like a long list
    return create_app({"TESTING": True, "DEBUG": False, "auth_enabled": False,
                       "data_dir": str(data_dir), "compress_responses": False,
                       "names_stream_slot_above": 0, **config})


@pytest.fixture(autouse=True)
def no_slot_left_over():
    yield
    left, name_streams._active = name_streams.active, 0
    del left


@pytest.fixture
def store(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    return data_dir, make_store(data_dir / "a.zarr", awkward_names())


def get(client, store, entity="cells", **kw):
    return client.get(f"/api/v1/data/{entity}", query_string={"dataset_path": store, **kw.pop("query", {})}, **kw)


def whole_list_reply(client, store, entity="cells", **kw):
    """The reply of the path that builds the list (every reader without a chunk iterator)."""
    with patch.object(process_file, "_stream_names", return_value=None):
        return get(client, store, entity, **kw)


@pytest.mark.parametrize("entity", ["cells", "genes"])
def test_streamed_bytes_are_the_whole_list_bytes(store, entity):
    data_dir, path = store
    client = make_app(data_dir).test_client()
    streamed = get(client, path, entity)
    old = whole_list_reply(client, path, entity)
    assert streamed.status_code == old.status_code == 200
    assert "X-Annzarro-Names" in streamed.headers and "X-Annzarro-Names" not in old.headers
    assert streamed.data == old.data
    assert streamed.mimetype == "application/json"


def test_awkward_names_survive(store):
    data_dir, path = store
    body = get(make_app(data_dir).test_client(), path).get_json()
    assert body["cells"] == awkward_names()
    assert body["dataset_path"] == path


def test_non_ascii_bytes_follow_ensure_ascii(store):
    # the provider's own setting decides whether a non-ASCII name is escaped
    data_dir, path = store
    app = make_app(data_dir)
    client = app.test_client()
    app.json.ensure_ascii = False
    streamed = get(client, path)
    assert streamed.data == whole_list_reply(client, path).data
    assert "ünï".encode() in streamed.data


def test_a_chunk_of_lists_gives_the_same_bytes(store):
    # a remote store or one the raw reader cannot open hands over lists of str
    data_dir, path = store
    client = make_app(data_dir).test_client()
    want = whole_list_reply(client, path).data
    from annzarro.core import string_chunks
    real = string_chunks.joined_items
    with patch.object(string_chunks, "joined_items", return_value=None):
        got = get(client, path)
    assert real is string_chunks.joined_items
    assert got.headers.get("X-Annzarro-Names") == "200"
    assert got.data == want


def test_the_empty_and_single_name_axes(tmp_path):
    for names in ([""], ["only"], ["a", "b"]):
        data_dir = tmp_path / "d"
        shutil.rmtree(data_dir, ignore_errors=True)
        data_dir.mkdir()
        path = make_store(data_dir / "a.zarr", names)
        client = make_app(data_dir).test_client()
        assert get(client, path).data == whole_list_reply(client, path).data


def test_headers_say_how_many_and_about_how_big(store):
    data_dir, path = store
    reply = get(make_app(data_dir).test_client(), path)
    assert reply.headers["X-Annzarro-Names"] == "200"
    assert "Content-Length" not in reply.headers
    assert reply.headers["X-Accel-Buffering"] == "no"
    estimate = int(reply.headers["X-Annzarro-Names-Bytes-Estimate"])
    assert 0.5 * len(reply.data) < estimate < 1.5 * len(reply.data)
    assert "X-Annzarro-Names" in reply.headers.get("Access-Control-Expose-Headers", "X-Annzarro-Names")


def test_genes_are_counted_by_the_var_axis(store):
    data_dir, path = store
    reply = get(make_app(data_dir).test_client(), path, "genes")
    assert reply.headers["X-Annzarro-Names"] == str(len(reply.get_json()["genes"]))


# -- one escape class at a time -------------------------------------------------
#
# A chunk with any awkward name takes the slow path whole, so a store of only
# awkward names would never reach the fast path's own checks. Here one name in
# an otherwise plain store, in a chunk of its own among plain ones.

CLASSES = {
    "newline": "a\nb", "non-ascii": "ünï", "line-separator": "x\u2028y", "del": "x\x7fy", "quote": 'q"uote',
    "backslash": "a\\b", "comma-quote": 'a","b', "control": "\x01", "emoji": "\U0001f9ec", "empty": "",
}


@pytest.mark.parametrize("ensure_ascii", [True, False])
@pytest.mark.parametrize("kind", sorted(CLASSES))
def test_each_escape_class_alone_is_the_whole_list_bytes(tmp_path, kind, ensure_ascii):
    names = [f"cell_{i:05d}" for i in range(120)]
    names[75] = CLASSES[kind]
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    path = make_store(data_dir / "a.zarr", names)
    app = make_app(data_dir)
    app.json.ensure_ascii = ensure_ascii
    client = app.test_client()
    streamed = get(client, path)
    assert streamed.headers["X-Annzarro-Names"] == "120"
    assert streamed.data == whole_list_reply(client, path).data
    assert streamed.get_json()["cells"] == names


def test_a_numeric_index_streams_as_text(tmp_path):
    # string_chunks reads every entry as a string; the whole-list path sent numbers
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    path = make_store(data_dir / "a.zarr", ["x"] * 3)
    group = zarr.open_group(path, mode="a")
    shutil.rmtree(os.path.join(path, "obs", "_index"))
    group["obs"].create_array("_index", data=np.array([0, 7, 9], dtype="int64"))
    zarr.consolidate_metadata(path)
    reply = get(make_app(data_dir).test_client(), path)
    assert reply.status_code == 200 and reply.headers["X-Annzarro-Names"] == "3"
    assert reply.get_json()["cells"] == ["0", "7", "9"]


def test_the_count_is_the_index_length_not_the_shape_of_x(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    path = make_store(data_dir / "a.zarr", awkward_names())
    group = zarr.open_group(path, mode="a")
    group["X"].attrs["shape"] = [7, 20]            # X says something else
    zarr.consolidate_metadata(path)
    reply = get(make_app(data_dir).test_client(), path)
    assert reply.headers["X-Annzarro-Names"] == "200"


def fake_chunks(*chunks, then=None):
    def make(self, *a, **kw):
        def gen():
            yield from chunks
            if then:
                raise then
        return gen()
    return patch("annzarro.core.zarr_reader.ZarrReader.iter_cell_gene_name_chunks", make)


@pytest.mark.parametrize("ensure_ascii", [True, False])
def test_a_first_chunk_that_cannot_be_written_is_a_500_not_a_cut_200(store, ensure_ascii):
    data_dir, path = store
    app = make_app(data_dir)
    app.json.ensure_ascii = ensure_ascii
    with fake_chunks((b"a\xff\nb", np.array([2, 1]))):          # invalid UTF-8
        reply = get(app.test_client(), path)
    assert reply.status_code == 500 and name_streams.active == 0
    assert "error" in reply.get_json()


def test_a_first_chunk_that_cannot_be_read_is_a_500(store):
    data_dir, path = store

    class Bad:
        def __iter__(self):
            return self

        def __next__(self):
            raise OSError("chunk unreadable")

    with patch("annzarro.core.zarr_reader.ZarrReader.iter_cell_gene_name_chunks", lambda *a, **k: Bad()):
        reply = get(make_app(data_dir).test_client(), path)
    assert reply.status_code == 500 and name_streams.active == 0


def test_an_invalid_chunk_after_the_first_aborts_the_reply(store):
    data_dir, path = store
    client = make_app(data_dir).test_client()
    with fake_chunks((b"a\nb", np.array([1, 1])), (b"\xff", np.array([1]))):
        reply = client.get("/api/v1/data/cells", query_string={"dataset_path": path}, buffered=False)
        pieces = []
        with pytest.raises(UnicodeDecodeError):
            for piece in reply.response:
                pieces.append(piece)
        reply.close()
    assert b"".join(pieces).endswith(ABORT_MARK)


# -- gzip ---------------------------------------------------------------------

def test_gzip_is_written_as_the_stream_goes_and_equals_the_plain_bytes(store):
    data_dir, path = store
    app = make_app(data_dir, compress_responses=True)
    client = app.test_client()
    want = whole_list_reply(make_app(data_dir).test_client(), path).data
    seen = []
    real = app.response_class.get_data

    def spy(self, *a, **kw):
        seen.append(self.is_streamed)
        return real(self, *a, **kw)

    with patch.object(app.response_class, "get_data", spy):
        reply = client.get("/api/v1/data/cells", query_string={"dataset_path": path},
                           headers={"Accept-Encoding": "gzip"}, buffered=False)
        raw = b"".join(reply.response)
    assert True not in seen, "a streamed reply was read whole"
    assert reply.headers["Content-Encoding"] == "gzip"
    assert "Accept-Encoding" in reply.headers["Vary"]
    assert gzip.decompress(raw) == want


def test_no_gzip_unless_asked_and_enabled(store):
    data_dir, path = store
    plain = get(make_app(data_dir, compress_responses=True).test_client(), path)
    assert "Content-Encoding" not in plain.headers
    off = get(make_app(data_dir, compress_responses=False).test_client(), path,
              headers={"Accept-Encoding": "gzip"})
    assert "Content-Encoding" not in off.headers
    assert json.loads(off.data)["cells"] == awkward_names()


# -- validators -----------------------------------------------------------------

def test_etag_and_304_without_reading(store):
    data_dir, path = store
    client = make_app(data_dir).test_client()
    first = get(client, path)
    tag = first.headers["ETag"]
    calls = []
    from annzarro.core.zarr_reader import ZarrReader
    real = ZarrReader.iter_cell_gene_name_chunks

    def spy(self, *a, **kw):
        calls.append(a)
        return real(self, *a, **kw)

    with patch.object(ZarrReader, "iter_cell_gene_name_chunks", spy):
        again = get(client, path, headers={"If-None-Match": tag})
    assert again.status_code == 304 and again.data == b""
    assert calls == []


# -- what stays as it was ---------------------------------------------------------

def test_a_small_subset_of_cells_keeps_the_list_path(store):
    data_dir, path = store
    client = make_app(data_dir).test_client()
    reply = get(client, path, query={"subset": '{"n":60,"seed":0}'})
    assert reply.status_code == 200
    assert "X-Annzarro-Names" not in reply.headers
    assert len(reply.get_json()["cells"]) == 60
    genes = get(client, path, "genes", query={"subset": '{"n":60,"seed":0}'})
    assert genes.headers.get("X-Annzarro-Names") == str(len(genes.get_json()["genes"]))


def test_a_large_subset_streams_in_slabs_with_the_list_path_bytes(store):
    data_dir, path = store
    app = make_app(data_dir, max_names_json_mb=0.001)    # no limit applies to a stream
    client = app.test_client()
    spec = '{"n":150,"seed":0}'
    with patch.object(process_file, "SUBSET_SLAB", 40):
        streamed = get(client, path, query={"subset": spec})
        streamed.data                               # the stream is read while the patch is on
    app.config["max_names_json_mb"] = 0
    with patch.object(process_file, "SUBSET_SLAB", 10 ** 9):
        listed = get(client, path, query={"subset": spec})
        listed.data
    assert streamed.status_code == 200 and streamed.headers["X-Annzarro-Names"] == "150"
    assert "X-Annzarro-Names" not in listed.headers
    assert streamed.data == listed.data and len(streamed.get_json()["cells"]) == 150


def test_debug_mode_streams_too(store):
    data_dir, path = store
    app = make_app(data_dir)
    app.debug = True
    reply = get(app.test_client(), path)
    assert reply.headers["X-Annzarro-Names"] == "200"
    assert reply.get_json()["cells"] == awkward_names()


@pytest.mark.parametrize("entity", ["cells", "genes"])
def test_errors_keep_their_status_and_body(tmp_path, entity):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    client = make_app(data_dir).test_client()
    missing = str(data_dir / "nothing.zarr")
    new = get(client, missing, entity)
    old = whole_list_reply(client, missing, entity)
    assert new.status_code == old.status_code and new.status_code >= 400
    assert new.get_json() == old.get_json()


def test_a_reader_without_chunks_is_refused_over_the_limit(store):
    data_dir, path = store
    with patch("annzarro.core.zarr_reader.ZarrReader.iter_cell_gene_name_chunks", return_value=None):
        refused = get(make_app(data_dir, max_names_json_mb=0.001).test_client(), path)
        assert refused.status_code == 413
        body = refused.get_json()
        assert body["reason"] == "read_too_large" and body["limit_name"] == "max_names_json_mb"
        assert "max_names_json_mb" in body["error"]
        # no limit, and the default, which these 200 names are far under
        assert get(make_app(data_dir, max_names_json_mb=0).test_client(), path).status_code == 200
        assert get(make_app(data_dir).test_client(), path).status_code == 200


def test_a_store_that_streams_has_no_limit(store):
    data_dir, path = store
    reply = get(make_app(data_dir, max_names_json_mb=0.001).test_client(), path)
    assert reply.status_code == 200 and len(reply.get_json()["cells"]) == 200


# -- cost of a stream ------------------------------------------------------------

def test_a_stream_does_not_use_the_pairwise_read_budget(store):
    # a busy budget (big obsp reads) neither refuses nor cuts a names reply
    data_dir, path = store
    client = make_app(data_dir).test_client()
    with patch.object(read_guard, "admit", side_effect=AssertionError("names took the read budget")):
        reply = get(client, path)
    assert reply.status_code == 200 and len(reply.get_json()["cells"]) == 200


class Watched:
    """A chunk iterator the test keeps a reference to, so that closing it is
    seen to be called by the stream and not by the garbage collector."""

    def __init__(self, inner, fail_at=None):
        self.inner, self.closed, self.n, self.fail_at = inner, 0, 0, fail_at

    def __iter__(self):
        return self

    def __next__(self):
        if self.fail_at is not None and self.n == self.fail_at:
            raise OSError("disk went away")
        self.n += 1
        return next(self.inner)

    def close(self):
        self.closed += 1
        close = getattr(self.inner, "close", None)
        if close:
            close()


def watching(fail_at=None):
    from annzarro.core.zarr_reader import ZarrReader
    real = ZarrReader.iter_cell_gene_name_chunks
    made = []

    def make(self, *a, **kw):
        made.append(Watched(real(self, *a, **kw), fail_at))
        return made[-1]
    return patch.object(ZarrReader, "iter_cell_gene_name_chunks", make), made


def test_closing_the_reply_closes_the_chunk_iterator_and_frees_its_slot(store):
    data_dir, path = store
    client = make_app(data_dir).test_client()
    patcher, made = watching()
    with patcher:
        reply = client.get("/api/v1/data/cells", query_string={"dataset_path": path}, buffered=False)
        next(iter(reply.response))
        assert made[0].closed == 0 and name_streams.active == 1
        reply.close()
    assert made[0].closed == 1 and name_streams.active == 0


def test_a_reply_never_read_frees_its_slot(store):
    data_dir, path = store
    client = make_app(data_dir).test_client()
    reply = client.get("/api/v1/data/cells", query_string={"dataset_path": path}, buffered=False)
    assert name_streams.active == 1
    reply.close()
    assert name_streams.active == 0


def test_streams_over_the_cap_are_refused_before_a_byte_with_retry_after(store):
    data_dir, path = store
    client = make_app(data_dir, names_stream_max_concurrent=1).test_client()
    first = client.get("/api/v1/data/cells", query_string={"dataset_path": path}, buffered=False)
    busy = get(client, path)
    assert busy.status_code == 503
    assert busy.get_json()["reason"] == "read_busy" and busy.headers["Retry-After"]
    assert name_streams.active == 1, "the refused request took a slot"
    first.close()
    assert get(client, path).status_code == 200
    # 0 is no limit
    open_ = [make_app(data_dir, names_stream_max_concurrent=0).test_client().get(
        "/api/v1/data/cells", query_string={"dataset_path": path}, buffered=False) for _ in range(4)]
    assert name_streams.active == 4
    for reply in open_:
        reply.close()
    assert name_streams.active == 0


def test_small_axes_stream_without_a_slot_while_big_ones_hold_the_cap(store):
    data_dir, path = store
    client = make_app(data_dir, names_stream_max_concurrent=1, names_stream_slot_above=100).test_client()
    other = make_app(data_dir, names_stream_max_concurrent=1, names_stream_slot_above=100)
    held = client.get("/api/v1/data/cells", query_string={"dataset_path": path}, buffered=False)   # 200 names: big
    assert name_streams.active == 1
    assert get(client, path).status_code == 503                                  # another big one: refused
    genes = get(client, path, "genes")                                           # 20 names: opening a dataset
    assert genes.status_code == 200 and len(genes.get_json()["genes"]) == 20
    assert name_streams.active == 1
    held.close()
    assert name_streams.active == 0


def test_a_head_request_frees_its_slot(store):
    data_dir, path = store
    reply = make_app(data_dir).test_client().head("/api/v1/data/cells", query_string={"dataset_path": path})
    assert reply.status_code == 200
    reply.close()                       # the server closes a reply whose body it does not send
    assert name_streams.active == 0


def test_a_reply_dropped_without_a_close_frees_its_slot_when_collected(store):
    import gc
    data_dir, path = store
    app = make_app(data_dir)
    with app.test_request_context("/api/v1/data/cells"):
        assert name_streams.acquire(1)
        reply = stream_names("cells", path, ["a", "b"], iter(()), total=2, release=once(name_streams.release))
        assert name_streams.active == 1
        del reply
        gc.collect()
    assert name_streams.active == 0


def test_a_failure_after_the_first_byte_ends_the_body_with_the_abort_mark(store):
    data_dir, path = store
    client = make_app(data_dir).test_client()
    patcher, made = watching(fail_at=3)
    with patcher:
        reply = client.get("/api/v1/data/cells", query_string={"dataset_path": path}, buffered=False)
        pieces = []
        with pytest.raises(OSError):
            for piece in reply.response:
                pieces.append(piece)
        reply.close()
    body = b"".join(pieces)
    assert body.endswith(ABORT_MARK) and body.startswith(b'{"cells":["')
    with pytest.raises(ValueError):
        json.loads(body)
    assert made[0].closed >= 1 and name_streams.active == 0


def serve_thread(app, protocol):
    from werkzeug.serving import WSGIRequestHandler, make_server
    handler = type("H", (WSGIRequestHandler,), {"protocol_version": protocol})
    server = make_server("127.0.0.1", 0, app, threaded=True, request_handler=handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


@pytest.mark.parametrize("protocol", ["HTTP/1.0", "HTTP/1.1"])
def test_a_cut_reply_is_never_a_whole_one_on_the_wire(store, protocol):
    """HTTP/1.1: no final chunk, the read fails. HTTP/1.0 (what nginx speaks
    to an upstream by default): the close is a clean end, and the body ends
    with the abort mark, which no JSON parser accepts."""
    data_dir, path = store
    server, thread = serve_thread(make_app(data_dir), protocol)
    patcher, made = watching(fail_at=3)
    try:
        with patcher:
            conn = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=20)
            conn.request("GET", "/api/v1/data/cells?" + urllib.parse.urlencode({"dataset_path": path}))
            resp = conn.getresponse()
            assert resp.status == 200
            if protocol == "HTTP/1.1":
                assert resp.getheader("Transfer-Encoding") == "chunked"
                with pytest.raises(http.client.IncompleteRead):
                    resp.read()
            else:
                body = resp.read()
                assert body.endswith(ABORT_MARK)
                with pytest.raises(ValueError):
                    json.loads(body)
            conn.close()
    finally:
        server.shutdown()
        thread.join(5)
        server.server_close()


# -- memory -------------------------------------------------------------------------

PROBE = textwrap.dedent("""
    import sys, tracemalloc
    from unittest.mock import patch
    from annzarro.core import process_file
    from annzarro.server.core import create_app
    store, mode = sys.argv[1], sys.argv[2]
    app = create_app({"TESTING": True, "DEBUG": False, "auth_enabled": False,
                      "data_dir": store.rsplit("/", 1)[0], "compress_responses": False,
                      "max_names_json_mb": 0})
    client = app.test_client()
    client.get("/api/v1/data/genes", query_string={"dataset_path": store})   # imports, readers warm
    if mode == "list":
        patch.object(process_file, "_stream_names", return_value=None).start()
    # the peak of what the request itself allocates (numpy reports to tracemalloc too); the
    # process's peak RSS is no measure here: on Linux the start-up already peaks above what
    # the list path adds, so the difference of two ru_maxrss readings is 0 for both paths
    tracemalloc.start()
    reply = client.get("/api/v1/data/cells", query_string={"dataset_path": store}, buffered=False)
    size = sum(len(piece) for piece in reply.response)
    print(f"{tracemalloc.get_traced_memory()[1] / 2**20:.1f} {size}")
""")


@pytest.mark.slow
def test_a_stream_holds_a_chunk_not_the_names(tmp_path):
    n = 1_500_000
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    path = make_store(data_dir / "a.zarr", [f"AAACCCAAGTT-{i:09d}-1" for i in range(n)], chunk=100_000)
    grown = {}
    for mode in ("stream", "list"):
        out = subprocess.run([sys.executable, "-c", PROBE, path, mode], capture_output=True, text=True,
                             env={**os.environ, "PYTHONPATH": os.pathsep.join(sys.path)}, timeout=600)
        assert out.returncode == 0, out.stderr[-2000:]
        mb, size = out.stdout.split()[-2:]
        grown[mode] = float(mb)
        assert int(size) > n * 20
    # the same reply; the list path holds ~100 B a name (150 MB here), the stream one chunk
    assert grown["stream"] < 60, grown
    assert grown["list"] > 2 * grown["stream"], grown
