"""HTTP-level reuse of dataset reads: ETags, revalidation and gzip.

A dataset slice is a pure function of the request URL and the store on disk,
so the reply can carry an ETag derived from exactly those two things, computed
WITHOUT reading any data: the URL, plus a stat() fingerprint of the store.
Replies are marked ``Cache-Control: private, no-cache``: the browser keeps
them and revalidates every reuse, and a repeat (a panel re-render, a
deep-link boot, the same gene clicked again) is answered ``304 Not Modified``
with no body and no zarr read.

The fingerprint follows the same rule as the dataset listing
(``data_routes._listing_signature``): anndata rewrites recreate groups, which
moves their directory mtimes, and zarr rewrites an array's metadata file. An
in-place overwrite of chunk files alone is not seen -- the same assumption the
server's result cache already makes (README, "Caches assume the store does not
change"). Remote stores get no ETag: there is no cheap fingerprint.

``ENCODING_VERSION`` is part of every tag, so a server whose reply format
changed never matches a body cached from an older one.
"""

import functools
import gzip
import hashlib
import logging
import os

from flask import current_app, make_response, request

from ..core.remote import is_remote_path

logger = logging.getLogger(__name__)

ENCODING_VERSION = "2"
CACHE_CONTROL = "private, no-cache"

# Members whose stat changes when a store, or one of its groups, is rewritten.
_FINGERPRINT_MEMBERS = (".zgroup", ".zattrs", "zarr.json", ".zmetadata",
                        "X", "obs", "var", "layers", "obsm", "varm", "obsp",
                        "varp", "uns")

# Below this a JSON body is not worth compressing.
GZIP_MIN_BYTES = 4096


def dataset_fingerprint(dataset_path):
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


def _etag_for_request():
    fingerprint = dataset_fingerprint(request.args.get("dataset_path"))
    if fingerprint is None:
        return None
    from annzarro import __version__
    raw = f"{ENCODING_VERSION}|{__version__}|{request.full_path}|{fingerprint}"
    return hashlib.sha1(raw.encode("utf-8", "surrogateescape")).hexdigest()


def conditional(view):
    """Answer a repeat of an unchanged dataset read with 304, before reading.

    Applied to the view function, so it runs inside ``require_auth`` and
    after the path-confinement hook: a 304 is only ever given to a request
    that would have been allowed the 200.
    """
    @functools.wraps(view)
    def wrapper(*args, **kwargs):
        if request.method != "GET":
            return view(*args, **kwargs)
        etag = _etag_for_request()
        if etag is not None and request.if_none_match.contains_weak(etag):
            response = current_app.response_class(status=304)
            response.set_etag(etag, weak=True)
            response.headers["Cache-Control"] = CACHE_CONTROL
            return response
        response = make_response(view(*args, **kwargs))
        if etag is not None and response.status_code == 200:
            response.set_etag(etag, weak=True)
            response.headers["Cache-Control"] = CACHE_CONTROL
        return response
    return wrapper


def gzip_enabled(config):
    """``compress_responses``: true / false / "auto" (default).

    auto compresses only when other people reach this server (login on or a
    network host; ``confinement.is_hosted``). On a loopback desktop server the
    CPU spent compressing exceeds the transfer time it saves.
    """
    setting = config.get("compress_responses", "auto")
    if isinstance(setting, str):
        lowered = setting.strip().lower()
        if lowered in ("auto", ""):
            from .confinement import is_hosted
            return is_hosted(config)
        return lowered in ("1", "true", "yes", "on")
    return bool(setting)


def install_gzip(app):
    """Compress JSON replies with gzip level 1 when the client accepts it.

    Level 1 because the measured trade-off is steep: on a 1M-cell gene
    column level 1 already halves the body, level 6 saves ~10% more for
    ~10x the CPU. Binary vectors are not compressed: float32 noise barely
    shrinks (4.0 -> 3.7 MB) and sparse replies are already minimal.
    """
    if not gzip_enabled(app.config):
        return

    @app.after_request
    def _gzip_json(response):
        if (response.status_code != 200 or response.direct_passthrough
                or response.mimetype != "application/json"
                or "Content-Encoding" in response.headers
                or "gzip" not in (request.headers.get("Accept-Encoding") or "").lower()):
            return response
        body = response.get_data()
        if len(body) < GZIP_MIN_BYTES:
            return response
        response.set_data(gzip.compress(body, compresslevel=1))
        response.headers["Content-Encoding"] = "gzip"
        response.vary.add("Accept-Encoding")
        return response

    logger.info("gzip (level 1) enabled for JSON responses")
