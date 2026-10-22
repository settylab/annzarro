"""Searching what the datasets say about themselves: ``GET /api/v1/datasets/text-search`` and the index behind it.

The attribution fields and the first 64 KB of the README of every local store the server can list are
crawled into one index (``server/text_index.py``), which the server builds and keeps fresh by itself; this
route only searches it. A search never starts a crawl.

* ``GET /datasets/text-search?q=&folder=&limit=&offset=&current=``: stores whose text holds every term of
  ``q``, best first, each with a snippet and the offsets to highlight; ``current`` (the path of the dataset the
  user has open) ranks that dataset first when it matches. ``more`` counts the matches after the page, and
  ``offset`` asks for the next one. ``index`` says whether every dataset is searched.

The index holds every store the crawl could list, so every answer is filtered for the requester after
the lookup: a store they may not open is no hit, no snippet and no count. A restricted user is told the
path of what they may open (as in their listings), nothing above a grant, and never how many stores the
server holds.
"""
import logging
import os

from flask import jsonify, request

from .. import access, confinement, text_index
from ..policy import requires

logger = logging.getLogger(__name__)

DEFAULT_LIMIT = 50
MAX_LIMIT = 200


def _summary(view):
    """``index`` of the reply: ``{complete}``; while datasets are not searched yet, ``{complete: false, capped}``
    and, for a requester who may know how many the server holds, ``searched`` and ``total``."""
    if text_index.complete(view):
        return {"complete": True}
    index = view["index"]
    body = {"complete": False, "capped": bool(index is not None and index.stores_capped)}
    if not access.is_restricted_requester():
        counts = text_index.counts(view)
        body["searched"] = counts["searchable"] + counts["unreadable"]
        total = view["status"].get("total")
        body["total"] = max(int(total), counts["stores"]) if isinstance(total, int) else (counts["stores"] or None)
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
        # the path of a store they may open, as their folder listings give it (it is what opens the row); the
        # directories above a grant are not told, so the name shown starts at the grant
        row["path"], row["rel_path"] = entry["real"], access.display_path(user, entry["real"])
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
        offset = max(0, request.args.get("offset", 0, type=int) or 0)
        view = text_index.describe(config)
        results, more, partial = [], 0, False
        if terms and view["index"] is not None:
            hits, more, partial = text_index.search(view["index"], terms, _readable(config), real_folder, limit, offset=offset,
                                                    current=request.args.get("current") or None)
            user = access.restricted_user()
            results = [_row(hit, user) for hit in hits]
        return jsonify({"results": results, "more": more, "partial": partial, "index": _summary(view)})
