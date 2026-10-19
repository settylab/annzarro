"""``/metrics``: the server's numbers in the Prometheus text format (opt-in).

Off unless ``server.metrics_enabled`` is true; then ``GET /metrics`` answers
only a client inside ``server.metrics_allow`` (loopback by default) and is
otherwise indistinguishable from a URL that does not exist.

No client library: the text format is a few dozen lines, and a library's
multiprocess mode needs an environment variable set before import, a gunicorn
hook to retire dead workers and a writable directory, the same as this module
needs, plus a dependency. What is measured is in the docs
(docs/deployment/monitoring.md).

Several gunicorn workers
------------------------

Each worker counts its own requests. A scrape reaches one worker at random, so
every worker writes a small snapshot file every ``INTERVAL_S`` seconds (from a
daemon thread it starts on its first request) into ``<admin state>/metrics``,
and whichever worker is scraped answers with all of them. Every series carries
a ``worker`` label (the process id); a worker that is recycled leaves the
series, a new one appears, and Prometheus' ``rate()`` and ``sum by`` handle both.
Series are never summed here, so a recycled worker cannot make a total go back.

The files are ephemeral. A snapshot whose process is gone is deleted by the
next scrape.
"""

import ipaddress
import logging
import os
import platform
import threading
import time

import psutil
from flask import abort, request

from . import atomic_store

logger = logging.getLogger(__name__)

EXTENSION = "annzarro_metrics"
#: Seconds between a worker's snapshot writes.
INTERVAL_S = 2.0
#: Upper bounds (seconds) of the latency histogram buckets.
BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300)
#: Route groups one worker tells apart; further ones count as "other".
MAX_GROUPS = 128
#: Snapshot files read per scrape.
MAX_FILES = 256
MB = 2 ** 20
LOOPBACK = ["127.0.0.0/8", "::1/128"]
#: Headers a reverse proxy adds. Without a trusted proxy (server.proxy_count) a request
#: carrying one came through a proxy, and the address that reached us is the proxy's.
_PROXY_HEADERS = ("X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto", "X-Real-IP", "Forwarded")


class Collector:
    """One worker's counters, its snapshot file, and the merged exposition."""

    def __init__(self, directory, *, interval_s=INTERVAL_S, pid=None):
        self.directory = directory
        self.interval_s = interval_s
        self.pid = os.getpid() if pid is None else pid
        self.started = time.time()
        self._lock = threading.Lock()
        self._writing = threading.Lock()
        self._requests = {}    # "group|method|code" -> n
        self._latency = {}     # group -> [per-bucket counts..., +Inf count, sum]
        self._bytes = {}       # group -> n
        self._groups = set()
        self._inflight = 0
        self._writer_pid = None

    @property
    def path(self):
        return os.path.join(self.directory, f"{platform.node()}-{self.pid}.json")

    def begin(self):
        with self._lock:
            self._inflight += 1
        self.ensure_writer()

    def end(self, group, method, status, seconds, nbytes):
        with self._lock:
            self._inflight -= 1
            if group not in self._groups:
                if len(self._groups) >= MAX_GROUPS:
                    group = "other"
                self._groups.add(group)
            key = f"{group}|{method}|{status}"
            self._requests[key] = self._requests.get(key, 0) + 1
            slots = self._latency.setdefault(group, [0] * (len(BUCKETS) + 1) + [0.0])
            slots[next((i for i, bound in enumerate(BUCKETS) if seconds <= bound), len(BUCKETS))] += 1
            slots[-1] += seconds
            self._bytes[group] = self._bytes.get(group, 0) + nbytes

    def ensure_writer(self):
        """Start this process' snapshot thread (once per process: a forked worker starts its own)."""
        if self._writer_pid == os.getpid():
            return
        self._writer_pid = os.getpid()
        self.pid = os.getpid()
        threading.Thread(target=self._write_forever, daemon=True, name="metrics-snapshot").start()

    def _write_forever(self):
        while True:
            try:
                self.write()
            except Exception:
                logger.exception("Metrics snapshot failed")
            time.sleep(self.interval_s)

    def snapshot(self):
        with self._lock:
            counted = {"requests": dict(self._requests), "latency": {g: list(v) for g, v in self._latency.items()},
                       "bytes": dict(self._bytes), "in_flight": self._inflight}
        return {"pid": self.pid, "host": platform.node(), "started": self.started, "written": time.time(),
                **counted, **_process_and_caches()}

    def write(self):
        if not self._writing.acquire(blocking=False):
            return
        try:
            os.makedirs(self.directory, mode=0o700, exist_ok=True)
            atomic_store.write_json(self.path, self.snapshot(), indent=None)
        finally:
            self._writing.release()

    def collect(self):
        """This worker's live snapshot and every other worker's file (dead ones deleted)."""
        own = self.snapshot()
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
            if snap["host"] == own["host"] and not psutil.pid_exists(snap["pid"]):
                try:
                    os.unlink(path)
                except OSError:
                    pass
                continue
            snaps.append(snap)
        return sorted(snaps, key=lambda s: (s["host"], s["pid"]))

    def render(self):
        return render(self.collect())


def _process_and_caches():
    from ..core import zarr_reader, h5ad_reader_obj, name_index
    caches = {}
    for label, reader in (("zarr", zarr_reader), ("h5ad", h5ad_reader_obj)):
        info = reader.get_cache_info()
        caches[label] = {"hits": info.get("hits", 0), "misses": info.get("misses", 0),
                         "bytes": info["memory_usage_mb"] * MB, "max_bytes": info["max_memory_mb"] * MB,
                         "datasets": info["dataset_count"]}
    return {"rss": psutil.Process().memory_info().rss, "caches": caches, "name_index_bytes": name_index.cached_bytes()}


def _read(path):
    try:
        snap = atomic_store.read_json(path)
        for key, kind in (("pid", int), ("host", str), ("started", (int, float)), ("written", (int, float)),
                          ("requests", dict), ("latency", dict), ("bytes", dict), ("in_flight", int),
                          ("rss", int), ("caches", dict), ("name_index_bytes", (int, float))):
            if not isinstance(snap[key], kind):
                return None
        return snap
    except (OSError, ValueError, KeyError, TypeError):
        return None


def _label(**labels):
    def esc(v):
        return str(v).replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')
    return "{" + ",".join(f'{k}="{esc(v)}"' for k, v in labels.items()) + "}"


def _num(value):
    return repr(float(value)) if isinstance(value, float) else str(value)


def render(snaps, now=None):
    """The Prometheus text exposition (version 0.0.4) of the workers' snapshots."""
    now = time.time() if now is None else now
    out = []

    def family(name, kind, help_text, rows):
        rows = list(rows)
        out.append(f"# HELP {name} {help_text}")
        out.append(f"# TYPE {name} {kind}")
        out.extend(f"{name}{labels} {_num(value)}" for labels, value in rows)

    from annzarro import __version__
    family("annzarro_build_info", "gauge", "The AnnZarro version running; the value is always 1.",
           [(_label(version=__version__), 1)])
    ws = lambda s: str(s["pid"])  # noqa: E731
    family("annzarro_http_requests_total", "counter", "Requests answered, by route group, method and status code.",
           ((_label(worker=ws(s), group=g, method=m, code=c), n)
            for s in snaps for key, n in sorted(s["requests"].items()) for g, m, c in [key.split("|")]))
    out.append("# HELP annzarro_http_request_duration_seconds Seconds from request to the last byte sent, by route group.")
    out.append("# TYPE annzarro_http_request_duration_seconds histogram")
    for s in snaps:
        for group, slots in sorted(s["latency"].items()):
            total = 0
            for bound, count in zip(BUCKETS, slots):
                total += count
                out.append(f"annzarro_http_request_duration_seconds_bucket"
                           f"{_label(worker=ws(s), group=group, le=repr(float(bound)))} {total}")
            total += slots[len(BUCKETS)]
            out.append(f"annzarro_http_request_duration_seconds_bucket"
                       f"{_label(worker=ws(s), group=group, le='+Inf')} {total}")
            out.append(f"annzarro_http_request_duration_seconds_sum{_label(worker=ws(s), group=group)} {slots[-1]!r}")
            out.append(f"annzarro_http_request_duration_seconds_count{_label(worker=ws(s), group=group)} {total}")
    family("annzarro_http_requests_in_flight", "gauge", "Requests being answered now (a streamed reply counts until sent).",
           ((_label(worker=ws(s)), s["in_flight"]) for s in snaps))
    family("annzarro_http_response_bytes_total", "counter", "Response body bytes, before compression, by route group.",
           ((_label(worker=ws(s), group=g), n) for s in snaps for g, n in sorted(s["bytes"].items())))
    for field, name, kind, help_text in (
            ("hits", "annzarro_cache_hits_total", "counter", "Lookups answered from the dataset cache."),
            ("misses", "annzarro_cache_misses_total", "counter", "Lookups the dataset cache could not answer."),
            ("bytes", "annzarro_cache_size_bytes", "gauge", "Memory the dataset cache holds."),
            ("max_bytes", "annzarro_cache_max_size_bytes", "gauge", "Memory the dataset cache may hold (server.cache_memory_mb)."),
            ("datasets", "annzarro_open_datasets", "gauge", "Datasets the cache holds entries of.")):
        family(name, kind, help_text,
               ((_label(worker=ws(s), cache=c), v[field]) for s in snaps for c, v in sorted(s["caches"].items())))
    family("annzarro_name_index_size_bytes", "gauge", "Memory the cell and gene name search indices hold.",
           ((_label(worker=ws(s)), s["name_index_bytes"]) for s in snaps))
    family("annzarro_process_resident_memory_bytes", "gauge", "Resident memory (RSS) of the worker process.",
           ((_label(worker=ws(s)), s["rss"]) for s in snaps))
    family("annzarro_worker_start_time_seconds", "gauge", "Unix time the worker process started.",
           ((_label(worker=ws(s)), round(s["started"], 3)) for s in snaps))
    family("annzarro_worker_snapshot_age_seconds", "gauge",
           "Seconds since the worker last wrote its numbers; large for a hung worker.",
           ((_label(worker=ws(s)), round(max(0.0, now - s["written"]), 1)) for s in snaps))
    return "\n".join(out) + "\n"


def networks(config):
    """The configured ``metrics_allow`` as network objects (loopback when unset); ValueError for a bad entry."""
    entries = config.get("metrics_allow")
    if entries is None:
        entries = LOOPBACK
    if isinstance(entries, str):
        entries = [e.strip() for e in entries.split(",") if e.strip()]
    nets = []
    for entry in entries:
        try:
            nets.append(ipaddress.ip_network(str(entry).strip(), strict=False))
        except ValueError:
            raise ValueError(f"server.metrics_allow: {entry!r} is not an address or a network such as 10.0.0.0/8") from None
    return nets


def may_scrape(req, config, nets):
    """Whether this request may read /metrics: from an allowed network, not via an untrusted proxy."""
    if not (config.get("proxy_count") or 0) and any(h in req.headers for h in _PROXY_HEADERS):
        return False
    try:
        address = ipaddress.ip_address(req.remote_addr or "")
    except ValueError:
        return False
    if getattr(address, "ipv4_mapped", None):
        address = address.ipv4_mapped
    return any(address in net for net in nets)


def _as_if_absent(app):
    """The reply /metrics gets when the endpoint is off: the page shell's catch-all, or a 404."""
    for rule in app.url_map.iter_rules():
        if rule.rule == "/<path:path>":
            return app.view_functions[rule.endpoint](path="metrics")
    abort(404)


def enabled(config):
    value = config.get("metrics_enabled", False)
    return value.strip().lower() in ("true", "yes", "1", "on") if isinstance(value, str) else bool(value)


def install(app):
    """Register /metrics when ``metrics_enabled``; return the Collector, None when off."""
    if not enabled(app.config):
        return None
    from flask import Response
    from . import access
    from .admin import state_dir
    nets = networks(app.config)
    if any(net.prefixlen == 0 for net in nets):
        logger.warning("SECURITY: server.metrics_allow includes every address; /metrics is open to anyone who can "
                       "reach the server. Restrict it to your monitoring host.")
    collector = Collector(os.path.join(state_dir(app.config, create=True), "metrics"))
    app.extensions[EXTENSION] = collector

    @app.route("/metrics", methods=["GET"])
    @access.gate("public")
    def metrics():
        if not may_scrape(request, app.config, nets):
            return _as_if_absent(app)
        response = Response(collector.render(), mimetype="text/plain")
        response.headers["Content-Type"] = "text/plain; version=0.0.4; charset=utf-8"
        response.headers["Cache-Control"] = "no-store"
        return response

    logger.info("Metrics enabled at /metrics for %s", ", ".join(str(n) for n in nets))
    return collector
