"""Admin interface: the page, the re-authentication and the audit log."""

import logging
import time
from datetime import datetime, timedelta, timezone

from flask import current_app, jsonify, render_template, request, session

from . import audit, reauth_minutes, state_dir
from .guard import csrf_token, require_admin, with_csp

logger = logging.getLogger(__name__)

AUDIT_PAGE_MAX = 500


@require_admin
def admin_page():
    """GET /admin: the HTML shell. The CSRF token reaches the script through
    the page's <meta>; there is no inline script (see guard.CSP)."""
    csrf_token()
    return with_csp(current_app.make_response(
        render_template("admin.html", app_name=current_app.config.get("app_name", "AnnZarro"))))


@require_admin(reauth=False, action="admin.reauth")
def reauth():
    """POST /api/v1/admin/reauth {password}: confirm the password and open the
    re-authentication window. Goes through ``authenticate`` so a wrong guess
    counts toward the lockout like one at the login page."""
    from ..auth import UnsupportedPasswordHash
    from .. import permissions

    body = request.get_json(silent=True)
    password = body.get("password") if isinstance(body, dict) else None
    if not isinstance(password, str) or not password:
        return jsonify(error="A password is required.", reason="bad_request"), 400
    username, _ = permissions.current_user()
    manager = current_app.auth_manager
    address = request.remote_addr
    if manager.lock_remaining(username, address):
        audit.record("admin.reauth", username, None, "refused:locked")
        return jsonify(error="Too many wrong passwords. Try again later.", reason="locked"), 423
    try:
        ok = manager.authenticate(username, password, client_ip=address)
    except UnsupportedPasswordHash as exc:
        logger.error("Re-authentication of %r impossible on this Python: %s", username, exc)
        return jsonify(error="This server cannot check passwords on its current Python "
                             "installation (the server log says why).",
                       reason="password_unsupported"), 500
    if not ok:
        audit.record("admin.reauth", username, None, "refused:bad_password")
        if manager.lock_remaining(username, address):
            return jsonify(error="Too many wrong passwords. Try again later.", reason="locked"), 423
        return jsonify(error="That password is not right.", reason="bad_password"), 401
    now = time.time()
    session["admin_auth_at"] = now
    audit.record("admin.reauth", username, None, "ok")
    until = datetime.fromtimestamp(now, timezone.utc) + timedelta(minutes=reauth_minutes(current_app.config))
    return jsonify(reauth_until=until.isoformat())


@require_admin
def audit_log():
    """GET /api/v1/admin/audit?before_seq=&limit=: records newest first. The
    first page (no before_seq) also carries the hash-chain check."""
    try:
        before = request.args.get("before_seq")
        before = int(before) if before not in (None, "") else None
        limit = int(request.args.get("limit", 100))
    except ValueError:
        return jsonify(error="before_seq and limit must be integers.", reason="bad_request"), 400
    limit = max(1, min(limit, AUDIT_PAGE_MAX))
    directory = state_dir(current_app.config)
    out = {"records": audit.read(directory, before_seq=before, limit=limit)}
    if before is None:
        out["chain"] = audit.verify_cached(directory)
    return jsonify(out)


def register(blueprint):
    blueprint.add_url_rule("/admin", "page", admin_page, strict_slashes=False)
    blueprint.add_url_rule("/api/v1/admin/reauth", "reauth", reauth, methods=["POST"])
    blueprint.add_url_rule("/api/v1/admin/audit", "audit", audit_log)
