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

The token is computed WITHOUT reading any data: a stat() fingerprint of the
store (anndata rewrites recreate groups, which moves their directory
mtimes; zarr rewrites an array's metadata file; an .h5ad file's mtime and
size). Remote stores have no cheap fingerprint: their token is None and
their replies get no ETag.
"""

import contextlib
import contextvars
import os
from typing import Optional

from .remote import is_remote_path

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


def token(dataset_path) -> Optional[str]:
    """The dataset's current freshness token, or None when there is none."""
    return store_fingerprint(dataset_path)


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
