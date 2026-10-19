"""A large reply reaches waitress in pieces, with the same bytes, headers and gzip as before."""
import gzip
import http.client
import io
import threading

import pytest
from flask import Response, jsonify

from annzarro.server import access
from annzarro.server.core import create_app
from annzarro.server.server import _SliceLargeBodies, WAITRESS_SLICE_BYTES


class _Body:
    def __init__(self, chunks):
        self.chunks, self.closed = chunks, False

    def __iter__(self):
        return iter(self.chunks)

    def close(self):
        self.closed = True


def _run(chunks, size):
    body = _Body(chunks)
    out = _SliceLargeBodies(lambda environ, start_response: body, size)({}, lambda *a: None)
    return body, out


def test_a_large_chunk_is_cut_into_pieces_of_at_most_the_size_and_rejoins_exactly():
    data = bytes(range(256)) * 1000
    body, out = _run([data], 4096)
    pieces = list(out)
    assert all(len(p) <= 4096 for p in pieces) and len(pieces) == -(-len(data) // 4096)
    assert b"".join(pieces) == data
    assert all(isinstance(p, bytes) for p in pieces)


def test_small_chunks_pass_through_untouched_and_in_order():
    chunks = [b"a", b"", b"b" * 4096, b"c"]
    _, out = _run(chunks, 4096)
    assert list(out) == chunks


def test_closing_the_reply_closes_the_applications_body():
    body, out = _run([b"x" * 10_000], 1000)
    next(iter(out))
    out.close()
    assert body.closed


def test_a_file_wrapper_is_handed_on_whole():
    class FileWrapper:
        filelike = io.BytesIO(b"x")

    wrapper = FileWrapper()
    out = _SliceLargeBodies(lambda environ, start_response: wrapper, 10)({}, lambda *a: None)
    assert out is wrapper


@pytest.fixture
def served(tmp_path):
    waitress = pytest.importorskip("waitress")
    (tmp_path / "data").mkdir()
    app = create_app({"TESTING": True, "data_dir": str(tmp_path / "data"), "log_file": str(tmp_path / "a.log"),
                      "user_file": str(tmp_path / "u.json"), "compress_responses": True})
    payload = bytes(range(251)) * 20_000     # 5 MB, as a binary column is

    @app.route("/_big")
    @access.gate("public")
    def _big():
        return Response(payload, mimetype="application/octet-stream", headers={"X-Annzarro-Shape": "1"})

    @app.route("/_json")
    @access.gate("public")
    def _json():
        return jsonify({"values": list(range(400_000))})

    server = waitress.create_server(_SliceLargeBodies(app, 64 * 1024), host="127.0.0.1", port=0, threads=4)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    yield server.effective_port, payload
    server.close()


def _get(port, path, **headers):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
    conn.request("GET", path, headers=headers)
    reply = conn.getresponse()
    return reply.status, dict(reply.getheaders()), reply.read()


def test_a_binary_column_through_waitress_has_the_same_bytes_and_length(served):
    port, payload = served
    status, headers, body = _get(port, "/_big")
    assert status == 200 and body == payload
    assert int(headers["Content-Length"]) == len(payload)
    assert headers["X-Annzarro-Shape"] == "1"


def test_gzip_of_a_large_json_reply_still_works_through_waitress(served):
    port, _ = served
    _, plain_headers, plain = _get(port, "/_json")
    status, headers, packed = _get(port, "/_json", **{"Accept-Encoding": "gzip"})
    assert status == 200 and headers["Content-Encoding"] == "gzip"
    assert int(headers["Content-Length"]) == len(packed) < len(plain)
    assert gzip.decompress(packed) == plain


def test_the_default_slice_is_far_below_the_output_buffers_watermark():
    assert WAITRESS_SLICE_BYTES <= 1 << 20
