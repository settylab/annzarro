"""Which version of a dataset a reply was read from: one token per dataset.

Two caches answer a repeated read without touching the store: the browser's
HTTP cache, revalidated with an ETag (server/http_cache.py), and the
server's result cache (core/caching.py). Both must agree on whether the
store changed. They did not: the ETag followed a stat() fingerprint of the
store while the result cache was keyed by request alone, so after an
anndata rewrite the new tag was sent with the old body from the result
cache, and the browser kept that body under a tag it did not match.

``token(path)`` is the one answer both use. A request computes it once
(``pinned``): the ETag it sends and the result-cache entries it reads or
writes carry the same token, so a body is never served under a tag it was
not read under. ``current(path)`` is the pinned token inside a request and
a fresh one outside.

The token is computed WITHOUT reading any data, from two parts:

* a stat() fingerprint of the store: anndata rewrites recreate groups,
  which moves their directory mtimes; zarr rewrites an array's metadata
  file; an .h5ad file has its mtime and size. An in-place write of chunk
  files (``g['obs/x'][:] = v``) moves none of these.
* the dataset's generation: a small file per dataset in the state
  directory (``~/.annzarro/freshness``), replaced on every bump. A cache
  reset bumps it, and so does a refresh that finds the store changed
  (``revalidate``: POST /api/v1/data/refresh, open to every user). Every server process on the machine, each
  gunicorn worker included, stats the same file, so one bump reaches all of
  them; a reset used to clear only the worker that answered it.

Remote stores have no cheap fingerprint: their token is the generation
alone, and their replies get no ETag.
"""

import contextlib
import contextvars
import hashlib
import json
import logging
import os
import tempfile
import threading
import time
from typing import Optional

from .remote import is_remote_path

logger = logging.getLogger(__name__)

# Members whose stat changes when a store, or one of its groups, is rewritten.
_FINGERPRINT_MEMBERS = (".zgroup", ".zattrs", "zarr.json", ".zmetadata",
                        "X", "obs", "var", "layers", "obsm", "varm", "obsp",
                        "varp", "uns")


def store_fingerprint(dataset_path) -> Optional[str]:
    """A stat()-only fingerprint of a local store or file; None if unavailable."""
    if not dataset_path or is_remote_path(dataset_path):
        return None
    try:
        st = os.stat(dataset_path)
    except OSError:
        return None
    if not os.path.isdir(dataset_path):
        return f"{st.st_mtime_ns}:{st.st_size}"
    parts = [str(st.st_mtime_ns)]
    for member in _FINGERPRINT_MEMBERS:
        try:
            mst = os.stat(os.path.join(dataset_path, member))
            parts.append(f"{member}:{mst.st_mtime_ns}:{mst.st_size}")
        except OSError:
            pass
    return "|".join(parts)


# --- generations ---------------------------------------------------------

_ALL = "all"
# bumps that could not be written (no writable state directory): this process only
_local = {}
_local_lock = threading.Lock()


def _generation_dir():
    from ..utils.paths import user_state_dir
    return user_state_dir() / "freshness"


def _key(dataset_path) -> str:
    if dataset_path is None:
        return _ALL
    name = str(dataset_path)
    if not is_remote_path(name):
        name = os.path.realpath(name)
    return hashlib.sha1(name.encode("utf-8", "surrogateescape")).hexdigest()


def generation(dataset_path=None) -> str:
    """The dataset's generation (``None``: the one every dataset shares)."""
    key = _key(dataset_path)
    try:
        st = os.stat(_generation_dir() / key)
        gen = f"{st.st_ino}:{st.st_mtime_ns}:{st.st_size}"
    except OSError:
        gen = "0"
    local = _local.get(key)
    return gen if local is None else f"{gen}+{local}"


def state(dataset_path) -> dict:
    """What the last bump recorded for the dataset ({} if none)."""
    try:
        with open(_generation_dir() / _key(dataset_path), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


_state_cache = {}


def recorded(dataset_path) -> dict:
    """``state(dataset_path)``, read again only when the generation moved: the
    readers ask on every open (whether to skip stale consolidated metadata)."""
    key, gen = _key(dataset_path), generation(dataset_path)
    hit = _state_cache.get(key)
    if hit is not None and hit[0] == gen:
        return hit[1]
    value = state(dataset_path)
    _state_cache[key] = (gen, value)
    return value


def bump(dataset_path=None, **recorded) -> None:
    """Start a new generation of the dataset (``None``: of every dataset).

    The file is replaced, not rewritten, so its inode changes and every
    process sees a new generation on its next stat(). ``recorded`` is kept
    in the file for the next refresh (``state``).
    """
    key = _key(dataset_path)
    body = {"dataset_path": None if dataset_path is None else str(dataset_path),
            "time": time.time(), **recorded}
    folder = _generation_dir()
    try:
        folder.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=folder, prefix=f".{key}.")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(body, f)
        os.replace(tmp, folder / key)
    except OSError as exc:
        logger.warning(f"Freshness of {dataset_path or 'all datasets'} kept in this process only: {exc}")
        with _local_lock:
            _local[key] = _local.get(key, 0) + 1


def token(dataset_path) -> Optional[str]:
    """The dataset's current freshness token, or None for a missing local path."""
    if not dataset_path:
        return None
    gen = f"{generation(dataset_path)}/{generation(None)}"
    if is_remote_path(dataset_path):
        return f"remote|{gen}"
    fingerprint = store_fingerprint(dataset_path)
    return None if fingerprint is None else f"{fingerprint}|{gen}"


# --- refresh: is the store on disk still what was served? -----------------

#: A refresh walks every file of a store; past this many seconds it stops
#: and assumes the store changed.
DEEP_BUDGET_S = 3.0
#: A refresh that could not check (remote store, walk over budget) starts a
#: new generation at most this often per dataset.
UNCHECKED_MIN_INTERVAL_S = 5.0


def deep_fingerprint(dataset_path, budget_s: float = DEEP_BUDGET_S) -> Optional[str]:
    """A digest of every file's path, mtime and size, or None when it cannot
    be had (remote, missing, or the walk took longer than ``budget_s``).

    This is what sees an in-place chunk write. It reads no data, but it
    stats every chunk file, so it runs on a refresh, never per request.
    """
    if not dataset_path or is_remote_path(dataset_path):
        return None
    try:
        st = os.stat(dataset_path)
    except OSError:
        return None
    if not os.path.isdir(dataset_path):
        return f"file:{st.st_mtime_ns}:{st.st_size}"
    digest = hashlib.sha1()
    deadline = time.monotonic() + budget_s
    stack, seen = [str(dataset_path)], 0
    while stack:
        folder = stack.pop()
        try:
            with os.scandir(folder) as entries:
                for entry in sorted(entries, key=lambda e: e.name):
                    seen += 1
                    if seen % 1024 == 0 and time.monotonic() > deadline:
                        return None
                    try:
                        if entry.is_dir(follow_symlinks=False):
                            stack.append(entry.path)
                            continue
                        est = entry.stat(follow_symlinks=False)
                    except OSError:
                        continue
                    digest.update(f"{entry.path}\0{est.st_mtime_ns}\0{est.st_size}\n"
                                  .encode("utf-8", "surrogateescape"))
        except OSError:
            continue
    return digest.hexdigest()


def revalidate(dataset_path, **recorded) -> dict:
    """A refresh: compare the store with what the last refresh recorded and
    start a new generation if it differs (or could not be checked).

    Any user may ask for this. It cannot force the server to re-read a store
    that did not change: an unchanged store keeps its generation, and so its
    ETags and every user's cached reads. ``recorded`` (e.g. whether the
    consolidated metadata is stale) counts as part of the store's state.
    """
    deep = deep_fingerprint(dataset_path)
    previous = state(dataset_path)
    changed = deep is None or previous.get("deep") != deep or any(
        previous.get(k) != v for k, v in recorded.items())
    if deep is None and time.time() - previous.get("time", 0) < UNCHECKED_MIN_INTERVAL_S:
        changed = False
    if changed:
        bump(dataset_path, deep=deep, reason="refresh", **recorded)
    return {"changed": changed, "checked": deep is not None}


_pinned = contextvars.ContextVar("annzarro_freshness_pinned", default=None)


@contextlib.contextmanager
def pinned(dataset_path):
    """Compute the token once for the work inside (one request) and yield it."""
    tok = token(dataset_path) if dataset_path else None
    reset = _pinned.set((str(dataset_path), tok) if dataset_path else None)
    try:
        yield tok
    finally:
        _pinned.reset(reset)


def current(dataset_path) -> Optional[str]:
    """The pinned token for ``dataset_path`` inside ``pinned``, else a fresh one."""
    pin = _pinned.get()
    if pin is not None and pin[0] == str(dataset_path):
        return pin[1]
    return token(dataset_path)
