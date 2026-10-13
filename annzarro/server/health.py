"""What each server worker is doing, for the admin page's Health section.

Every gunicorn worker is its own process with its own counters (the read
budget in use, the caches, the refusals it answered). A worker cannot ask its
siblings, so each writes a small snapshot file, at most every ``INTERVAL_S``
and from the request hook that already runs (no thread, no timer), and the
admin endpoint merges the files it finds. Counters start again when a worker
is recycled; the snapshot says when this one started.

Snapshots live in ``annzarro_admin/health/<host>-<pid>.json`` beside the other
admin state. They are ephemeral: nothing reads one to decide anything.
"""

import logging
import os
import platform
import threading
import time

import psutil
from flask import request, session

from . import atomic_store

logger = logging.getLogger(__name__)

EXTENSION = "annzarro_health"
#: Seconds between a worker's snapshot writes.
INTERVAL_S = 2.0
#: A snapshot older than this is shown as stale and never silently summed.
STALE_S = 600
#: Largest JSON reply whose ``reason`` is read; bigger ones are not refusals.
MAX_REPLY_BYTES = 16 * 1024
#: Distinct refusal reasons one worker keeps; the rest count as "other".
MAX_REASONS = 64
#: Snapshot files read per request to the admin endpoint.
MAX_FILES = 256
MB = 2 ** 20


class Monitor:
    """One worker's counters and its snapshot file."""

    def __init__(self, directory, *, window_s=3600, interval_s=INTERVAL_S, pid=None, host=None):
        self.directory = directory
        self.window_s = window_s
        self.interval_s = interval_s
        self.pid = os.getpid() if pid is None else pid
        self.host = platform.node() if host is None else host
        self.started = time.time()
        self._lock = threading.Lock()
        self._writing = threading.Lock()
        self._requests = 0
        self._refusals = {}
        self._last_seen = {}
        self._next_write = 0.0

    @property
    def path(self):
        return os.path.join(self.directory, f"{self.host}-{self.pid}.json")

    def count(self, response, username=None):
        """Count one finished request: a refusal by its ``reason``, a user as seen."""
        reason = _reason(response) if response.status_code >= 400 else None
        with self._lock:
            self._requests += 1
            if reason is not None:
                if reason not in self._refusals and len(self._refusals) >= MAX_REASONS:
                    reason = "other"
                self._refusals[reason] = self._refusals.get(reason, 0) + 1
            if username is not None and response.status_code != 401:
                self._last_seen[username] = time.time()

    def after_request(self, response):
        """The Flask hook: count, then write the snapshot when it is due."""
        try:
            self.count(response, _seen_user())
            if time.monotonic() >= self._next_write:
                self.write()
        except Exception:
            logger.exception("Health snapshot failed")
        return response

    def snapshot(self):
        now = time.time()
        with self._lock:
            self._last_seen = {u: t for u, t in self._last_seen.items() if now - t <= self.window_s}
            counted = {"requests": self._requests, "refusals": dict(self._refusals),
                       "last_seen": dict(self._last_seen)}
        return {"pid": self.pid, "host": self.host, "started": self.started, "written": now,
                **counted, "read_guard": _read_guard(), "cache": _cache()}

    def write(self):
        """Write the snapshot now, unless another thread of this worker is."""
        if not self._writing.acquire(blocking=False):
            return None
        try:
            self._next_write = time.monotonic() + self.interval_s
            snap = self.snapshot()
            os.makedirs(self.directory, mode=0o700, exist_ok=True)
            atomic_store.write_json(self.path, snap, indent=None)
            return snap
        finally:
            self._writing.release()

    def collect(self):
        """Write this worker's snapshot, then merge every worker's.

        Returns ``{workers, totals, active, window_s}`` as the endpoint
        answers it. Files of this host whose process is gone are removed.
        """
        own = self.write() or self.snapshot()
        now = time.time()
        snaps = [own]
        try:
            names = sorted(n for n in os.listdir(self.directory) if n.endswith(".json"))[:MAX_FILES]
        except OSError:
            names = []
        for name in names:
            path = os.path.join(self.directory, name)
            if path == self.path:
                continue
            snap = _read(path)
            if snap is None:
                continue
            if snap["host"] == self.host and not _alive(snap["pid"]):
                _forget(path)
                continue
            snaps.append(snap)
        workers, seen = [], {}
        for snap in sorted(snaps, key=lambda s: (s["host"], s["pid"])):
            age = max(0.0, now - snap["written"])
            old = age > STALE_S
            # An old snapshot of a process we can see alive is a quiet worker: it holds no reads.
            # One we cannot check (another host) is stale: its numbers may be anything.
            idle = old and snap["host"] == self.host
            guard = snap["read_guard"]
            if idle and isinstance(guard, dict):
                guard = {**guard, "in_flight_mb": 0, "by_requester": []}
            workers.append({"pid": snap["pid"], "host": snap["host"], "started": _iso(snap["started"]),
                            "age_s": round(age, 1), "stale": old and not idle, "idle": idle,
                            "idle_since": _iso(snap["written"]) if idle else None,
                            "requests": snap["requests"], "refusals": snap["refusals"],
                            "read_guard": guard, "cache": snap["cache"]})
            for username, stamp in snap["last_seen"].items():
                seen[username] = max(seen.get(username, 0), stamp)
        fresh = [w for w in workers if not w["stale"]]
        return {
            "workers": workers,
            "totals": {
                "refusals": sum(n for w in fresh for n in w["refusals"].values()),
                "cache_mb": sum(w["cache"].get("memory_mb", 0) for w in fresh),
                "read_in_flight_mb": sum((w["read_guard"] or {}).get("in_flight_mb", 0) for w in fresh),
            },
            "active": [{"username": u, "last_seen": _iso(t)}
                       for u, t in sorted(seen.items(), key=lambda item: -item[1])
                       if now - t <= self.window_s],
            "window_s": self.window_s,
        }


def _seen_user():
    """Who this request is from, when its session is live (an expired one is not seen)."""
    from .core import is_logged_in
    if request.endpoint == "static" or "user_id" not in session:
        return None
    return session["user_id"] if is_logged_in() else None


def last_seen(app):
    """``{username: ISO time}`` of each user's latest request on any worker.

    Merged from this worker's counters and the others' snapshot files (read
    only: nothing is written or pruned), so it is as fresh as their last
    snapshot, at most ``INTERVAL_S`` behind. A user not seen within the
    session timeout is absent. ``{}`` when the admin interface is off.
    """
    mon = monitor(app)
    if mon is None:
        return {}
    seen = dict(mon.snapshot()["last_seen"])
    try:
        names = sorted(n for n in os.listdir(mon.directory) if n.endswith(".json"))[:MAX_FILES]
    except OSError:
        names = []
    for name in names:
        path = os.path.join(mon.directory, name)
        snap = None if path == mon.path else _read(path)
        for username, stamp in (snap["last_seen"].items() if snap else ()):
            if isinstance(stamp, (int, float)) and time.time() - stamp <= mon.window_s:
                seen[username] = max(seen.get(username, 0), stamp)
    return {u: _iso(t) for u, t in seen.items()}


def _reason(response):
    """The ``reason`` of a refusal, else ``http_<status>``."""
    reason = None
    if (response.is_json and not response.direct_passthrough and not response.is_streamed
            and (response.content_length or 0) <= MAX_REPLY_BYTES):
        body = response.get_json(silent=True)
        if isinstance(body, dict) and isinstance(body.get("reason"), str):
            reason = body["reason"][:40]
    return reason or f"http_{response.status_code}"


def _read_guard():
    from ..core import read_guard
    return read_guard.snapshot()


def _cache():
    """Memory of the result caches (zarr and h5ad readers), the name indices, and the dataset count."""
    from ..core import zarr_reader, h5ad_reader_obj, name_index
    zarr_info, h5ad_info = zarr_reader.get_cache_info(), h5ad_reader_obj.get_cache_info()
    return {
        "memory_mb": zarr_info["memory_usage_mb"] + h5ad_info["memory_usage_mb"],
        "max_mb": zarr_info["max_memory_mb"] + h5ad_info["max_memory_mb"],
        "datasets": zarr_info["dataset_count"] + h5ad_info["dataset_count"],
        "name_index_mb": name_index.cached_bytes() / MB,
    }


def _read(path):
    """A snapshot file as a dict, None if it is not one (half-written files cannot occur: replaced whole)."""
    try:
        snap = atomic_store.read_json(path)
        for key, kind in (("pid", int), ("host", str), ("started", (int, float)), ("written", (int, float)),
                          ("requests", int), ("refusals", dict), ("last_seen", dict), ("cache", dict)):
            if not isinstance(snap[key], kind):
                return None
        return snap
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _alive(pid):
    # psutil, not os.kill(pid, 0): on Windows that terminates the process
    return psutil.pid_exists(pid)


def _forget(path):
    try:
        os.unlink(path)
    except OSError:
        pass


def _iso(stamp):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(stamp, timezone.utc).isoformat()


def monitor(app):
    """The app's Monitor, None when the admin interface is off."""
    return app.extensions.get(EXTENSION)


def install(app):
    """Count requests and write snapshots; only a server with login has an admin page to show them."""
    if not app.config.get("auth_enabled"):
        return None
    from .admin import state_dir
    from .core import DEFAULT_SESSION_TIMEOUT
    window = app.config.get("session_timeout", DEFAULT_SESSION_TIMEOUT) or 8 * 3600
    mon = Monitor(os.path.join(state_dir(app.config), "health"), window_s=window)
    app.extensions[EXTENSION] = mon
    app.after_request(mon.after_request)
    return mon
