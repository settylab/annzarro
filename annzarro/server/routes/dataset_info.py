"""``GET /api/v1/datasets/info?path=&parts=``: what a dataset says about itself, one part at a time.

``parts`` is a comma-separated choice of ``about`` (attribution, licence, DOI, citation), ``readme``
(``uns["README"]``, cut at 256 KB) and ``structure`` (the AnnData layout: counts, columns, obsm and
layers with shapes, the ``uns`` tree). The page asks for a part only when it shows it. All three
are the default. Metadata only: never X, never a matrix (``core/dataset_info.py``).

A part is cached by the store's stat signature (extended by ``uns``, where the text lives), so a
store re-annotated while the server runs answers afresh. Who may ask is the details route's rule: a
store the requester may not read, or that is not there, answers 404 ``not_found``. The reply names
the store but never its path.
"""
import logging
import os
import threading
import time
from collections import OrderedDict

from flask import jsonify, request

from .. import access

logger = logging.getLogger(__name__)

MAX_CACHED = 128
REMOTE_TTL_S = 60

_CACHE = OrderedDict()      # path: (signature, {part: result})
_LOCK = threading.Lock()


def clear_cache():
    with _LOCK:
        _CACHE.clear()


def _signature(path, remote):
    from . import data_routes
    if remote:
        return ("remote", int(time.time() // REMOTE_TTL_S))
    base = data_routes._listing_signature(path)
    if os.path.isfile(path):
        return base
    extra = []
    for member in ("uns", os.path.join("uns", "annzarro"), os.path.join("uns", "README")):
        try:
            st = os.stat(os.path.join(path, member))
            extra.append((member, st.st_mtime_ns, st.st_size))
        except OSError:
            extra.append((member, None))
    return (base, tuple(extra))


def describe(path, parts):
    """The requested parts of the store at ``path`` (``{part: result}``), from cache when unchanged.

    Raises FileNotFoundError for a missing local path and ``dataset_info.InfoError`` for a store
    that is not AnnData.
    """
    from ...core import dataset_info, remote
    is_remote = remote.is_remote_path(path)
    if is_remote:
        remote.check_remote_access(path)
    elif not os.path.exists(path):
        raise FileNotFoundError(path)
    signature = _signature(path, is_remote)
    with _LOCK:
        hit = _CACHE.get(path)
        entry = hit[1] if hit is not None and hit[0] == signature else None
        if entry is not None:
            _CACHE.move_to_end(path)
    entry = dict(entry) if entry else {}
    missing = [p for p in parts if p not in entry]
    if missing:
        entry.update(dataset_info.read_info(path, missing, remote=is_remote))
        with _LOCK:
            _CACHE[path] = (signature, entry)
            _CACHE.move_to_end(path)
            while len(_CACHE) > MAX_CACHED:
                _CACHE.popitem(last=False)
    return {p: entry[p] for p in parts}


def register_dataset_info_routes(app_, api_version):
    @app_.route(f"/api/{api_version}/datasets/info", methods=["GET"])
    @access.gate("dataset")
    def dataset_info():
        from . import data_routes
        from ...core import dataset_info as core_info
        path = request.args.get("path")
        if not path:
            return jsonify({"error": "path parameter is required"}), 400
        raw = request.args.get("parts")
        parts = [p for p in (raw or "").split(",") if p] if raw else list(core_info.PARTS)
        if not parts or any(p not in core_info.PARTS for p in parts):
            return jsonify({"error": f"parts is a comma-separated choice of {', '.join(core_info.PARTS)}",
                            "reason": "bad_parts"}), 400
        parts = list(dict.fromkeys(parts))
        try:
            result = describe(path, parts)
        except core_info.InfoError as exc:
            return jsonify({"error": str(exc), "reason": "unreadable"}), 422
        except Exception as exc:
            from ...core.zarr_reader import ZarrFormatError
            if isinstance(exc, (PermissionError, ImportError, FileNotFoundError, TimeoutError, ZarrFormatError)):
                return data_routes._reader_error_response(exc, path)
            if data_routes.remote.find_deadline_exceeded(exc) is not None:
                return data_routes._reader_error_response(exc, path)
            logger.error(f"Error reading the information of {path}: {exc}")
            return jsonify({"error": f"Failed to read the dataset information: {exc}"}), 500
        return jsonify({"name": os.path.basename(path.rstrip("/").rstrip(os.sep)) or path, **result})
