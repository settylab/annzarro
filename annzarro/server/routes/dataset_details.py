"""``GET /api/v1/datasets/details?path=``: what one store holds, for the dataset browser's details pane.

The answer is the store's root metadata (counts, format, modification time, link target, obs and var
column names with a coarse type, obsm keys, layers, the number of ``uns`` keys, the size of an
``.h5ad`` file) plus the findings of ``annzarro store check`` run under a time budget
(``server.dataset_details_check_budget_s``). It never reads X or decompresses an array.

The metadata and the check are cached by the store's stat signature (the folder listing's rule), so
selecting the same store again costs a few ``stat`` calls. A store the requester may not read, or
that is not there, answers exactly as ``/data/info`` does (404 ``not_found``, no existence leak). A
restricted user is not shown absolute paths (``path`` is ``null``; ``rel_path`` starts at the name
of the granted folder or store), nor where a link leads.

A remote store is described from one probe of its root (counts and format); its check runs only
when asked for with ``check=1``.
"""
import logging
import os
import threading
import time
from collections import OrderedDict

from flask import current_app as app, jsonify, request

from .. import access
from . import dataset_folders

logger = logging.getLogger(__name__)

DEFAULT_CHECK_BUDGET_S = 1.5
MAX_CACHED = 256
REMOTE_TTL_S = 60

_CACHE = OrderedDict()      # path: (signature, {"meta": {...}, "checks": {budget: check}})
_LOCK = threading.Lock()


def clear_cache():
    with _LOCK:
        _CACHE.clear()


def _signature(path, remote):
    from . import data_routes
    if remote:
        return ("remote", int(time.time() // REMOTE_TTL_S))
    return data_routes._listing_signature(path)


def _cached(path, signature):
    with _LOCK:
        hit = _CACHE.get(path)
        if hit is None or hit[0] != signature:
            return None
        _CACHE.move_to_end(path)
        return hit[1]


def _remember(path, signature, entry):
    with _LOCK:
        _CACHE[path] = (signature, entry)
        _CACHE.move_to_end(path)
        while len(_CACHE) > MAX_CACHED:
            _CACHE.popitem(last=False)


def _basename(path):
    return os.path.basename(path.rstrip("/").rstrip(os.sep)) or path


def _local_meta(path):
    """The user-independent metadata of a local store."""
    from . import data_routes
    from ...core import store_details
    meta = {"name": _basename(path), "remote": False, "error": None}
    meta.update(dataset_folders.store_meta(path))
    fmt = meta["format"] or ""
    meta["zarr_format"] = 3 if "format 3" in fmt else 2 if "format 2" in fmt else None
    meta["sharded"] = fmt.endswith("sharded")
    meta["size_bytes"] = os.stat(path).st_size if os.path.isfile(path) else None
    entry = {"path": path, "h5ad": os.path.isfile(path)}
    dataset_folders.fill_counts(entry)
    meta.update(cells=entry["cells"], genes=entry["genes"], error=entry.get("error"))
    meta["readable"] = meta["error"] is None
    if meta["readable"]:
        try:
            meta.update(store_details.describe_store(path))
        except store_details.StoreDetailsError as exc:
            meta.update(readable=False, error=str(exc))
    return meta


def _remote_meta(path):
    """The metadata of a remote store from one probe of its root: counts and format."""
    from ...core import store_details, zarr_reader
    root = zarr_reader._get_root(path)
    counts = store_details.counts_from_root(root)
    zarr_format = int(getattr(getattr(root, "metadata", None), "zarr_format", 2) or 2)
    return {"name": _basename(path), "remote": True, "error": None, "readable": True,
            "format": f"zarr format {zarr_format}", "zarr_format": zarr_format, "sharded": None,
            "modified": None, "size_bytes": None, **counts}


def _empty_check(reason, **more):
    return {"ran": False, "reason": reason, "complete": None, "budget_reached": None, **more}


def _run_check(path, budget):
    from ...core import store_check
    deadline = time.monotonic() + budget
    try:
        report = store_check.check_store(path, deadline=deadline)
    except store_check.StoreCheckError as exc:
        return _empty_check("unavailable", error=str(exc))
    partial = bool(report.get("partial"))
    return {"ran": True, "reason": None, "complete": not partial, "budget_reached": partial,
            "budget_s": budget, "worst": report["worst"], "counts": report["counts"],
            "findings": report["findings"], "docs": store_check.DOCS}


_H5AD_NOTE = "An .h5ad file is read whole, so its chunk layout has nothing to check."


def _check_for(path, entry, wanted, budget):
    """The ``store_check`` member of a zarr store: run (and cache) when wanted, else say why it did not run."""
    if budget <= 0:
        return _empty_check("disabled")
    if not wanted:
        return _empty_check("not_requested")
    with _LOCK:
        done = entry["checks"].get(budget)
    if done is not None:
        return done
    result = _run_check(path, budget)
    with _LOCK:
        entry["checks"][budget] = result
    return result


def describe(config, path, check=None):
    """The details document of the store at ``path`` (without the per-requester path fields).

    ``check``: True runs the store check, False skips it, None runs it for a local store only.
    Raises FileNotFoundError for a missing local path.
    """
    from ...core import remote
    is_remote = remote.is_remote_path(path)
    if is_remote:
        remote.check_remote_access(path)
    elif not os.path.exists(path):
        raise FileNotFoundError(path)
    signature = _signature(path, is_remote)
    entry = _cached(path, signature)
    if entry is None:
        entry = {"meta": _remote_meta(path) if is_remote else _local_meta(path), "checks": {}}
        _remember(path, signature, entry)
    meta = entry["meta"]
    if not meta["readable"]:
        found = _empty_check("unreadable")
    elif not is_remote and os.path.isfile(path):
        found = _empty_check("h5ad", note=_H5AD_NOTE)
    else:
        budget = float(config.get("dataset_details_check_budget_s", DEFAULT_CHECK_BUDGET_S) or 0)
        found = _check_for(path, entry, (not is_remote) if check is None else check, budget)
    return {**meta, "store_check": found}


def _for_requester(config, path, result):
    """Add the fields that depend on who asks: ``path``, ``rel_path``, ``is_link``, ``link_target``."""
    from ...core.remote import is_remote_path
    user = access.restricted_user()
    if is_remote_path(path):
        return {**result, "path": path, "rel_path": None, "is_link": False, "link_target": None}
    data_dir = os.path.expanduser(config.get("data_dir"))
    link = os.path.islink(path.rstrip(os.sep))
    return {**result,
            "path": None if user else path,
            "rel_path": dataset_folders.rel_path(path, data_dir),
            "is_link": link,
            "link_target": os.path.realpath(path) if link and not user else None}


def register_dataset_details_routes(app_, api_version):
    @app_.route(f"/api/{api_version}/datasets/details", methods=["GET"])
    @access.gate("dataset")
    def dataset_details():
        from . import data_routes
        path = request.args.get("path")
        if not path:
            return jsonify({"error": "path parameter is required"}), 400
        raw = request.args.get("check")
        if raw not in (None, "", "0", "1"):
            return jsonify({"error": "check is 0 or 1", "reason": "bad_check"}), 400
        check = None if raw in (None, "") else raw == "1"
        try:
            result = describe(app_.config, path, check)
        except Exception as exc:
            from ...core.zarr_reader import ZarrFormatError
            if isinstance(exc, (PermissionError, ImportError, FileNotFoundError, TimeoutError, ZarrFormatError)):
                return data_routes._reader_error_response(exc, path)
            if data_routes.remote.find_deadline_exceeded(exc) is not None:
                return data_routes._reader_error_response(exc, path)
            logger.error(f"Error describing {path}: {exc}")
            return jsonify({"error": f"Failed to describe the dataset: {exc}"}), 500
        return jsonify(_for_requester(app_.config, path, result))
