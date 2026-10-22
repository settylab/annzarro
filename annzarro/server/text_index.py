"""
The text index: what the local stores say about themselves, searchable without opening them.

A crawl walks every local store the server can list (``store_walk.iter_stores``: the data directory,
the admin roots and every restricted user's grants) and reads two things of each, with
``dataset_info.read_info``: the attribution fields and the first ``text_index_readme_kb`` KB of the
README. Remote stores are not crawled. The result is one gzipped JSON file in the cache directory,
shared by every worker, which loads it again when its stamp moves and answers queries from memory.

* **One crawler at a time**, across workers, by an ``flock`` on ``crawl.lock`` held for the whole run
  (a thread lock where there is no ``fcntl``). ``status.json`` carries the progress; a ``running``
  status whose heartbeat is older than ``HEARTBEAT_STALE_S`` belongs to a dead crawler.
* **Incremental.** A store is read again only when its stat signature moved (or its last read timed
  out an hour ago). Entries of vanished stores are dropped.
* **Bounded.** ``text_index_workers`` threads, ``text_index_store_timeout_s`` per store (a late
  read cannot be killed: it keeps its thread, a spare one takes its place, and its answer is kept if it
  comes before the crawl ends; a crawl with as many late stores as workers at once stops as ``partial``),
  ``text_index_crawl_timeout_s`` and ``text_index_max_stores`` per crawl, ``text_index_max_mb`` for
  the whole index (READMEs are dropped from the largest down past it).
* **Stale while revalidate.** A search answers from the index it has and starts a crawl when the
  index is older than ``text_index_ttl_s``; a crawl starts at most every ``text_index_min_interval_s``.

Nothing here knows who is asking. The index holds every store the crawl could list, so a reader
filters per requester after the lookup (routes/text_search.py, access.py).
"""
import gzip
import hashlib
import json
import logging
import os
import re
import threading
import time
import unicodedata
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

from . import atomic_store
from .limits import LIMITS

try:
    import fcntl
except ImportError:  # Windows: the desktop app is a single process
    fcntl = None

logger = logging.getLogger(__name__)

INDEX_VERSION = 3
HEARTBEAT_STALE_S = 30
HEARTBEAT_EVERY_S = 0.5
CHECKPOINT_EVERY = 500
#: a store whose read timed out is read again once its entry is this old, even if it did not change
RETRY_TIMEOUT_AFTER_S = 3600
#: ``(field, weight)``: the order matters, it is the order ``matched`` lists them in
FIELDS = (("title", 8), ("name", 6), ("authors", 5), ("contacts", 5), ("description", 4), ("doi", 4),
          ("citation", 4), ("attribution", 3), ("license", 3), ("funding", 3), ("provenance", 3),
          ("source_url", 3), ("readme", 1))
WEIGHTS = dict(FIELDS)
ABOUT_FIELDS = tuple(name for name, _ in FIELDS if name not in ("name", "readme"))

_now = time.time          # tests move the clock here


def setting(config, key):
    """``server.<key>`` of a text-index limit, or its default."""
    value = config.get(key)
    return LIMITS[key].default if value is None else value


# -- where the index lives ---------------------------------------------------------------------------

def crawl_roots(config):
    """The real roots a crawl starts from: the data directory and the active admin roots, sorted."""
    from .admin import overlay
    roots = {os.path.realpath(os.path.expanduser(config.get("data_dir") or "."))}
    roots.update(overlay.active_data_roots(config))
    return sorted(roots)


def index_dir(config):
    """``<cache>/text-index/<hash of the roots>``: another data directory never meets this one's index."""
    from ..utils import paths
    digest = hashlib.sha1("\0".join(crawl_roots(config)).encode("utf-8", "surrogateescape")).hexdigest()[:16]
    return paths.cache_dir() / "text-index" / digest


def _file(config, name):
    return str(index_dir(config) / name)


# -- the text of a store -----------------------------------------------------------------------------

_LINK = re.compile(r"!?\[([^\]]*)\]\([^)]*\)")
_LINE_MARKUP = re.compile(r"(?m)^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?=\S)|\d+[.)]\s+(?=\S))")
_MARKUP = re.compile(r"[*`~|]+|(?<!\w)_+|_+(?!\w)")
_SPACE = re.compile(r"\s+")
_SKIP_KEYS = ("url", "contact_url", "doi_url", "license_url")


def plain_text(markdown):
    """README Markdown as prose: link targets, heading marks and emphasis characters removed."""
    text = _LINK.sub(r"\1", markdown or "")
    text = _LINE_MARKUP.sub("", text)
    return _SPACE.sub(" ", _MARKUP.sub("", text)).strip()


def _flatten(value):
    """The text of an attribution value: a string, or the strings of a list or object, joined."""
    if value is None or isinstance(value, bool):
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        return "; ".join(t for t in (_flatten(v) for v in value) if t)
    if isinstance(value, dict):
        return ", ".join(t for k, v in value.items() if k not in _SKIP_KEYS for t in [_flatten(v)] if t)
    return ""


def read_text(path, readme_bytes):
    """``(about, readme, readme_cut)`` of the store at ``path``: ``about`` maps each attribution field
    that has text to that text. Raises what ``read_info`` raises."""
    from ..core import dataset_info
    # from the files on disk: the whole-store check of the consolidated listing was most of every read
    info = dataset_info.read_info(path, ["about", "readme"], on_disk=True)
    raw = info["about"]
    about = {}
    for name in ABOUT_FIELDS:
        if name == "contacts":
            text = _flatten(raw.get("contacts")) or _flatten(raw.get("contact"))     # ``contact`` is the first of ``contacts``
        else:
            text = _flatten(raw.get(name))
        if text:
            about[name] = text
    readme = info["readme"]
    text = readme.get("text") or ""
    cut = bool(readme.get("truncated"))
    encoded = text.encode("utf-8")
    if len(encoded) > readme_bytes:
        text, cut = encoded[:readme_bytes].decode("utf-8", "ignore"), True
    return about, plain_text(text), cut


# -- the index file ----------------------------------------------------------------------------------
#
# In memory an entry keeps its README once, as it is. The matcher folds a field when it looks at it
# (``str.lower`` for ASCII, which is what almost all text is); only a field with other characters is
# folded once at load and kept beside the original. On disk the file is gzipped JSON lines (a header, then
# one entry per line), so it is written and read one entry at a time and the whole text is never held twice,
# not even while loading.

def readme_of(entry):
    """The README text of an entry."""
    return entry.get("readme") or ""


def _entry_chars(entry):
    return len(entry.get("readme") or "") + sum(len(v) for v in (entry.get("about") or {}).values())


def _cap_size(entries, max_mb):
    """Drop READMEs, largest first, until the text fits ``max_mb``; whether any was dropped."""
    limit = int(max_mb * 1024 * 1024)
    total = sum(_entry_chars(e) for e in entries)
    if total <= limit:
        return False
    for entry in sorted(entries, key=lambda e: -len(e.get("readme") or "")):
        if total <= limit or not entry.get("readme"):
            break
        total -= len(entry["readme"])
        entry["readme"], entry["readme_cut"] = "", True
    return True


def _record(entry):
    """An entry as a line of the file: ``real`` is left out when it is the path."""
    if entry.get("real") == entry.get("path"):
        return {k: v for k, v in entry.items() if k != "real"}
    return entry


def write_index(config, entries, built_at, complete, capped=False, partial=False, stores_capped=False):
    """Write ``index.json.gz`` atomically, entry by entry: a reader sees the old file or the new one, never half."""
    directory = index_dir(config)
    directory.mkdir(parents=True, exist_ok=True)
    target = str(directory / "index.json.gz")
    header = {"version": INDEX_VERSION, "built_at": built_at, "written_at": _now(), "complete": complete,
              "partial": partial, "capped": capped, "stores_capped": stores_capped, "count": len(entries)}
    tmp = f"{target}.{os.getpid()}.{threading.get_ident()}.tmp"
    dump = json.JSONEncoder(ensure_ascii=False, separators=(",", ":")).encode
    try:
        with open(tmp, "wb") as raw:
            with gzip.GzipFile(fileobj=raw, mode="wb", compresslevel=6, mtime=0) as gz:
                gz.write((dump(header) + "\n").encode("utf-8"))
                for entry in entries:
                    gz.write((dump(_record(entry)) + "\n").encode("utf-8"))
            raw.flush()
            os.fsync(raw.fileno())
        os.replace(tmp, target)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    atomic_store._fsync_dir(str(directory))


def fold(text):
    """``text`` as a search compares it: Unicode compatibility form, accents dropped, case folded."""
    if text.isascii():
        return text.lower()
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()


_NOTHING = {}


class Loaded:
    """The index as a worker holds it: the entries, and for a field with non-ASCII text its folded form."""

    def __init__(self, header):
        self.built_at = header.get("built_at")
        self.complete = bool(header.get("complete"))
        self.capped = bool(header.get("capped"))
        self.partial = bool(header.get("partial"))
        self.stores_capped = bool(header.get("stores_capped"))
        self.entries = []
        self.folded = []              # per entry: {field: folded text} for fields that are not ASCII, else a shared {}

    def add(self, record):
        """Take one line of the file."""
        record.setdefault("real", record["path"])        # the same string object: no memory
        extra = _NOTHING
        for name, text in fields_of(record).items():
            if text and not text.isascii():
                if extra is _NOTHING:
                    extra = {}
                extra[name] = fold(text)
        self.entries.append(record)
        self.folded.append(extra)

    def __len__(self):
        return len(self.entries)


def fields_of(entry):
    """``{field: text}`` of an entry, the fields the matcher reads."""
    fields = {"name": entry.get("name") or "", "rel_path": entry.get("rel_path") or ""}
    fields.update(entry.get("about") or {})
    fields["readme"] = entry.get("readme") or ""
    return fields


def folded_field(entry, extra, field):
    """The text of ``field`` as the matcher compares it."""
    text = fields_of(entry).get(field) or ""
    return extra.get(field) or text.lower()


def _read_file(path):
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        header = json.loads(fh.readline())
        if not isinstance(header, dict) or header.get("version") != INDEX_VERSION:
            raise ValueError("not a text index of this version")
        loaded = Loaded(header)
        shared = {}                   # short attribution values repeat across stores (licence, authors, funder): keep one string
        for line in fh:
            record = json.loads(line)
            about = record.get("about")
            if about:
                for key, value in about.items():
                    if len(value) <= 120:
                        about[key] = shared.setdefault(value, value)
            loaded.add(record)
    if len(loaded) != header.get("count"):
        raise ValueError("the index file is cut short")
    return loaded


_loaded = {}                      # index file: (stamp, Loaded)
_load_lock = threading.Lock()


def load(config):
    """The index of this server, or None when there is none (or it cannot be read).

    Read again when the file's stamp moved, so a worker pays one ``stat`` per call.
    """
    path = _file(config, "index.json.gz")
    stamp = atomic_store.stamp(path)
    if stamp is None:
        return None
    hit = _loaded.get(path)
    if hit is not None and hit[0] == stamp:
        return hit[1]
    with _load_lock:
        hit = _loaded.get(path)
        if hit is not None and hit[0] == stamp:
            return hit[1]
        try:
            loaded = _read_file(path)
        except (OSError, ValueError, EOFError) as exc:
            logger.warning(f"Text index {path} cannot be read ({exc}); it is rebuilt by the next crawl")
            _loaded.pop(path, None)
            return None
        if len(_loaded) > 16:     # many short-lived configs (tests): never grow without bound
            _loaded.clear()
        _loaded[path] = (stamp, loaded)
        return loaded


# -- status ------------------------------------------------------------------------------------------

def _write_status(config, status):
    directory = index_dir(config)
    directory.mkdir(parents=True, exist_ok=True)
    atomic_store.write_json(str(directory / "status.json"), status, indent=None, durable=False)


def read_status(config):
    """The crawl's status as stored, with ``state`` ``failed`` for a ``running`` one whose crawler is gone."""
    try:
        status = atomic_store.read_json(_file(config, "status.json"), default=None)
    except ValueError:
        status = None
    if not isinstance(status, dict):
        return {"state": "idle"}
    if status.get("state") == "running" and _now() - float(status.get("heartbeat") or 0) > HEARTBEAT_STALE_S:
        status = {**status, "state": "failed", "reason": "crawler_lost"}
    return status


def _invalidated_at(config):
    try:
        return os.stat(_file(config, "invalidated")).st_mtime
    except OSError:
        return 0.0


def invalidate(config):
    """Mark the index stale (the admin's Clear cache): the next search revalidates it; nothing is deleted."""
    directory = index_dir(config)
    if directory.is_dir():
        with open(directory / "invalidated", "w"):
            pass
        os.utime(directory / "invalidated", (_now(), _now()))


def describe(config):
    """``(state, stale, built_at, fraction, status, index)`` for the replies: what a reader may be told."""
    status = read_status(config)
    index = load(config)
    built_at = index.built_at if index is not None and index.complete else None
    stale = index is not None and (built_at is None or _now() - built_at > setting(config, "text_index_ttl_s")
                                   or built_at < _invalidated_at(config) or index.partial)
    state = status.get("state", "idle")
    total = status.get("total")
    fraction = None
    if state == "running" and total:
        fraction = round(min(1.0, (status.get("done") or 0) / total), 3)
    return {"state": state, "stale": stale, "built_at": built_at, "fraction": fraction,
            "status": status, "index": index}


# -- the crawl ---------------------------------------------------------------------------------------

_thread_locks = {}
_thread_locks_guard = threading.Lock()


def _try_lock(config):
    """Take the crawl lock without waiting: a release callable, or None when a crawl holds it."""
    directory = index_dir(config)
    directory.mkdir(parents=True, exist_ok=True)
    path = str(directory / "crawl.lock")
    if fcntl is None:
        with _thread_locks_guard:
            lock = _thread_locks.setdefault(path, threading.Lock())
        return lock.release if lock.acquire(blocking=False) else None
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(fd)
        return None
    return lambda: os.close(fd)


def start_crawl(app, force=False):
    """Start a crawl in a daemon thread unless one runs or the last started too recently.

    Returns whether this call started it. ``force`` is the Refresh button; without it the crawl is
    only started when the index is missing or older than ``text_index_ttl_s``. Either way a crawl
    starts at most every ``text_index_min_interval_s`` (across workers: ``status.json`` says when).
    """
    config = app.config
    view = describe(config)
    if view["state"] == "running":
        return False
    if not force and view["index"] is not None and not view["stale"] and view["state"] != "failed":
        return False
    started = float(view["status"].get("started") or 0)
    if _now() - started < setting(config, "text_index_min_interval_s"):
        return False
    release = _try_lock(config)
    if release is None:
        return False
    try:
        now = _now()
        previous = view["status"]
        _write_status(config, {"state": "running", "started": now, "heartbeat": now, "done": 0, "total": None, "read": 0,
                               "reused": 0, "errors": 0, "built_at": previous.get("built_at")})
        thread = threading.Thread(target=_run, args=(app, release), name="text-index-crawl", daemon=True)
        thread.start()
    except BaseException:
        release()
        raise
    return True


# -- the keeper: the index is built and kept fresh without waiting for a search -----------------------
#
# Each server process runs one keeper thread (``start_keeper``, from ``create_app``). It waits
# ``KEEPER_FIRST_S`` so the server is listening first, then every ``KEEPER_EVERY_S`` asks
# ``start_crawl`` for a crawl, which starts one only when the index is missing, older than
# ``text_index_ttl_s``, partial, or failed, and at most every ``text_index_min_interval_s``; the
# crawl lock keeps it to one crawl for all processes. A partial crawl is thus continued in the
# background until it is done, reading only what it has not read. Off with
# ``server.text_index_background: false`` (the index is then built when a search asks, as before),
# and never while the description search is off for the server.

KEEPER_FIRST_S = 5.0
KEEPER_EVERY_S = 30.0
_keepers = {}                     # index directory: the keeper thread of this process
_keepers_guard = threading.Lock()


def background_enabled(app):
    """Whether this server keeps its index fresh by itself: ``server.text_index_background`` (on by
    default) and the search on in the configuration."""
    return app.config.get("text_index_background", True) is not False and app.config.get("text_index_enabled", True) is not False


def _search_on(app):
    """Whether the description search is on for the server as a whole (config and policy)."""
    if app.config.get("text_index_enabled", True) is False:
        return False
    from .policy.routes import engine
    with app.app_context():
        resolved = engine(app).resolve(KEY, None)
        return resolved.value not in engine(app).registry.keys[KEY].type.off


def keep_once(app):
    """One round of the keeper: start a crawl if one is due. Returns whether it started one."""
    if not _search_on(app):
        return False
    return start_crawl(app)


def start_keeper(app, first=None, every=None, force=False):
    """Start this process's keeper thread for ``app`` (once per index); returns it, or None when off.

    A TESTING app starts none unless ``force`` (a test of the keeper itself).
    """
    if not background_enabled(app) or (app.testing and not force):
        return None
    first = KEEPER_FIRST_S if first is None else first
    every = KEEPER_EVERY_S if every is None else every
    key = str(index_dir(app.config))
    with _keepers_guard:
        alive = _keepers.get(key)
        if alive is not None and alive.is_alive():
            return alive
        stop = threading.Event()

        def loop():
            if stop.wait(first):
                return
            while True:
                try:
                    keep_once(app)
                except Exception as exc:          # the keeper outlives a bad round: the next one tries again
                    logger.warning(f"Text index keeper: {exc}", exc_info=True)
                if stop.wait(every):
                    return

        thread = threading.Thread(target=loop, name="text-index-keeper", daemon=True)
        thread.stop = stop.set
        _keepers[key] = thread
        thread.start()
        return thread


def _run(app, release):
    config = app.config
    try:
        with app.test_request_context("/"):      # the walk's helpers read the requester; nobody asks here
            crawl(config)
    except Exception as exc:
        logger.error(f"Text index crawl failed: {exc}", exc_info=True)
        try:
            _write_status(config, {**read_status(config), "state": "failed", "reason": "error", "heartbeat": _now()})
        except Exception:
            pass
    finally:
        release()


def _enumerate(config, deadline, max_stores):
    """``(entries, truncated)``: the local stores to index, one per real path, in walk order."""
    from . import access, store_walk
    data_dir = os.path.expanduser(config.get("data_dir") or ".")
    max_depth = int(config.get("dataset_search_max_depth") or LIMITS["dataset_search_max_depth"].default)
    max_visited = max_stores * 10
    seen, found, truncated = set(), [], False

    def take(walk):
        nonlocal truncated
        stats = store_walk.WalkStats()
        for entry in walk(stats):
            real = os.path.realpath(entry["path"])
            if real in seen or entry.get("kind") != "store":
                continue
            if len(found) >= max_stores:
                truncated = True
                stats.truncated = True
                break
            seen.add(real)
            try:
                rel = os.path.relpath(entry["path"], data_dir)
            except ValueError:                  # Windows: another drive than the data directory
                rel = os.path.abspath(entry["path"])
            found.append({"name": entry["name"], "path": entry["path"], "real": real, "h5ad": bool(entry.get("h5ad")),
                          "rel_path": rel})
        truncated = truncated or stats.truncated

    take(lambda stats: store_walk.iter_stores(config, None, None, deadline, max_depth, max_visited, stats))
    principals, error = access._read(config)
    for principal in sorted(principals) if not error else ():
        user = principal[len("user:"):] if principal.startswith("user:") else None
        if user and access._flag(principals[principal]):
            take(lambda stats, u=user: store_walk.iter_stores(config, None, u, deadline, max_depth, max_visited, stats))
    return found, truncated


def _signature(entry):
    from ..server.routes import dataset_info as info_routes
    try:
        digest = hashlib.blake2b(repr(info_routes._signature(entry["real"], False)).encode("utf-8", "surrogateescape"), digest_size=8)
        return digest.hexdigest()
    except OSError:
        return None


def crawl(config):
    """Build or refresh the index. The caller holds the crawl lock; this writes ``status.json`` and the index."""
    workers = int(setting(config, "text_index_workers"))
    store_timeout = float(setting(config, "text_index_store_timeout_s"))
    crawl_timeout = float(setting(config, "text_index_crawl_timeout_s"))
    max_stores = int(setting(config, "text_index_max_stores"))
    readme_bytes = int(setting(config, "text_index_readme_kb") * 1024)
    clock = time.monotonic
    began_at = clock()
    deadline = began_at + crawl_timeout
    previous = load(config)
    old = {e["real"]: e for e in previous.entries} if previous is not None else {}
    prior_built = previous.built_at if previous is not None and previous.complete else None

    stores, truncated = _enumerate(config, deadline, max_stores)
    out_of_time = clock() > deadline          # the walk stopped on the clock: more may exist, and the old entries stay
    stores_capped = truncated and not out_of_time
    status = {"state": "running", "started": _now(), "heartbeat": _now(), "done": 0, "total": len(stores), "read": 0,
              "reused": 0, "errors": 0, "built_at": prior_built}
    results = {}                     # real path: entry
    todo = []
    for store in stores:
        sig = _signature(store)
        before = old.get(store["real"])
        retry = before is not None and before.get("error") == "timeout" and _now() - before.get("read_at", 0) > RETRY_TIMEOUT_AFTER_S
        if before is not None and sig is not None and before.get("sig") == sig and not retry:
            results[store["real"]] = {**before, "name": store["name"], "path": store["path"], "rel_path": store["rel_path"],
                                      "h5ad": store["h5ad"]}
            status["reused"] += 1
        else:
            todo.append((store, sig))
    status["done"] = status["reused"]
    logger.info(f"Text index crawl started: {len(stores)} datasets found in {clock() - began_at:.1f} s, "
                f"{len(todo)} to read, {status['reused']} unchanged; {workers} threads, {store_timeout:g} s per dataset")

    last_beat = [0.0]

    def beat():
        if clock() - last_beat[0] >= HEARTBEAT_EVERY_S:
            last_beat[0] = clock()
            status["heartbeat"] = _now()
            _write_status(config, status)

    def snapshot():
        """Everything known now: this crawl's results, and the older entries of stores not read yet."""
        kept = {real: e for real, e in old.items() if real not in results and (real in enumerated or out_of_time or partial)}
        return sorted([*results.values(), *kept.values()], key=lambda e: e["path"])

    enumerated = {s["real"] for s in stores}
    began = {}                       # real path: monotonic start of its read (the timeout counts from there, not from the submit)

    def job(store):
        began[store["real"]] = clock()
        return read_text(store["real"], readme_bytes)

    # A read past the timeout cannot be stopped, so it keeps its thread: the pool has ``workers`` more threads
    # than it reads with, and a store that is late hands its place to the next one. Only when that many
    # stores are late at once does the crawl stop (partial), so a slow filesystem never piles up threads.
    max_late = workers
    pool = ThreadPoolExecutor(max_workers=workers + max_late, thread_name_prefix="text-index")
    queue = list(reversed(todo))
    info = {}
    running, late, partial, since_checkpoint = set(), set(), out_of_time, 0

    def submit():
        while queue and len(running) < workers:
            store, sig = queue.pop()
            future = pool.submit(job, store)
            info[future] = (store, sig)
            running.add(future)

    def finish(future, entry):
        nonlocal since_checkpoint
        store = info[future][0]
        results[store["real"]] = entry
        status["read"] += 1
        status["errors"] += bool(entry["error"])
        status["done"] += 1
        since_checkpoint += 1

    def late_answer(future):
        """A late read that answered after all: its result replaces the timeout entry."""
        store, sig = info[future]
        entry = _result_entry(store, sig, future)
        results[store["real"]] = entry
        status["errors"] -= not entry["error"]

    beat()
    try:
        submit()
        while running:
            if clock() > deadline:
                partial = True
                break
            done, _ = wait(running | late, timeout=HEARTBEAT_EVERY_S, return_when=FIRST_COMPLETED)
            for future in done:
                if future in late:
                    late.discard(future)
                    late_answer(future)
                else:
                    running.discard(future)
                    store, sig = info[future]
                    finish(future, _result_entry(store, sig, future))
            now = clock()
            for future in list(running):
                store, sig = info[future]
                if now - began.get(store["real"], now) > store_timeout:
                    running.discard(future)
                    late.add(future)
                    finish(future, _entry(store, sig, error="timeout"))
            if len(late) >= max_late:
                partial = True       # as many stores as spare threads never answer: stop, do not pile up
                break
            submit()
            if since_checkpoint >= CHECKPOINT_EVERY:
                since_checkpoint = 0
                write_index(config, snapshot(), prior_built, complete=False)
            beat()
        for future in [f for f in late if f.done()]:
            late_answer(future)
    finally:
        pool.shutdown(wait=False, cancel_futures=True)

    entries = snapshot()
    capped = _cap_size(entries, float(setting(config, "text_index_max_mb")))
    finished = _now()
    write_index(config, entries, finished, complete=True, capped=capped, partial=partial, stores_capped=stores_capped)
    status.update(state="partial" if partial else "done", heartbeat=finished, built_at=finished, finished=finished,
                  capped=capped or stores_capped, total=len(stores))
    _write_status(config, status)
    timeouts = sum(1 for e in results.values() if e.get("error") == "timeout")
    why = (" (out of time)" if clock() > deadline else f" ({len(late)} datasets did not answer)") if partial else ""
    searchable = sum(1 for e in entries if not e.get("error"))
    logger.info(f"Text index crawl {status['state']}{why} in {clock() - began_at:.1f} s: {searchable} of {len(entries)} datasets searchable, "
                f"{status['read']} read, {status['reused']} unchanged, {status['errors']} not readable"
                f"{f' ({timeouts} timed out)' if timeouts else ''}{', capped' if status['capped'] else ''}")
    return status


def _entry(store, sig, about=None, readme="", cut=False, error=None):
    return {"path": store["path"], "real": store["real"], "name": store["name"], "rel_path": store["rel_path"],
            "h5ad": store["h5ad"], "sig": sig, "read_at": _now(), "about": about or {}, "readme": readme,
            "readme_cut": cut, "error": error}


def _result_entry(store, sig, future):
    try:
        about, readme, cut = future.result()
    except Exception as exc:
        logger.debug(f"Text index: {store['real']} not read: {exc}")
        return _entry(store, sig, error="unreadable")
    return _entry(store, sig, about, readme, cut)


# -- searching ---------------------------------------------------------------------------------------

MAX_QUERY_CHARS = 200
MAX_TERMS = 8
SEARCH_SECONDS = 1.0
SNIPPET_CHARS = 160
SNIPPET_LEAD = 40
WINDOW = 400
_TOKEN = re.compile(r'"([^"]*)"|(\S+)')


class SearchRefused(ValueError):
    """A query the server will not run; ``reason`` goes in the 400."""

    def __init__(self, reason, message):
        super().__init__(message)
        self.reason = reason


def parse_query(query):
    """The folded terms of ``query``: words and ``"quoted phrases"``. Raises SearchRefused."""
    if len(query) > MAX_QUERY_CHARS:
        raise SearchRefused("query_too_long", f"The search has {len(query)} characters; at most {MAX_QUERY_CHARS}.")
    terms = []
    for phrase, word in _TOKEN.findall(query):
        term = _SPACE.sub(" ", fold(phrase or word)).strip()
        if term and term not in terms:
            terms.append(term)
    if len(terms) > MAX_TERMS:
        raise SearchRefused("too_many_terms", f"The search has {len(terms)} terms; at most {MAX_TERMS}.")
    return terms


def _weight(field):
    return WEIGHTS.get("name" if field == "rel_path" else field, 0)


def _score(entry, extra, terms):
    """``(score, matched fields)`` of one entry, or None when a term is in none of its fields."""
    best = [0.0] * len(terms)
    matched = set()
    for field, text in fields_of(entry).items():
        if not text:
            continue
        low = extra.get(field) or text.lower()
        weight = _weight(field)
        for n, term in enumerate(terms):
            pos = low.find(term)
            if pos < 0:
                continue
            matched.add("name" if field == "rel_path" else field)
            best[n] = max(best[n], weight * (1.5 if pos == 0 or not low[pos - 1].isalnum() else 1.0))
    if not all(best):
        return None
    return sum(best), [name for name, _ in FIELDS if name in matched]


def _fold_map(text):
    """``(folded, origin)``: ``text`` folded character by character, ``origin[i]`` the index in ``text`` of folded character i."""
    out, origin = [], []
    for i, char in enumerate(text):
        piece = fold(char)
        out.append(piece)
        origin.extend([i] * len(piece))
    return "".join(out), origin


def _utf16(text, index):
    """``index`` characters into ``text``, counted in UTF-16 code units (the way JavaScript counts)."""
    return index + sum(1 for c in text[:index] if ord(c) > 0xFFFF)


def _spans(text, terms, origin_offset=0):
    """``[(start, end)]`` of every occurrence of a term in ``text`` (indexes of ``text``), merged, in order."""
    folded, origin = _fold_map(text)
    spans = []
    for term in terms:
        at = folded.find(term)
        while at >= 0:
            spans.append((origin[at] + origin_offset, origin[at + len(term) - 1] + 1 + origin_offset))
            at = folded.find(term, at + max(1, len(term)))
    spans.sort()
    merged = []
    for start, end in spans:
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _snippet(original, folded, terms, field):
    """``{field, text, highlights}``: about 160 characters of ``original`` around the first hit of a term.

    ``folded`` is the field's folded text, whose hit position is only a guide: the hit is found again
    in a window of ``original`` (character by character, so the offsets are those of the text the
    reader gets), with a scan of the whole field when the guide missed (a field where folding changes lengths).
    """
    guess = min((p for p in (folded.find(t) for t in terms) if p >= 0), default=0)
    spans = []
    for lo, hi in ((max(0, guess - WINDOW), guess + WINDOW), (0, len(original))):
        spans = _spans(original[lo:hi], terms, lo)
        if spans:
            break
    if not spans:
        return {"field": field, "text": original[:SNIPPET_CHARS], "highlights": []}
    first = spans[0][0]
    start = max(0, first - SNIPPET_LEAD)
    if start:
        space = original.rfind(" ", max(0, start - 20), start)
        start = space + 1 if space >= 0 else start
    end = min(len(original), start + SNIPPET_CHARS)
    if end < len(original):
        space = original.rfind(" ", max(first + 1, end - 20), end)
        end = space if space > first else end
    body = original[start:end]
    lead = "…" if start else ""
    text = f"{lead}{body}{chr(0x2026) if end < len(original) else ''}"
    shift = len(lead)
    highlights = []
    for s, e in spans:
        if e <= start or s >= end:
            continue
        s, e = max(s, start) - start, min(e, end) - start
        highlights.append([_utf16(text, s + shift), _utf16(text, e + shift)])
    return {"field": field, "text": text, "highlights": highlights}


def _field_text(entry, field):
    if field in ("name", "rel_path"):
        return entry.get(field) or ""
    if field == "readme":
        return entry.get("readme") or ""
    return (entry.get("about") or {}).get(field, "")


def search(loaded, terms, readable, folder=None, limit=50, seconds=SEARCH_SECONDS):
    """``(hits, partial)``: entries of ``loaded`` that contain every term, best first.

    ``readable(entry)`` is asked of each candidate in score order, after the lookup, and a candidate it
    refuses is not returned or counted. ``folder`` (a real path) keeps the stores below it. A hit is
    ``{"entry", "score", "matched", "snippet"}``. ``partial`` says the clock ran out.
    """
    from .routes import dataset_folders as df
    deadline = time.monotonic() + seconds
    partial = False
    scored = []
    prefix = folder.rstrip(os.sep) + os.sep if folder else None
    for i, (entry, extra) in enumerate(zip(loaded.entries, loaded.folded)):
        if i % 256 == 0 and time.monotonic() > deadline:
            partial = True
            break
        if prefix is not None and not entry["real"].startswith(prefix):
            continue
        result = _score(entry, extra, terms)
        if result is not None:
            scored.append((result[0], entry, extra, result[1]))
    scored.sort(key=lambda item: (-item[0], df.name_key(item[1])))
    hits = []
    for score, entry, extra, matched in scored:
        if len(hits) >= limit:
            break
        if time.monotonic() > deadline:
            partial = True
            break
        if not readable(entry):
            continue
        # the snippet comes from the best matching field that is text about the store, the name only if nothing else matched
        texty = [f for f in matched if f != "name"]
        field = max(texty or matched, key=_weight)
        if field == "name" and not any(t in folded_field(entry, extra, "name") for t in terms):
            field = "rel_path"
        hits.append({"entry": entry, "score": score, "matched": matched,
                     "snippet": _snippet(_field_text(entry, field), folded_field(entry, extra, field), terms, field)})
    return hits, partial


# -- the policy key ----------------------------------------------------------------------------------

KEY = "datasets.text-search.enabled"


def _declare_policy_key() -> None:
    from .policy import Bool, Key, declare
    from .policy.registry import policy_guide
    declare(Key(
        name=KEY, type=Bool(), default=True, scope="user", combine="restrict", area="features",
        config_path="server.text_index_enabled", client=True, label="Search descriptions and READMEs",
        routes=("text_search", "text_index_status", "text_index_refresh"), guide=policy_guide(KEY),
        description="Whether users may search the attribution and READMEs of the datasets they can open, and whether the server "
                    "builds the index that search reads. On by default. Off for a user hides the search from them; off for "
                    "everyone (also server.text_index_enabled: false in the config file) stops the crawl."))


_declare_policy_key()
