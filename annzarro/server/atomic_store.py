"""
Small JSON files that several processes read and write
-------------------------------------------------------

The users file, the admin overlay and (later) the per-user access file all
have the same needs: a write that a crash or a concurrent reader never sees
half done, a read-modify-write that two processes cannot interleave, and a
cheap way for every gunicorn worker to notice that another process changed
the file.

* :func:`write_json` writes a temporary file in the same directory, fsyncs it,
  renames it over the target and fsyncs the directory, so the rename itself
  survives a power cut. Every write gives the file a new inode.
* :func:`locked` is an exclusive lock on ``<path>.lock``: a thread lock for
  this process and ``flock`` for the others (a no-op on Windows, where the
  desktop app is a single process). It gives up after a timeout
  (:class:`LockTimeout`, default 10 s, ``server.lock_timeout_s``), so a stuck
  holder cannot freeze every thread of the server. It is not re-entrant:
  taking it twice in one thread raises instead of deadlocking.
* Paths are resolved through symlinks first: a ``users.json`` that is a
  link into ``/etc`` stays a link and its target gets the writes.
* :func:`update_json` is read, mutate, write under that lock. The mutator may
  raise to refuse; nothing is written then.
* :func:`stamp` is ``(inode, mtime_ns, size)``. Because every write replaces
  the file, the inode alone changes, so two writes within one mtime tick that
  leave the size unchanged are still seen. :class:`Watched` re-parses a file
  only when its stamp moved, so a worker pays one ``stat`` per request.

A file that exists but does not parse is an error here, never an empty
table: the next write would otherwise replace it with the empty one.
"""

import copy
import json
import logging
import os
import tempfile
import threading
import time
from contextlib import contextmanager

try:
    import fcntl
except ImportError:  # Windows: the desktop app is single-process
    fcntl = None

logger = logging.getLogger(__name__)

#: Seconds ``locked`` waits for a lock before it raises LockTimeout.
DEFAULT_LOCK_TIMEOUT = 10.0


class LockTimeout(RuntimeError):
    """A lock stayed taken for the whole timeout (another process or thread holds it)."""


def set_default_lock_timeout(seconds):
    global DEFAULT_LOCK_TIMEOUT
    DEFAULT_LOCK_TIMEOUT = float(seconds)


_thread_locks = {}
_registry_lock = threading.Lock()
_held = threading.local()


def _key(path):
    return os.path.realpath(path)


def _thread_lock(path):
    with _registry_lock:
        lock = _thread_locks.get(path)
        if lock is None:
            lock = _thread_locks[path] = threading.Lock()
        return lock


@contextmanager
def locked(path, timeout=None):
    """Hold the exclusive lock of ``path`` (thread lock plus ``flock`` on
    ``<path>.lock``). ``timeout`` seconds (default ``DEFAULT_LOCK_TIMEOUT``)
    to get it, else LockTimeout. Not re-entrant: a second request in the same
    thread raises RuntimeError."""
    key = _key(path)
    held = getattr(_held, "paths", None)
    if held is None:
        held = _held.paths = set()
    if key in held:
        raise RuntimeError(f"atomic_store.locked({path!r}) taken twice in one thread")
    timeout = DEFAULT_LOCK_TIMEOUT if timeout is None else timeout
    deadline = time.monotonic() + timeout
    thread_lock = _thread_lock(key)
    if not thread_lock.acquire(timeout=max(0.0, timeout)):
        raise LockTimeout(f"{path} is locked by another thread (waited {timeout:g} s)")
    fd = None
    try:
        if fcntl is not None:
            # O_NOFOLLOW: the lock file is ours; a planted link is an error, not a redirect
            fd = os.open(key + ".lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            while True:
                try:
                    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() >= deadline:
                        raise LockTimeout(f"{path} is locked by another process (waited {timeout:g} s)")
                    time.sleep(0.01)
        held.add(key)
        yield
    finally:
        held.discard(key)
        try:
            if fd is not None:
                os.close(fd)        # closing releases the flock
        finally:
            thread_lock.release()


def stamp(path):
    """``(inode, mtime_ns, size)`` of ``path``, or None if it does not exist."""
    try:
        st = os.stat(path)
    except FileNotFoundError:
        return None
    return (st.st_ino, st.st_mtime_ns, st.st_size)


def read_json(path, default=None):
    """The parsed file, or a copy of ``default`` when it does not exist.

    Raises ValueError (json.JSONDecodeError) when the file exists and is not
    valid JSON, including when it is empty."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return copy.deepcopy(default)


def _fsync_dir(directory):
    try:
        fd = os.open(directory, os.O_RDONLY)
    except OSError:
        return          # Windows cannot open a directory
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)


def write_json(path, data, mode=0o600, indent=2):
    """Replace ``path`` with ``data`` in one step.

    The caller holds :func:`locked` when the write follows a read. A symlink
    stays a symlink: the file it points to is replaced. The file ends up with
    ``mode`` (default 0600) whatever it had before."""
    path = os.path.realpath(path)
    directory = os.path.dirname(path)
    fd, tmp = tempfile.mkstemp(prefix=f".{os.path.basename(path)}_", suffix=".tmp", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=indent)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
    _fsync_dir(directory)


def update_json(path, mutate, default=None):
    """Read ``path`` (``default`` when missing), call ``mutate(data)`` and
    write the result, all under :func:`locked`.

    ``mutate`` edits ``data`` in place and may return a value, which is
    returned here. If it raises, nothing is written and the exception
    propagates. It must not call :func:`locked` on the same path."""
    with locked(path):
        data = read_json(path, default)
        result = mutate(data)
        write_json(path, data)
        return result


class Watched:
    """A JSON file re-read only when its stamp moves.

    ``get()`` returns the parsed value (treat it as read-only). A file that
    is missing gives ``default``. A file that does not parse also gives
    ``default``, and ``error`` says why (logged once per bad version): the
    callers decide what failing closed means for them. Within one Flask
    request the answer is memoised, so a per-directory-entry caller costs
    one ``stat`` per request, not per call; ``invalidate()`` is for code
    that wrote the file in the same request."""

    def __init__(self, path, default=None):
        self.path = path
        self.default = default
        self.error = None
        self._stamp = None
        self._value = copy.deepcopy(default)
        self._loaded = False
        self._lock = threading.Lock()

    def _memo(self):
        try:
            from flask import g, has_request_context
        except ImportError:
            return None
        if not has_request_context():
            return None
        return g.__dict__.setdefault("_atomic_store_memo", {})

    def invalidate(self):
        memo = self._memo()
        if memo is not None:
            memo.pop(id(self), None)

    def get(self):
        memo = self._memo()
        if memo is not None and id(self) in memo:
            return memo[id(self)]
        current = stamp(self.path)
        with self._lock:
            if not self._loaded or current != self._stamp:
                try:
                    value = read_json(self.path, self.default)
                    self.error = None
                except (ValueError, OSError) as exc:
                    value = copy.deepcopy(self.default)
                    self.error = f"{type(exc).__name__}: {exc}"
                    logger.error("%s is unreadable and is treated as empty: %s", self.path, self.error)
                self._value, self._stamp, self._loaded = value, current, True
            value = self._value
        if memo is not None:
            memo[id(self)] = value
        return value


_watchers = {}


def watched(path, default=None):
    """The shared :class:`Watched` for ``path`` (one per process and path)."""
    key = _key(path)
    with _registry_lock:
        w = _watchers.get(key)
        if w is None:
            w = _watchers[key] = Watched(key, default)
        return w
