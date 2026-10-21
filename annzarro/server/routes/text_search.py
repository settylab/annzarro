"""Searching what the datasets say about themselves: ``/api/v1/datasets/text-search`` and the index behind it.

The attribution fields and the first 64 KB of the README of every local store the server can list are
crawled into one index (``server/text_index.py``); these routes search it, report how it is doing and
let any user ask for it to be rebuilt.

* ``GET  /datasets/text-search?q=&folder=&limit=``: stores whose text holds every term of ``q``, best
  first, each with a snippet and the offsets to highlight. Starts a crawl when there is no index or
  it is stale, and answers from the old index meanwhile (``index.stale``).
* ``GET  /datasets/text-index/status``: ``{state, stale, built_at, progress}``, for polling.
* ``POST /datasets/text-index/refresh``: starts a crawl at most every ``server.text_index_min_interval_s``;
  sooner it answers the current status (``started: false``).

The index holds every store the crawl could list, so every answer is filtered for the requester after
the lookup: a store they may not open is no hit, no snippet and no count. A restricted user is told no
absolute path and only a fraction of progress, never how many stores the server holds.
"""
import logging
import os

from flask import jsonify, request

from .. import access, confinement, text_index
from ..policy import requires

logger = logging.getLogger(__name__)

DEFAULT_LIMIT = 50
MAX_LIMIT = 200


def _summary(config, view):
    """``index`` of a reply: what the requester may be told of the index."""
    restricted = access.is_restricted_requester()
    status = view["status"]
    progress = None
    if view["state"] == "running":
        progress = {"fraction": view["fraction"]}
        if not restricted:
            progress.update(done=status.get("done"), total=status.get("total"), errors=status.get("errors"))
    body = {"state": view["state"], "stale": view["stale"], "built_at": view["built_at"], "progress": progress}
    index = view["index"]
    if not restricted and index is not None:
        body.update(stores=len(index), partial=index.partial, capped=index.capped)
    return body


def _readable(config):
    """The question asked of each hit after the lookup: may this requester open the store."""
    user = access.restricted_user()
    if user:
        return lambda entry: access.may_read(user, entry["real"])
    return lambda entry: confinement.listable(config, entry["real"])


def _row(hit, user):
    from . import dataset_folders as df
    entry = hit["entry"]
    row = {"name": entry["name"], "path": entry["path"], "rel_path": entry["rel_path"],
           "title": (entry.get("about") or {}).get("title") or None, "score": round(hit["score"], 2),
           "matched": hit["matched"], "snippet": hit["snippet"]}
    if user:
        row["path"], row["rel_path"] = None, access.display_path(user, entry["real"])
    probe = {"path": entry["path"], "h5ad": entry["h5ad"]}
    try:
        df._fill_store(probe)
    except Exception as exc:
        logger.debug(f"Text search: counts of {entry['path']} not read: {exc}")
    for key in ("cells", "genes", "format", "modified", "error"):
        if key in probe:
            row[key] = probe[key]
    return row


def register_text_search_routes(app_, api_version):
    base = f"/api/{api_version}/datasets"

    @app_.route(f"{base}/text-search", methods=["GET"])
    @access.gate("listing")
    @requires(text_index.KEY)
    def text_search():
        from . import dataset_folders as df
        config = app_.config
        if request.args.get("mode") == "regex":
            return jsonify({"error": "The description search takes words and \"quoted phrases\", not regular expressions.",
                            "reason": "regex_not_supported"}), 400
        try:
            terms = text_index.parse_query(request.args.get("q", ""))
        except text_index.SearchRefused as exc:
            return jsonify({"error": str(exc), "reason": exc.reason}), 400
        limit = max(1, min(request.args.get("limit", DEFAULT_LIMIT, type=int) or DEFAULT_LIMIT, MAX_LIMIT))
        folder = request.args.get("folder") or ""
        real_folder = None
        if folder:
            refused = df._confined_refusal(config, folder)
            if refused:
                return refused
            resolved = df._resolve_folder(config, folder)
            if not os.path.isdir(resolved):
                return jsonify({"error": "Folder not found", "reason": "not_found"}), 404
            real_folder = os.path.realpath(resolved)
        if terms:
            text_index.start_crawl(app_)
        view = text_index.describe(config)
        results, partial = [], False
        if terms and view["index"] is not None:
            hits, partial = text_index.search(view["index"], terms, _readable(config), real_folder, limit)
            user = access.restricted_user()
            results = [_row(hit, user) for hit in hits]
        return jsonify({"results": results, "partial": partial, "index": _summary(config, view)})

    @app_.route(f"{base}/text-index/status", methods=["GET"])
    @access.gate("listing")
    @requires(text_index.KEY)
    def text_index_status():
        return jsonify(_summary(app_.config, text_index.describe(app_.config)))

    @app_.route(f"{base}/text-index/refresh", methods=["POST"])
    @access.gate("listing")
    @requires(text_index.KEY)
    def text_index_refresh():
        started = text_index.start_crawl(app_, force=True)
        body = _summary(app_.config, text_index.describe(app_.config))
        body["started"] = started
        return jsonify(body)
