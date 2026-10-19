"""What each server worker is doing, for the admin page's Health section.

Every gunicorn worker is its own process with its own counters (the read
budget in use, the caches, the refusals it answered). Each puts them in the
``health`` section of its snapshot file, the one ``/metrics`` reads too, and
the admin endpoint merges the files it finds (see snapshots.py).
"""

import logging
import threading
import time

from flask import request, session

from . import snapshots

logger = logging.getLogger(__name__)

EXTENSION = "annzarro_health"
STALE_S = snapshots.STALE_S
#: Largest JSON reply whose ``reason`` is read; bigger ones are not refusals.
MAX_REPLY_BYTES = 16 * 1024
#: Distinct refusal reasons one worker keeps; the rest count as "other".
MAX_REASONS = 64
MB = 2 ** 20
SECTION = "health"
FIELDS = (("requests", int), ("refusals", dict), ("last_seen", dict))


class Monitor:
    """One worker's counters, as the ``health`` section of its snapshot."""

    def __init__(self, snaps, *, window_s=3600):
        self.snapshots = snaps
        self.window_s = window_s
        self._lock = threading.Lock()
        self._requests = 0
        self._refusals = {}
        self._last_seen = {}
        snaps.add(SECTION, self.section, FIELDS)

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
        """The Flask hook: count, and start the snapshot writer on the first request."""
        try:
            self.count(response, _seen_user())
            self.snapshots.ensure_writer()
        except Exception:
            logger.exception("Health count failed")
        return response

    def section(self):
        now = time.time()
        with self._lock:
            self._last_seen = {u: t for u, t in self._last_seen.items() if now - t <= self.window_s}
            return {"requests": self._requests, "refusals": dict(self._refusals),
                    "last_seen": dict(self._last_seen), "read_guard": _read_guard()}

    def collect(self):
        """Write this worker's snapshot, then merge every worker's.

        Returns ``{workers, totals, active, window_s}`` as the endpoint
        answers it. Files of this host whose process is gone are removed.
        """
        now = time.time()
        workers, seen = [], {}
        for snap in self.snapshots.collect(SECTION):
            mine = snap[SECTION]
            age = max(0.0, now - snap["written"])
            workers.append({"pid": snap["pid"], "host": snap["host"], "started": _iso(snap["started"]),
                            "age_s": round(age, 1), "stale": age > STALE_S,
                            "requests": mine["requests"], "refusals": mine["refusals"],
                            "read_guard": mine.get("read_guard"), "cache": _cache(snap),
                            "rss_mb": snap["rss"] / MB})
            for username, stamp in mine["last_seen"].items():
                seen[username] = max(seen.get(username, 0), stamp)
        fresh = [w for w in workers if not w["stale"]]
        return {
            "workers": workers,
            "totals": {
                "refusals": sum(n for w in fresh for n in w["refusals"].values()),
                "cache_mb": sum(w["cache"]["memory_mb"] for w in fresh),
                "read_in_flight_mb": sum((w["read_guard"] or {}).get("in_flight_mb", 0) for w in fresh),
                "rss_mb": sum(w["rss_mb"] for w in fresh),
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
    now = time.time()
    seen = dict(mon.section()["last_seen"])
    for snap in mon.snapshots.others(SECTION):
        for username, stamp in snap[SECTION]["last_seen"].items():
            if isinstance(stamp, (int, float)) and now - stamp <= mon.window_s:
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


def _cache(snap):
    """The result caches (zarr and h5ad readers) and the name indices of a snapshot, in MB."""
    caches = snap["caches"].values()
    return {
        "memory_mb": sum(c["bytes"] for c in caches) / MB,
        "max_mb": sum(c["max_bytes"] for c in caches) / MB,
        "datasets": sum(c["datasets"] for c in caches),
        "name_index_mb": snap["name_index_bytes"] / MB,
    }


def _iso(stamp):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(stamp, timezone.utc).isoformat()


def monitor(app):
    """The app's Monitor, None when the admin interface is off."""
    return app.extensions.get(EXTENSION)


def install(app):
    """Count requests into the worker snapshot; only a server with login has an admin page to show them."""
    if not app.config.get("auth_enabled"):
        return None
    from .core import DEFAULT_SESSION_TIMEOUT
    window = app.config.get("session_timeout", DEFAULT_SESSION_TIMEOUT) or 8 * 3600
    mon = Monitor(snapshots.of(app), window_s=window)
    app.extensions[EXTENSION] = mon
    app.after_request(mon.after_request)
    return mon
