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
import json
import os
import shutil
import subprocess
import sys
import textwrap
from unittest.mock import patch

import numpy as np
import pytest
import zarr

from annzarro.core import process_file, read_guard
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
    return create_app({"TESTING": True, "DEBUG": False, "auth_enabled": False,
                       "data_dir": str(data_dir), "compress_responses": False, **config})


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

def test_a_subset_of_cells_keeps_the_list_path(store):
    data_dir, path = store
    client = make_app(data_dir).test_client()
    reply = get(client, path, query={"subset": '{"n":60,"seed":0}'})
    assert reply.status_code == 200
    assert "X-Annzarro-Names" not in reply.headers
    assert len(reply.get_json()["cells"]) == 60
    genes = get(client, path, "genes", query={"subset": '{"n":60,"seed":0}'})
    assert genes.headers.get("X-Annzarro-Names") == str(len(genes.get_json()["genes"]))


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

def test_each_chunk_is_charged_to_the_budget_for_its_own_length_only(store):
    data_dir, path = store
    client = make_app(data_dir).test_client()
    held, calls = [], []
    real = read_guard.admit

    from contextlib import contextmanager

    @contextmanager
    def spy(need):
        calls.append(need)
        with real(need):
            yield

    with patch.object(read_guard, "admit", spy):
        reply = client.get("/api/v1/data/cells", query_string={"dataset_path": path}, buffered=False)
        for piece in reply.response:
            held.append(read_guard.in_flight_bytes())
    assert len(calls) == 7                      # 200 names in chunks of 30
    assert held and set(held) == {0}, "the budget was held while a piece waited for the client"


def test_closing_the_reply_closes_the_chunk_iterator(store):
    data_dir, path = store
    client = make_app(data_dir).test_client()
    closed = []
    from annzarro.core.zarr_reader import ZarrReader
    real = ZarrReader.iter_cell_gene_name_chunks

    def watch(self, *a, **kw):
        inner = real(self, *a, **kw)

        def gen():
            try:
                yield from inner
            finally:
                closed.append(True)
        return gen()

    with patch.object(ZarrReader, "iter_cell_gene_name_chunks", watch):
        reply = client.get("/api/v1/data/cells", query_string={"dataset_path": path}, buffered=False)
        it = iter(reply.response)
        next(it)
        assert closed == []
        reply.close()
    assert closed == [True]


# -- memory -------------------------------------------------------------------------

PROBE = textwrap.dedent("""
    import resource, sys
    from unittest.mock import patch
    from annzarro.core import process_file
    from annzarro.server.core import create_app
    store, mode = sys.argv[1], sys.argv[2]
    app = create_app({"TESTING": True, "DEBUG": False, "auth_enabled": False,
                      "data_dir": store.rsplit("/", 1)[0], "compress_responses": False,
                      "max_names_json_mb": 0})
    client = app.test_client()
    def mb():
        r = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return r / 2**20 if sys.platform == "darwin" else r / 2**10
    client.get("/api/v1/data/genes", query_string={"dataset_path": store})   # imports, readers warm
    before = mb()
    if mode == "list":
        patch.object(process_file, "_stream_names", return_value=None).start()
    reply = client.get("/api/v1/data/cells", query_string={"dataset_path": store}, buffered=False)
    size = sum(len(piece) for piece in reply.response)
    print(f"{mb() - before:.1f} {size}")
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
