"""One snapshot file per server worker, read by the admin Health section and ``/metrics``.

Every gunicorn worker is its own process with its own counters, and a request
reaches one worker at random. A worker cannot ask its siblings, so each writes
a small JSON file every ``INTERVAL_S`` seconds, from a daemon thread it starts
on its first request, and whichever worker answers merges the files it finds.
One file per worker serves both readers: the process and cache numbers they
share at the top, plus a section for each that is on (``health`` with login,
``metrics`` with ``server.metrics_enabled``). Counters start again when a
worker is recycled; the file says when this one started.

The files live in ``annzarro_admin/health/<host>-<pid>.json`` beside the other
admin state. They are ephemeral and written without fsync: nothing reads one to
decide anything. A file whose process is gone is deleted by the next merge on
its host. A file not rewritten for ``STALE_S`` belongs to a worker that is stuck
(its thread cannot run) or gone on another host.
"""

import logging
import os
import platform
import threading
import time
import weakref

import psutil

from . import atomic_store

logger = logging.getLogger(__name__)

EXTENSION = "annzarro_snapshots"
#: Seconds between a worker's snapshot writes.
INTERVAL_S = 2.0
#: A snapshot older than this is stale: shown, never silently summed.
STALE_S = 60
#: Snapshot files read per merge.
MAX_FILES = 256
MB = 2 ** 20
#: What every snapshot holds, and the type of each.
FIELDS = (("pid", int), ("host", str), ("started", (int, float)), ("written", (int, float)),
          ("rss", int), ("caches", dict), ("name_index_bytes", (int, float)))


class Snapshots:
    """One worker's snapshot file, its writer thread, and the merge of every worker's."""

    def __init__(self, directory, *, interval_s=INTERVAL_S, pid=None, host=None):
        self.directory = directory
        self.interval_s = interval_s
        self.pid = os.getpid() if pid is None else pid
        self.host = platform.node() if host is None else host
        self.started = time.time()
        self._sections = {}    # name -> (produce, fields)
        self._writing = threading.Lock()
        self._starting = threading.Lock()
        self._writer_pid = None

    @property
    def path(self):
        return os.path.join(self.directory, f"{self.host}-{self.pid}.json")

    def add(self, name, produce, fields):
        """Add section ``name``: ``produce()`` returns it, ``fields`` are the ``(key, type)`` it must have."""
        self._sections[name] = (produce, tuple(fields))

    def ensure_writer(self):
        """Start this process' writer thread (once per process: a forked worker starts its own)."""
        if self._writer_pid == os.getpid():
            return
        with self._starting:      # two first requests at once start one thread
            if self._writer_pid == os.getpid():
                return
            self._writer_pid = self.pid = os.getpid()
            threading.Thread(target=_write_forever, args=(weakref.ref(self),), daemon=True,
                             name="worker-snapshot").start()

    def snapshot(self):
        snap = {"pid": self.pid, "host": self.host, "started": self.started, "written": time.time(),
                **_process_and_caches()}
        for name, (produce, _) in self._sections.items():
            snap[name] = produce()
        return snap

    def write(self):
        """Write the snapshot now and return it; None while another thread is writing,
        or when the admin state directory is gone (the server's, or a test's, removed)."""
        if not self._writing.acquire(blocking=False):
            return None
        try:
            if not os.path.isdir(os.path.dirname(self.directory)):
                return None
            snap = self.snapshot()
            os.makedirs(self.directory, mode=0o700, exist_ok=True)
            atomic_store.write_json(self.path, snap, indent=None, durable=False)
            return snap
        finally:
            self._writing.release()

    def others(self, section, prune=False):
        """Every other worker's snapshot that has ``section``. With ``prune``, the
        files of this host's processes that are gone are deleted."""
        fields = FIELDS + ((section, dict),)
        inner = self._sections[section][1]
        try:
            names = sorted(n for n in os.listdir(self.directory) if n.endswith(".json"))[:MAX_FILES]
        except OSError:
            names = []
        out = []
        for name in names:
            path = os.path.join(self.directory, name)
            if path == self.path:
                continue
            snap = _read(path, fields, section, inner)
            if snap is None:
                continue
            if prune and snap["host"] == self.host and not psutil.pid_exists(snap["pid"]):
                # psutil, not os.kill(pid, 0): on Windows that terminates the process
                try:
                    os.unlink(path)
                except OSError:
                    pass
                continue
            out.append(snap)
        return out

    def collect(self, section):
        """This worker's snapshot, written now, and every other worker's with ``section``, by host and pid."""
        own = self.write() or self.snapshot()
        return sorted([own] + self.others(section, prune=True), key=lambda s: (s["host"], s["pid"]))


def _write_forever(ref):
    """Write every ``interval_s`` until the Snapshots object or its directory is gone."""
    while True:
        snaps = ref()
        if snaps is None:
            return
        try:
            if snaps.write() is None and not os.path.isdir(os.path.dirname(snaps.directory)):
                return
        except Exception:
            logger.exception("Worker snapshot failed")
        interval = snaps.interval_s
        del snaps
        time.sleep(interval)


def _process_and_caches():
    """What both readers show: the worker's memory and the dataset caches."""
    from ..core import zarr_reader, h5ad_reader_obj, name_index
    caches = {}
    for label, reader in (("zarr", zarr_reader), ("h5ad", h5ad_reader_obj)):
        info = reader.get_cache_info()
        caches[label] = {"hits": info.get("hits", 0), "misses": info.get("misses", 0),
                         "bytes": info["memory_usage_mb"] * MB, "max_bytes": info["max_memory_mb"] * MB,
                         "datasets": info["dataset_count"]}
    return {"rss": psutil.Process().memory_info().rss, "caches": caches,
            "name_index_bytes": name_index.cached_bytes()}


def _read(path, fields, section, inner):
    """A snapshot file as a dict, None if it is not one with ``section`` (half-written files cannot occur: replaced whole)."""
    try:
        snap = atomic_store.read_json(path)
        for key, kind in fields:
            if not isinstance(snap[key], kind):
                return None
        for key, kind in inner:
            if not isinstance(snap[section][key], kind):
                return None
        return snap
    except (OSError, ValueError, KeyError, TypeError):
        return None


def of(app):
    """The app's Snapshots, created on the first call (by health or metrics install)."""
    snaps = app.extensions.get(EXTENSION)
    if snaps is None:
        from .admin import state_dir
        snaps = app.extensions[EXTENSION] = Snapshots(os.path.join(state_dir(app.config, create=True), "health"))
    return snaps
