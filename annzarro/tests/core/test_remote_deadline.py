"""The per-request deadline on remote filesystems (``core/remote.py``).

No network: a fake async filesystem stands in for s3fs, gcsfs or fsspec's
HTTP one, which all reach the network through the same ``_cat_file`` family
of coroutines. The HTTP round trip, with a host that trickles bytes, is in
``annzarro/tests/integration/test_remote_http_store.py``.
"""

import asyncio
import threading
import time

import pytest

from annzarro.core import remote
from annzarro.core.remote import RemoteDeadlineExceeded, RemotePolicy, bound_by_deadline, deadline


class FakeFs:
    """Takes ``delay_s`` per call (a stalled read, cancellable like aiohttp's)."""

    def __init__(self, delay_s=0.0):
        self.delay_s = delay_s
        self.calls = 0
        self.cancelled = 0

    async def _cat_file(self, path, **kwargs):
        self.calls += 1
        try:
            await asyncio.sleep(self.delay_s)
        except asyncio.CancelledError:
            self.cancelled += 1
            raise
        return b"data"


@pytest.fixture(scope="module")
def loop():
    """An event loop thread, entered the way zarr and fsspec do: a request
    thread submits with run_coroutine_threadsafe and blocks on the result."""
    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, daemon=True)
    thread.start()
    yield loop
    loop.call_soon_threadsafe(loop.stop)
    thread.join()


def _read(loop, fs, path="bucket/key"):
    return asyncio.run_coroutine_threadsafe(fs._cat_file(path), loop).result()


def test_no_deadline_reads_as_before(loop):
    fs = bound_by_deadline(FakeFs(0.05))
    assert _read(loop, fs) == b"data"


def test_deadline_cuts_a_stalled_read_and_cancels_it(loop):
    fs = bound_by_deadline(FakeFs(30))
    start = time.monotonic()
    with deadline(0.3), pytest.raises(RemoteDeadlineExceeded) as info:
        _read(loop, fs, "bucket/key")
    assert 0.25 <= time.monotonic() - start < 2
    assert info.value.seconds == 0.3 and info.value.host == "bucket"
    assert "bucket" in str(info.value) and "0.3s" in str(info.value)
    assert isinstance(info.value, remote.RemoteTimeout)
    assert remote.is_timeout(info.value)
    assert fs.cancelled == 1


def test_deadline_names_the_host_of_a_url(loop):
    fs = bound_by_deadline(FakeFs(30))
    with deadline(0.1), pytest.raises(RemoteDeadlineExceeded) as info:
        _read(loop, fs, "https://data.example.org/a/b.zarr/.zmetadata")
    assert info.value.host == "data.example.org"


def test_deadline_already_passed_raises_without_awaiting(loop):
    fs = bound_by_deadline(FakeFs())
    with deadline(0.05):
        time.sleep(0.1)
        with pytest.raises(RemoteDeadlineExceeded):
            _read(loop, fs)
    assert fs.calls == 0


def test_deadline_spans_calls(loop):
    """One request's budget is shared by its reads, not given anew to each."""
    fs = bound_by_deadline(FakeFs(0.2))
    start = time.monotonic()
    with deadline(0.5):
        with pytest.raises(RemoteDeadlineExceeded):
            for _ in range(10):
                _read(loop, fs)
    assert time.monotonic() - start < 1.5
    assert 2 <= fs.calls <= 4


def test_zero_or_none_is_no_deadline(loop):
    fs = bound_by_deadline(FakeFs(0.05))
    for seconds in (None, 0):
        with deadline(seconds):
            assert remote._deadline.get() is None
            assert _read(loop, fs) == b"data"


def test_wrapping_is_idempotent(loop):
    fs = FakeFs(30)
    bound_by_deadline(fs)
    wrapped = fs._cat_file
    bound_by_deadline(fs)
    assert fs._cat_file is wrapped
    with deadline(0.1), pytest.raises(RemoteDeadlineExceeded):
        _read(loop, fs)
    assert fs.cancelled == 1  # not wrapped twice


def test_threads_keep_separate_deadlines_on_one_filesystem(loop):
    fs = bound_by_deadline(FakeFs(0.6))
    outcome = {}

    def request(name, seconds):
        start = time.monotonic()
        with deadline(seconds):
            try:
                _read(loop, fs)
                outcome[name] = ("ok", time.monotonic() - start)
            except RemoteDeadlineExceeded as exc:
                outcome[name] = ("deadline", time.monotonic() - start, exc.seconds)

    threads = [threading.Thread(target=request, args=args)
               for args in (("short", 0.2), ("long", 5), ("none", None))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert outcome["short"][0] == "deadline" and outcome["short"][2] == 0.2
    assert 0.15 <= outcome["short"][1] < 0.55
    assert outcome["long"][0] == "ok" and outcome["none"][0] == "ok"
    assert remote._deadline.get() is None


def test_a_socket_timeout_inside_the_call_is_not_taken_for_the_deadline(loop):
    class Fs:
        async def _cat_file(self, path):
            raise asyncio.TimeoutError("sock_read")

    fs = bound_by_deadline(Fs())
    with deadline(60), pytest.raises(asyncio.TimeoutError) as info:
        _read(loop, fs)
    assert not isinstance(info.value, RemoteDeadlineExceeded)


def test_sync_twin_of_an_async_filesystem_is_bounded():
    """fsspec binds ``cat_file`` to the coroutine when the instance is made;
    the fingerprint calls ``cat_file``, so wrapping ``_cat_file`` is not enough."""
    asyncio_fs = pytest.importorskip("fsspec.asyn")

    class Slow(asyncio_fs.AsyncFileSystem):
        cachable = False

        async def _cat_file(self, path, start=None, end=None, **kwargs):
            await asyncio.sleep(30)

    fs = Slow(asynchronous=False, loop=asyncio_fs.get_loop())
    bound_by_deadline(fs)
    start = time.monotonic()
    # fsspec's sync() turns any asyncio.TimeoutError into its own FSTimeoutError
    # (ours is one on Python 3.11+), keeping ours as the cause
    with deadline(0.3), pytest.raises(Exception) as info:
        fs.cat_file("bucket/key")
    assert remote.find_deadline_exceeded(info.value) is not None
    assert remote.is_timeout(info.value)
    assert time.monotonic() - start < 2


def test_deadline_error_survives_wrapping_by_the_reader():
    inner = RemoteDeadlineExceeded(5, "h")
    try:
        try:
            raise inner
        except RemoteDeadlineExceeded as exc:
            raise RuntimeError("Could not read chunk") from exc
    except RuntimeError as wrapped:
        assert remote.find_deadline_exceeded(wrapped) is inner
        with pytest.raises(RemoteDeadlineExceeded):
            remote.raise_if_timeout(wrapped)
    assert remote.find_deadline_exceeded(TimeoutError()) is None


def test_background_fingerprint_gets_ten_times_the_request_deadline(monkeypatch):
    """The job runs on its own thread, outside any request: it sets its own deadline."""
    from annzarro.core import fingerprint
    seen = []
    monkeypatch.setattr(fingerprint, "compute", lambda reader, path: seen.append(remote._deadline.get()) or {})
    monkeypatch.setattr(fingerprint, "_persist", lambda *a: None)
    saved = remote.get_remote_policy()
    try:
        for timeout in (2.0, None):
            remote._policy = RemotePolicy(request_timeout=timeout)
            fingerprint._run(None, "/x", "k")
    finally:
        remote._policy = saved
    assert seen[0][1] == 2.0 * fingerprint.BACKGROUND_DEADLINE_FACTOR
    assert seen[1] is None
    assert remote._deadline.get() is None
