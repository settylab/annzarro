"""
Looking up datasets by path (the recently opened list).

``POST /api/v1/datasets/lookup`` takes ``{"paths": [...]}`` and answers, for
each path in the same order, the entry ``/datasets/folder`` lists for a store
(name, path, cells, genes, format, modified, ...) when the requester may read
it, else ``{"path": <as sent>, "status": "unavailable"}``. A path that does not
exist, one outside the data directories, one a restricted user is not granted,
a remote URL this server or this user may not open and a remote store that does
not answer are all answered alike, so the reply never tells a store that is not
there from one the requester may not read (the same rule as ``/data/info``'s
404, ``server/access.py``).

The route only reads, but it is a POST (the list does not fit a URL), so the
app's forgery check applies to it as to any other POST (``server/csrf.py``).

Counts of a local store come from the listing's probe, cached by the store's
stat signature, so a repeat lookup costs a few ``stat`` calls per path. A
remote store is opened only when remote stores are enabled and the requester may
read the URL, at most ``MAX_REMOTE_PROBES`` a request (the others are answered
``"status": "unchecked"``), and its counts are kept for ``REMOTE_TTL_S``.
"""
import logging
import os
import time
from collections import OrderedDict

from flask import jsonify, request

from .. import access, confinement
from ...core.remote import is_remote_path

logger = logging.getLogger(__name__)

#: Paths one request may name.
MAX_PATHS = 200
#: Remote stores one request opens (each is a network round trip).
MAX_REMOTE_PROBES = 20
#: Seconds the counts of a remote store are kept.
REMOTE_TTL_S = 300
_REMOTE_CACHE_ENTRIES = 512

_remote_cache = OrderedDict()    # url: (stored at, (cells, genes))


def _unavailable(path):
    return {"path": path, "status": "unavailable"}


def _local_entry(config, path):
    """The listing entry of the local store at ``path`` (as sent), or None when it is not one the requester may read."""
    from . import dataset_folders
    if "\x00" in path:
        return None
    data_dir = os.path.expanduser(config.get("data_dir"))
    expanded = os.path.expanduser(path)
    # a relative path names a store in the data directory (confinement.resolve_relative_dataset_paths)
    full = expanded if os.path.isabs(expanded) else os.path.join(data_dir, os.path.normpath(expanded))
    if "://" in path or not confinement.listable(config, full):
        return None
    user = access.restricted_user()
    if user and not access.may_read(user, full):
        return None
    name = os.path.basename(full.rstrip(os.sep)) or full
    try:
        if name.endswith(".h5ad") and os.path.isfile(full):
            kind = {"h5ad": True}
        elif os.path.isdir(full) and dataset_folders.is_store_dir(full, name):
            kind = {"h5ad": False}
        else:
            return None
    except OSError:
        return None
    entry = {"name": name, "path": full, "is_link": os.path.islink(full), "kind": "store", **kind}
    if user or _inside(full, data_dir):
        entry["rel_path"] = dataset_folders.rel_path(full, data_dir)
    dataset_folders._fill_store(entry)
    return entry


def _inside(path, data_dir):
    """Whether ``path`` is below the data directory as spelled (links are not followed, as in the listing)."""
    root = os.path.abspath(data_dir)
    return os.path.abspath(path).startswith(root.rstrip(os.sep) + os.sep)


def _remote_counts(url):
    """``(cells, genes)`` of the remote store at ``url``, from the cache or one open; None when it cannot be opened."""
    now = time.monotonic()
    hit = _remote_cache.get(url)
    if hit and now - hit[0] < REMOTE_TTL_S:
        return hit[1]
    from ...core import get_reader, zarr_reader
    try:
        get_reader(url)
        shape = zarr_reader.open_dataset_by_path(url, use_cache=True)[1].get("shape", (0, 0))
        counts = (int(shape[0]), int(shape[1]))
    except Exception as exc:       # unreachable, not a store, refused: all the same answer
        logger.info(f"Lookup of remote store {url!r} failed: {type(exc).__name__}")
        return None
    _remote_cache[url] = (now, counts)
    _remote_cache.move_to_end(url)
    while len(_remote_cache) > _REMOTE_CACHE_ENTRIES:
        _remote_cache.popitem(last=False)
    return counts


def _remote_entry(url, probes):
    """The entry of a remote store, None when unavailable, or ``"unchecked"`` once the probe budget is spent."""
    from ...core import remote
    user = access.restricted_user()
    try:
        remote.check_remote_access(url)
    except (ValueError, PermissionError):
        return None
    if user and not access.may_read(user, url):
        return None
    if url not in _remote_cache and probes[0] >= MAX_REMOTE_PROBES:
        return "unchecked"
    if url not in _remote_cache:
        probes[0] += 1
    counts = _remote_counts(url)
    if counts is None:
        return None
    name = url.rstrip("/").rsplit("/", 1)[-1] or url
    return {"name": name, "path": url, "is_link": False, "kind": "store", "rel_path": url,
            "cells": counts[0], "genes": counts[1], "format": None, "modified": None, "remote": True}


def lookup(config, paths):
    """One result per path of ``paths``, in order (see the module docstring)."""
    results, probes = [], [0]
    for path in paths:
        try:
            if is_remote_path(path):
                found = _remote_entry(path, probes)
            else:
                found = _local_entry(config, path)
        except (OSError, ValueError):
            found = None
        if found == "unchecked":
            results.append({"path": path, "status": "unchecked"})
        else:
            results.append(found if found is not None else _unavailable(path))
    return results


def register_dataset_lookup_routes(app_, api_version):
    @app_.route(f"/api/{api_version}/datasets/lookup", methods=["POST"])
    @access.gate("listing")
    def lookup_datasets():
        body = request.get_json(silent=True)
        paths = body.get("paths") if isinstance(body, dict) else None
        if not isinstance(paths, list) or not all(isinstance(p, str) for p in paths):
            return jsonify({"error": "paths must be a list of strings", "reason": "bad_request"}), 400
        if len(paths) > MAX_PATHS:
            return jsonify({"error": f"At most {MAX_PATHS} paths per request; {len(paths)} sent.",
                            "reason": "cap_exceeded", "requested": len(paths), "limit": MAX_PATHS,
                            "unit": "paths"}), 400
        return jsonify({"results": lookup(app_.config, paths)})
