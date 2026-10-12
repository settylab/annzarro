"""Admin interface: server health and the cache clear."""

from flask import current_app, jsonify, request

from .. import cache_reset, health
from . import audit
from .guard import require_admin

MAX_PATH_CHARS = 4096


@require_admin
def get_health():
    """GET /api/v1/admin/health: every worker's snapshot, merged (see server/health.py)."""
    monitor = health.monitor(current_app)
    if monitor is None:       # only when login is off, where the guard has already refused
        return jsonify(error="Health needs login.", reason="admin_requires_login"), 404
    return jsonify(monitor.collect())


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
    blueprint.add_url_rule("/api/v1/admin/cache/clear", "cache_clear", clear_cache, methods=["POST"])
