"""Admin interface: server health, the cache clear and the description index rebuild."""

from flask import current_app, jsonify, request

from .. import cache_reset, health, panel_sets, text_index, update_check
from annzarro.utils import paths
from . import audit
from .guard import require_admin

MAX_PATH_CHARS = 4096


@require_admin
def get_health():
    """GET /api/v1/admin/health: every worker's snapshot, merged (see server/health.py)."""
    monitor = health.monitor(current_app)
    if monitor is None:       # only when login is off, where the guard has already refused
        return jsonify(error="Health needs login.", reason="admin_requires_login"), 404
    report = monitor.collect()
    report["panel_sets"] = panel_sets.describe(current_app.config)
    report["warnings"] = paths.state_dir_warnings(current_app.config)
    report["description_search"] = _description_search()
    return jsonify(report)


@require_admin
def version_check():
    """GET /api/v1/admin/version-check: the running version, and the newer one on PyPI if there is one
    (asked only now, cached for hours; see server/update_check.py)."""
    return jsonify(update_check.check(current_app.config))


def _description_search():
    """The Description search block: whether it is on, what the index holds and when it was built."""
    app = current_app._get_current_object()
    view = text_index.describe(app.config)
    return {"enabled": text_index.search_on(app), "state": view["state"], "built_at": view["built_at"],
            "complete": text_index.complete(view), "capped": bool(view["index"] is not None and view["index"].stores_capped),
            **text_index.counts(view)}


@require_admin(action="text_index.rebuild")
def rebuild_text_index():
    """POST /api/v1/admin/text-index/rebuild: crawl the datasets now (the description index, read again for what
    changed). One crawl runs at a time across all workers; asking while one runs changes nothing."""
    app = current_app._get_current_object()
    if not text_index.search_on(app):
        return jsonify(error="The description search is off.", reason="disabled"), 409
    started = text_index.start_crawl(app, force=True)
    audit.record("text_index.rebuild", None, {"started": started})
    return jsonify({**_description_search(), "started": started})


@require_admin(action="cache.clear")
def clear_cache():
    """POST /api/v1/admin/cache/clear {dataset_path?}: empty the caches of every
    worker (all datasets, or one), like ``POST /cache/reset``."""
    body = request.get_json(silent=True)
    if body is not None and not isinstance(body, dict):
        return jsonify(error="Send a JSON object.", reason="bad_request"), 400
    path = (body or {}).get("dataset_path")
    if path is not None and (not isinstance(path, str) or not path or len(path) > MAX_PATH_CHARS):
        return jsonify(error="dataset_path must be a non-empty string.", reason="bad_request"), 400
    result = cache_reset.reset_all(path)
    audit.record("cache.clear", path)
    return jsonify(result)


def register(blueprint):
    """Add this section's routes to the admin blueprint."""
    blueprint.add_url_rule("/api/v1/admin/health", "health", get_health)
    blueprint.add_url_rule("/api/v1/admin/version-check", "version_check", version_check)
    blueprint.add_url_rule("/api/v1/admin/cache/clear", "cache_clear", clear_cache, methods=["POST"])
    blueprint.add_url_rule("/api/v1/admin/text-index/rebuild", "text_index_rebuild", rebuild_text_index, methods=["POST"])
